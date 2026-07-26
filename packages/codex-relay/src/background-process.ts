import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type ProcessCommandReader = (pid: number) => Promise<string | undefined>;
type ProcessAliveChecker = (pid: number) => boolean;
type ProcessSignaler = (pid: number) => void;
type ProcessExitWaiter = (pid: number) => Promise<boolean>;

type ReadRunningRelayPidOptions = {
  readonly commandReader?: ProcessCommandReader;
  readonly isProcessAlive?: ProcessAliveChecker;
};

type StopRunningRelayOptions = ReadRunningRelayPidOptions & {
  readonly signalProcess?: ProcessSignaler;
  readonly waitForProcessExit?: ProcessExitWaiter;
};

export type StopRunningRelayResult =
  | { readonly kind: "not-running" }
  | { readonly kind: "stopped"; readonly pid: number }
  | { readonly kind: "timed-out"; readonly pid: number };

export async function readRunningRelayPid(
  pidPath: string,
  options: ReadRunningRelayPidOptions = {},
) {
  const value = await readFile(pidPath, "utf8").catch(() => undefined);
  const pid = value ? Number(value.trim()) : NaN;
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  if (!isProcessAlive(pid)) {
    return undefined;
  }

  const commandReader = options.commandReader ?? readProcessCommand;
  const command = await commandReader(pid);
  return command && isRelayProcessCommand(command) ? pid : undefined;
}

export async function stopRunningRelay(
  pidPath: string,
  options: StopRunningRelayOptions = {},
): Promise<StopRunningRelayResult> {
  const pid = await readRunningRelayPid(pidPath, options);
  if (!pid) {
    await rm(pidPath, { force: true });
    return { kind: "not-running" };
  }

  const signalProcess = options.signalProcess ?? signalRelayProcess;
  signalProcess(pid);
  const waitForProcessExit = options.waitForProcessExit ?? waitForRelayProcessExit;
  if (!(await waitForProcessExit(pid))) {
    return { kind: "timed-out", pid };
  }

  await rm(pidPath, { force: true });
  return { kind: "stopped", pid };
}

function defaultIsProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalRelayProcess(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
}

async function waitForRelayProcessExit(pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!defaultIsProcessAlive(pid)) {
      return true;
    }
    await setTimeout(50);
  }
  return false;
}

async function readProcessCommand(pid: number) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function isRelayProcessCommand(command: string) {
  const normalized = command.replaceAll("\\", "/");
  return (
    normalized.includes("codex-relay") ||
    normalized.includes("/src/cli.ts") ||
    normalized.includes(" src/cli.ts")
  );
}
