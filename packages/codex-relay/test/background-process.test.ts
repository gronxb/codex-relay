import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readRunningRelayPid, stopRunningRelay } from "../src/background-process.js";

describe("background relay pid detection", () => {
  it("ignores a live pid when the process is not codex-relay", async () => {
    const pidPath = await writePidFile("12965");

    const pid = await readRunningRelayPid(pidPath, {
      commandReader: async () => "/Applications/Visual Studio Code.app/Contents/MacOS/Code Helper",
      isProcessAlive: () => true,
    });

    expect(pid).toBeUndefined();
  });

  it("returns a live pid when the process command belongs to codex-relay", async () => {
    const pidPath = await writePidFile("77542");

    const pid = await readRunningRelayPid(pidPath, {
      commandReader: async () =>
        "/Users/gronxb/.local/bin/node --import loader.mjs src/cli.ts --dangerously-auto-approve",
      isProcessAlive: () => true,
    });

    expect(pid).toBe(77542);
  });

  it("signals a validated relay process and removes its pid file", async () => {
    // Given: a pid file that belongs to a live Codex Relay process.
    const pidPath = await writePidFile("77542");
    const signaledPids: number[] = [];

    // When: the background relay is stopped.
    const result = await stopRunningRelay(pidPath, {
      commandReader: async () => "node dist/cli.js codex-relay",
      isProcessAlive: () => true,
      signalProcess: (pid) => {
        signaledPids.push(pid);
      },
      waitForProcessExit: async () => true,
    });

    // Then: the owned process is signaled and its stale pid state is cleared.
    expect(result).toEqual({ kind: "stopped", pid: 77542 });
    expect(signaledPids).toEqual([77542]);
    await expect(access(pidPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears a stale pid file when no background relay is running", async () => {
    // Given: a pid file whose process no longer exists.
    const pidPath = await writePidFile("77542");

    // When: the background relay stop command is repeated.
    const result = await stopRunningRelay(pidPath, {
      isProcessAlive: () => false,
    });

    // Then: stop is idempotent and clears the stale pid state.
    expect(result).toEqual({ kind: "not-running" });
    await expect(access(pidPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function writePidFile(value: string) {
  const directory = await mkdtemp(join(tmpdir(), "codex-relay-pid-"));
  const pidPath = join(directory, "server.pid");
  await writeFile(pidPath, value);
  return pidPath;
}
