#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import qrcode from "qrcode-terminal";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { apiPaths } from "./api-schema.js";
import { readRunningRelayPid } from "./background-process.js";
import { createTursoPairingSessionStore } from "./pairing-store.js";
import { getConnectUrlGuidance } from "./pairing-url-candidates.js";

import { codexRelayDataPath, codexRelayHome, legacyCodexRelayDataPath } from "./paths.js";

const npxCommand = "npx codex-relay@latest";

type ServerState = {
  connectUrl?: string;
  connectUrlCandidates?: Array<{ label: string; url: string }>;
  host?: string;
  listenUrl?: string;
  pairingPayload?: string;
  port?: number;
};

type ClearPairingResult = {
  pendingPairingsCleared: number;
  sessionsCleared: number;
};

const program = new Command()
  .name("codex-relay")
  .description("Run and approve the codex-relay local CLI bridge.")
  .option("--bg", "run the Codex Relay server in the background")
  .option("--debug", "write verbose relay diagnostics to debug.log")
  .option(
    "--shared-app-server",
    "use a shared Codex app-server socket so terminal and mobile can share live sessions",
  )
  .option(
    "--dangerously-auto-approve",
    "automatically approve mobile pairing requests without a local approval command",
  )
  .addHelpText(
    "after",
    `

Examples:
  ${npxCommand}              Start the relay and print a pairing QR
  ${npxCommand} --shared-app-server Share live sessions with a connected terminal
  ${npxCommand} --bg         Start the relay in the background
  ${npxCommand} qr           Print the current pairing QR
  ${npxCommand} clear        Sign out every paired mobile app
  ${npxCommand} approve CODE Approve a pending mobile pairing request`,
  )
  .action(async (options) => {
    if (options.debug) {
      process.env.CODEX_RELAY_DEBUG = "1";
    }
    if (options.dangerouslyAutoApprove) {
      process.env.CODEX_RELAY_DANGEROUSLY_AUTO_APPROVE = "1";
    }
    if (options.sharedAppServer) {
      process.env.CODEX_RELAY_APP_SERVER_MODE = "socket";
    }

    if (options.bg) {
      await startBackgroundServer();
      return;
    }

    await import("./index.js").catch(handleServerStartError);
  });

program
  .command("qr")
  .description("Print the current pairing QR for an already running server.")
  .action(async () => {
    await printPairingQr();
  });

program
  .command("approve")
  .description("Approve a pending mobile pairing request.")
  .argument("<approval-code>", "approval code shown in the mobile app")
  .action(async (approvalCode) => {
    await approvePairing(approvalCode);
  });

program
  .command("clear")
  .description("Sign out every paired mobile app.")
  .option("--debug", "also delete debug.log")
  .action(async (options, command) => {
    await clearPairings({
      clearDebugLog: Boolean(options.debug || command.optsWithGlobals().debug),
    });
  });

await program.parseAsync();

async function startBackgroundServer() {
  const logPath = codexRelayDataPath("server.log");
  const debugLogPath = codexRelayDataPath("debug.log");
  const pidPath = codexRelayDataPath("server.pid");
  await mkdir(dirname(logPath), { recursive: true });

  const existingPid = await readRunningRelayPid(pidPath);
  if (existingPid) {
    console.log(`codex-relay is already running in the background (pid ${existingPid}).`);
    console.log(`Logs: ${logPath}`);
    if (process.env.CODEX_RELAY_DEBUG === "1") {
      console.log(`Debug logs: ${debugLogPath}`);
    }
    console.log(`Print the current pairing QR with: ${npxCommand} qr`);
    return;
  }
  await unlink(pidPath).catch(() => undefined);

  const output = openSync(logPath, "a", 0o600);
  const cliPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [...process.execArgv, cliPath, ...backgroundArgs()], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      CODEX_RELAY_BACKGROUND: "1",
      CODEX_RELAY_HOME: codexRelayHome(),
      CODEX_RELAY_PID_PATH: pidPath,
    },
    stdio: ["ignore", output, output],
  });
  child.unref();
  closeSync(output);

  const startedPid = await waitForBackgroundPid(child, pidPath);
  if (!startedPid) {
    console.error("codex-relay failed to start in the background.");
    console.error(`Logs: ${logPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Started codex-relay in the background (pid ${startedPid}).`);
  console.log(`Logs: ${logPath}`);
  if (process.env.CODEX_RELAY_DEBUG === "1") {
    console.log(`Debug logs: ${debugLogPath}`);
  }
  console.log(`Print the pairing QR later with: ${npxCommand} qr`);
}

function backgroundArgs() {
  return process.argv.slice(2).filter((arg) => arg !== "--bg");
}

async function waitForBackgroundPid(child: ReturnType<typeof spawn>, pidPath: string) {
  let childExited = false;
  child.once("exit", () => {
    childExited = true;
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pid = await readRunningRelayPid(pidPath);
    if (pid) {
      return pid;
    }
    if (childExited) {
      return undefined;
    }
    await setTimeout(100);
  }

  return undefined;
}

async function approvePairing(rawCode: string | undefined) {
  const approvalCode = normalizeApprovalCode(rawCode ?? "");
  if (!approvalCode) {
    console.error(`Usage: ${npxCommand} approve XXXX-XXXX`);
    process.exitCode = 1;
    return;
  }

  const endpoint = await getApprovalEndpoint();
  const secret = await readApprovalSecret();
  const response = await fetch(`${endpoint}${apiPaths.pairApprove}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-codex-relay-approve-secret": secret,
    },
    body: JSON.stringify({ approvalCode }),
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error
        ? String(payload.error.message)
        : `Codex Relay server returned ${response.status}`;
    console.error(message);
    process.exitCode = 1;
    return;
  }

  console.log("Approved Codex Relay pairing request.");
}

async function clearPairings(options: { clearDebugLog: boolean }) {
  const result = await clearPairingsViaServer().catch(async (error) => {
    if (await hasRunningBackgroundServer()) {
      throw error;
    }
    return clearPairingsFromLocalStore();
  });
  const removedDebugLogs = options.clearDebugLog ? await clearDebugLogs() : [];

  console.log(
    `Signed out ${result.sessionsCleared} paired mobile app${
      result.sessionsCleared === 1 ? "" : "s"
    }.`,
  );
  if (result.pendingPairingsCleared > 0) {
    console.log(
      `Removed ${result.pendingPairingsCleared} pending pairing request${
        result.pendingPairingsCleared === 1 ? "" : "s"
      }.`,
    );
  }
  if (options.clearDebugLog) {
    console.log(
      removedDebugLogs.length > 0
        ? `Deleted debug logs: ${removedDebugLogs.join(", ")}`
        : "No debug logs found.",
    );
  }
}

async function clearPairingsViaServer(): Promise<ClearPairingResult> {
  const endpoint = await getApprovalEndpoint();
  const secret = await readApprovalSecret();
  const response = await fetch(`${endpoint}${apiPaths.sessionsClear}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-codex-relay-approve-secret": secret,
    },
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error
        ? String(payload.error.message)
        : `Codex Relay server returned ${response.status}`;
    throw new Error(message);
  }

  return parseClearPairingResult(payload);
}

async function clearPairingsFromLocalStore(): Promise<ClearPairingResult> {
  const dbPath = await resolveAuthDbPath();
  if (!dbPath) {
    return { pendingPairingsCleared: 0, sessionsCleared: 0 };
  }

  const sessions = await createTursoPairingSessionStore(dbPath);
  return sessions.clearAll();
}

async function resolveAuthDbPath() {
  if (process.env.CODEX_RELAY_AUTH_DB_PATH) {
    return process.env.CODEX_RELAY_AUTH_DB_PATH;
  }

  const primary = codexRelayDataPath("auth.db");
  if (await pathExists(primary)) {
    return primary;
  }

  const legacy = legacyCodexRelayDataPath("auth.db");
  if (await pathExists(legacy)) {
    return legacy;
  }

  return undefined;
}

async function clearDebugLogs() {
  const paths = [
    ...new Set([codexRelayDataPath("debug.log"), legacyCodexRelayDataPath("debug.log")]),
  ];
  const removed: string[] = [];
  for (const path of paths) {
    if (!(await pathExists(path))) {
      continue;
    }
    await rm(path, { force: true });
    removed.push(path);
  }
  return removed;
}

async function hasRunningBackgroundServer() {
  return Boolean(await readRunningRelayPid(codexRelayDataPath("server.pid")));
}

async function pathExists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

function parseClearPairingResult(payload: unknown): ClearPairingResult {
  if (!payload || typeof payload !== "object") {
    return { pendingPairingsCleared: 0, sessionsCleared: 0 };
  }

  return {
    pendingPairingsCleared:
      "pendingPairingsCleared" in payload ? Number(payload.pendingPairingsCleared) || 0 : 0,
    sessionsCleared: "sessionsCleared" in payload ? Number(payload.sessionsCleared) || 0 : 0,
  };
}

async function printPairingQr() {
  const storedState = await readServerState();
  const state = storedState?.pairingPayload ? storedState : await readServerLogState();
  if (!state?.pairingPayload) {
    console.error("No running Codex Relay server state was found.");
    console.error(`Start the server first with: ${npxCommand}`);
    console.error(`Or run it in the background with: ${npxCommand} --bg`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  qrcode.generate(state.pairingPayload, { small: true });
  console.log("");
  if (state.connectUrl) {
    console.log(`Mobile: ${state.connectUrl}`);
    const guidance = getConnectUrlGuidance(state.connectUrl);
    if (guidance) {
      console.log(`Network: ${guidance}`);
    }
  }
  if (state.connectUrlCandidates && state.connectUrlCandidates.length > 1) {
    console.log(`Candidate addresses: ${state.connectUrlCandidates.length}`);
    for (const candidate of state.connectUrlCandidates.slice(1)) {
      console.log(`  ${candidate.label}: ${candidate.url}`);
    }
  }
  if (state.listenUrl) {
    console.log(`Server: ${state.listenUrl}`);
  }
  console.log("");
  console.log(`Pairing: ${state.pairingPayload}`);
  console.log("");
}

async function handleServerStartError(error: unknown) {
  if (!isDatabaseLockError(error)) {
    throw error;
  }

  const pidPath = codexRelayDataPath("server.pid");
  const logPath = codexRelayDataPath("server.log");
  const existingPid = await readRunningRelayPid(pidPath);
  const storedState = await readServerState();
  const state = storedState?.pairingPayload ? storedState : await readServerLogState();

  console.error("Codex Relay is already using its local pairing database.");
  console.error("");
  if (existingPid) {
    console.error(`A background server appears to be running (pid ${existingPid}).`);
    console.error("Use the existing server instead of starting a second one:");
    console.error(`  ${npxCommand} qr`);
    console.error("");
    console.error("To stop the background server:");
    console.error(`  kill -TERM ${existingPid}`);
    console.error("");
    console.error(`Logs: ${logPath}`);
  } else {
    console.error("Another Codex Relay process is already running or exited without cleanup.");
    if (state?.pairingPayload) {
      console.error("Use the existing server instead of starting a second one:");
      console.error(`  ${npxCommand} qr`);
      console.error("");
    }
    console.error("Find it with:");
    console.error(
      `  lsof -nP ${codexRelayDataPath("auth.db")} ${codexRelayDataPath("auth.db-wal")}`,
    );
    console.error("  lsof -nP -iTCP:8787 -sTCP:LISTEN");
    console.error("");
    console.error("Then stop that process with:");
    console.error("  kill -TERM <pid>");
  }
  console.error("");
  console.error("If you wanted a persistent server, start it once with:");
  console.error(`  ${npxCommand} --bg`);
  process.exitCode = 1;
}

async function readApprovalSecret() {
  if (process.env.CODEX_RELAY_APPROVAL_SECRET) {
    return process.env.CODEX_RELAY_APPROVAL_SECRET;
  }

  return (await readRelayDataFile("approval-secret")).trim();
}

async function getApprovalEndpoint() {
  const state = await readServerState();
  const port = process.env.PORT ? Number(process.env.PORT) : (state?.port ?? 8787);
  const host = process.env.HOST ?? state?.host ?? "127.0.0.1";
  const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${connectHost}:${port}`;
}

async function readServerState(): Promise<ServerState | undefined> {
  const state = await readRelayDataFile("server-state.json")
    .then(
      (value) =>
        JSON.parse(value) as {
          connectUrl?: unknown;
          connectUrlCandidates?: unknown;
          host?: unknown;
          listenUrl?: unknown;
          pairingPayload?: unknown;
          port?: unknown;
        },
    )
    .catch(() => undefined);
  if (!state) {
    return undefined;
  }

  return {
    connectUrl: typeof state.connectUrl === "string" ? state.connectUrl : undefined,
    connectUrlCandidates: parseConnectUrlCandidates(state.connectUrlCandidates),
    host: typeof state.host === "string" ? state.host : undefined,
    listenUrl: typeof state.listenUrl === "string" ? state.listenUrl : undefined,
    pairingPayload: typeof state.pairingPayload === "string" ? state.pairingPayload : undefined,
    port: typeof state.port === "number" ? state.port : undefined,
  };
}

async function readServerLogState(): Promise<ServerState | undefined> {
  const log = await readRelayDataFile("server.log").catch(() => undefined);
  if (!log) {
    return undefined;
  }

  const connectUrl = lastLogValue(log, "Mobile");
  const listenUrl = lastLogValue(log, "Server");
  const pairingPayload = lastLogValue(log, "Pairing");
  return pairingPayload ? { connectUrl, listenUrl, pairingPayload } : undefined;
}

async function readRelayDataFile(fileName: string) {
  const primary = await readFile(codexRelayDataPath(fileName), "utf8").catch(() => undefined);
  if (primary !== undefined) {
    return primary;
  }
  return readFile(legacyCodexRelayDataPath(fileName), "utf8");
}

function lastLogValue(log: string, label: string) {
  const pattern = new RegExp(`${label}:\\s*(\\S+)`, "g");
  let value: string | undefined;
  for (const match of log.matchAll(pattern)) {
    value = match[1];
  }
  return value;
}

function parseConnectUrlCandidates(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return undefined;
      }
      const label = "label" in candidate ? candidate.label : undefined;
      const url = "url" in candidate ? candidate.url : undefined;
      return typeof label === "string" && typeof url === "string" ? { label, url } : undefined;
    })
    .filter((candidate): candidate is { label: string; url: string } => Boolean(candidate));
}

function isDatabaseLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("failed to open database") && message.includes("Locking error");
}

function normalizeApprovalCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replaceAll("O", "0")
    .replaceAll("I", "1");
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}
