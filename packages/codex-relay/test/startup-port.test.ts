import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("an occupied port reports recovery instructions without overwriting running state", async () => {
  const listener = createServer();
  const home = await mkdtemp(join(tmpdir(), "relay-port-test-"));
  try {
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("Missing listener address");
    const statePath = join(home, "server-state.json");
    const pidPath = join(home, "server.pid");
    await writeFile(statePath, "existing state\n");
    await writeFile(pidPath, "existing pid\n");
    const result = await new Promise<{
      code: number | string | null | undefined;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        ["--import", "tsx", "src/cli.ts"],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(address.port),
            CODEX_RELAY_HOME: home,
            CODEX_RELAY_AUTH_DB_PATH: join(home, "auth.db"),
            CODEX_RELAY_PID_PATH: pidPath,
            CODEX_RELAY_APP_SERVER_MODE: "stdio",
          },
          timeout: 15_000,
        },
        (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }),
      );
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`127.0.0.1:${address.port} is already in use`);
    expect(result.stderr).toContain("npx codex-relay@latest qr");
    expect(result.stderr).toContain("npx codex-relay@latest stop");
    expect(result.stderr).toContain(`-iTCP:${address.port}`);
    expect(result.stderr).toContain("CODEX_RELAY_HOME");
    expect(result.stderr).not.toContain("Unhandled 'error' event");
    expect(result.stderr).not.toContain("node:events");
    expect(result.stdout).not.toContain("Pairing:");
    expect(await readFile(statePath, "utf8")).toBe("existing state\n");
    expect(await readFile(pidPath, "utf8")).toBe("existing pid\n");
    expect(listener.listening).toBe(true);
  } finally {
    if (listener.listening) await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}, 20_000);
