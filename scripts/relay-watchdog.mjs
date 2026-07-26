import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isRelayHealthy, relayHealthUrl, relayServiceCommand } from "./relay-watchdog-command.mjs";

const root = resolve(import.meta.dirname, "..");
const logPath = resolve(root, ".codex-relay/relay-watchdog.log");
const restartDelayMs = Number(process.env.RELAY_RESTART_DELAY_MS ?? 1000);
const healthCheckIntervalMs = Number(process.env.RELAY_HEALTH_CHECK_INTERVAL_MS ?? 5000);
const healthCheckGraceMs = Number(process.env.RELAY_HEALTH_CHECK_GRACE_MS ?? 15000);
const healthCheckFailures = Number(process.env.RELAY_HEALTH_CHECK_FAILURES ?? 3);
const healthCheckUrl = process.env.RELAY_HEALTH_CHECK_URL ?? relayHealthUrl(process.env);
const cliArgs = process.argv.slice(2);

let stopping = false;
let child;

await mkdir(dirname(logPath), { recursive: true });
await log(`watchdog starting args=${cliArgs.join(" ")}`);

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const serviceCommand = relayServiceCommand(cliArgs);
if (serviceCommand.persistent) {
  await runService(serviceCommand);
} else {
  await runCommandOnce(serviceCommand);
}
await log("watchdog stopped");

async function runService(serviceCommand) {
  while (!stopping) {
    const startedAt = Date.now();
    child = spawnService(serviceCommand);

    await log(`server spawned pid=${child.pid}`);

    const exitPromise = waitForExit(child);
    const healthAbortController = new AbortController();
    const healthPromise = waitForUnhealthyListener(child, startedAt, healthAbortController.signal);
    const result = await Promise.race([exitPromise, healthPromise]);

    healthAbortController.abort();

    const exit =
      result.reason === "unhealthy"
        ? await terminateUnhealthyChild(child, exitPromise)
        : result.exit;
    child = undefined;

    if (stopping) {
      break;
    }

    const uptimeMs = Date.now() - startedAt;
    await log(
      `server exited code=${exit.code ?? "null"} signal=${
        exit.signal ?? "null"
      } uptimeMs=${uptimeMs}; restarting in ${restartDelayMs}ms`,
    );
    await delay(restartDelayMs);
  }
}

async function runCommandOnce(serviceCommand) {
  child = spawnService(serviceCommand);
  await log(`command spawned pid=${child.pid}`);
  const exit = await waitForExit(child);
  child = undefined;
  process.exitCode = exit.code ?? 1;
}

function spawnService(serviceCommand) {
  return spawn(serviceCommand.command, serviceCommand.args, {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: process.env.CODEX_RELAY_PORT ?? process.env.PORT ?? "8787",
    },
    stdio: "inherit",
  });
}

function waitForExit(runningChild) {
  return new Promise((resolve) => {
    runningChild.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForUnhealthyListener(runningChild, startedAt, signal) {
  if (healthCheckIntervalMs <= 0) {
    return new Promise(() => undefined);
  }

  let failedChecks = 0;
  while (!signal.aborted && !stopping && !runningChild.killed) {
    await abortableDelay(healthCheckIntervalMs, signal);
    if (signal.aborted || stopping || runningChild.killed) {
      break;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < healthCheckGraceMs) {
      continue;
    }

    const healthy = await isRelayHealthy(fetch, healthCheckUrl);
    if (healthy) {
      failedChecks = 0;
      continue;
    }

    failedChecks += 1;
    await log(
      `health check failed url=${healthCheckUrl} failures=${failedChecks}/${healthCheckFailures}`,
    );
    if (failedChecks >= healthCheckFailures) {
      return { reason: "unhealthy" };
    }
  }

  return { reason: "stopped", exit: { code: null, signal: null } };
}

async function terminateUnhealthyChild(runningChild, exitPromise) {
  await log(`listener unhealthy; terminating server wrapper pid=${runningChild.pid}`);
  if (!runningChild.killed) {
    runningChild.kill("SIGTERM");
  }

  const timeoutExit = delay(5000).then(() => ({ code: null, signal: "SIGKILL_TIMEOUT" }));
  const exit = await Promise.race([exitPromise, timeoutExit]);
  if (exit.signal === "SIGKILL_TIMEOUT") {
    runningChild.kill("SIGKILL");
    return await exitPromise;
  }
  return exit;
}

async function abortableDelay(ms, signal) {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}

function stop() {
  stopping = true;
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(logPath, line);
}
