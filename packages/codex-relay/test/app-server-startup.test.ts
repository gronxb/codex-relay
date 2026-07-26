import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/debug-log.js", () => ({
  relayDebugLog: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}));

import { CodexAppServerClient } from "../src/app-server.js";
import { relayDebugLog } from "../src/debug-log.js";

type SharedSocketServer = {
  readonly close: () => Promise<void>;
};

const socketTempRoot = process.platform === "darwin" ? "/tmp" : tmpdir();

describe("CodexAppServerClient startup mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("falls back to private stdio when default shared startup fails", async () => {
    // Given: automatic shared mode and a working private stdio app-server.
    const codexHome = await mkdtemp(join(socketTempRoot, "codex-relay-fallback-app-server-"));
    const fakeCodexBinary = join(codexHome, "fake-codex");
    await writeFakeStdioCodexBinary(fakeCodexBinary);
    vi.stubEnv("CODEX_BIN", fakeCodexBinary);
    vi.stubEnv("CODEX_HOME", codexHome);
    const sharedError = new Error("shared startup failed");
    const startSharedServer = vi.fn<() => Promise<never>>(async () => {
      throw sharedError;
    });
    const onStartupFallback = vi.fn<(error: Error) => void>();
    const client = new CodexAppServerClient({
      mode: { fallbackToStdio: true, mode: "socket" },
      onStartupFallback,
      startSharedServer,
    });

    try {
      // When: the client initializes.
      await client.initialize();

      // Then: it reports the fallback and continues through private stdio.
      expect(startSharedServer).toHaveBeenCalledOnce();
      expect(onStartupFallback).toHaveBeenCalledWith(sharedError);
      expect(client.appServerMode).toBe("stdio");
      await expect(client.listModels()).resolves.toEqual([]);
    } finally {
      client.close();
      await rm(codexHome, { force: true, recursive: true });
    }
  });

  it("does not fall back when shared mode is explicitly configured", async () => {
    // Given: forced shared mode whose server cannot start.
    const codexHome = await mkdtemp(join(socketTempRoot, "codex-relay-forced-app-server-"));
    vi.stubEnv("CODEX_HOME", codexHome);
    const sharedError = new Error("forced shared startup failed");
    const startSharedServer = vi.fn<() => Promise<never>>(async () => {
      throw sharedError;
    });
    const onStartupFallback = vi.fn<(error: Error) => void>();
    const client = new CodexAppServerClient({
      mode: { fallbackToStdio: false, mode: "socket" },
      onStartupFallback,
      startSharedServer,
    });

    try {
      // When: the client initializes.
      const initialization = client.initialize();

      // Then: the explicit shared-mode failure remains visible.
      await expect(initialization).rejects.toThrow(sharedError.message);
      expect(startSharedServer).toHaveBeenCalledOnce();
      expect(onStartupFallback).not.toHaveBeenCalled();
      expect(client.appServerMode).toBe("socket");
    } finally {
      client.close();
      await rm(codexHome, { force: true, recursive: true });
    }
  });

  it("does not fall back after a shared connection has initialized", async () => {
    // Given: automatic shared mode that initialized successfully before losing its server.
    const codexHome = await mkdtemp(join(socketTempRoot, "codex-relay-connected-app-server-"));
    const fakeCodexBinary = join(codexHome, "fake-codex");
    const socketPath = join(codexHome, "app-server-control", "app-server-control.sock");
    await writeFakeStdioCodexBinary(fakeCodexBinary);
    const server = await startSharedSocketServer(socketPath);
    vi.stubEnv("CODEX_BIN", fakeCodexBinary);
    vi.stubEnv("CODEX_HOME", codexHome);
    const sharedError = new Error("replacement shared startup failed");
    const startSharedServer = vi.fn<() => Promise<never>>(async () => {
      throw sharedError;
    });
    const onStartupFallback = vi.fn<(error: Error) => void>();
    const client = new CodexAppServerClient({
      mode: { fallbackToStdio: true, mode: "socket" },
      onStartupFallback,
      startSharedServer,
    });
    let serverClosed = false;

    try {
      await client.initialize();
      await server.close();
      serverClosed = true;
      await vi.waitFor(
        () => {
          expect(relayDebugLog).toHaveBeenCalledWith(
            "app_server.shared_socket.reconnect_failed",
            expect.objectContaining({ ownership: "attached" }),
          );
        },
        { timeout: 8_000 },
      );

      // When: a later initialization retries after reconnect exhaustion.
      const reinitialization = client.initialize();

      // Then: the failure stays in shared mode instead of splitting into private stdio.
      await expect(reinitialization).rejects.toThrow(sharedError.message);
      expect(startSharedServer).toHaveBeenCalledOnce();
      expect(onStartupFallback).not.toHaveBeenCalled();
      expect(client.appServerMode).toBe("socket");
    } finally {
      client.close();
      if (!serverClosed) {
        await server.close();
      }
      await rm(codexHome, { force: true, recursive: true });
    }
  }, 12_000);
});

async function startSharedSocketServer(socketPath: string): Promise<SharedSocketServer> {
  await mkdir(dirname(socketPath), { recursive: true });
  const connections: WebSocket[] = [];
  const server = createServer();
  const webSocketServer = new WebSocketServer({ server });
  webSocketServer.on("connection", (socket) => {
    connections.push(socket);
    socket.on("message", (data) => {
      const request = JSON.parse(String(data)) as { id: number };
      socket.send(JSON.stringify({ id: request.id, result: {} }));
    });
  });
  await listen(server, socketPath);

  return {
    async close() {
      for (const socket of connections) {
        socket.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

function listen(server: Server, socketPath: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function writeFakeStdioCodexBinary(binaryPath: string) {
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const result = request.method === "model/list" ? { data: [] } : {};
  process.stdout.write(\`\${JSON.stringify({ id: request.id, result })}\\n\`);
});
`,
  );
  await chmod(binaryPath, 0o755);
}
