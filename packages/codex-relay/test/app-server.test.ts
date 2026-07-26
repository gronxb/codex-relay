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

type JsonRpcRequest = {
  id: number;
  method: string;
};

type SharedSocketServer = {
  close: () => Promise<void>;
  connections: WebSocket[];
  requests: JsonRpcRequest[];
};

const socketTempRoot = process.platform === "darwin" ? "/tmp" : tmpdir();

describe("CodexAppServerClient shared socket mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reconnects after its shared socket resets without starting another app-server", async () => {
    const codexHome = await mkdtemp(join(socketTempRoot, "codex-relay-app-server-"));
    const socketPath = join(codexHome, "app-server-control", "app-server-control.sock");
    const server = await startSharedSocketServer(socketPath);
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("CODEX_RELAY_APP_SERVER_MODE", "socket");
    const startSharedServer = vi.fn<() => Promise<never>>(async () => {
      throw new Error("Expected the client to attach to the existing shared app-server.");
    });
    const client = new CodexAppServerClient({ startSharedServer });

    try {
      await client.initialize();
      expect(server.connections).toHaveLength(1);
      expect(startSharedServer).not.toHaveBeenCalled();
      expect(relayDebugLog).toHaveBeenCalledWith("app_server.shared_socket.connected", {
        ownership: "attached",
        socketPath,
      });
      expect(relayDebugLog).toHaveBeenCalledWith("app_server.shared_socket.attached", {
        ownership: "attached",
        socketPath,
      });

      server.connections[0]?.terminate();

      await vi.waitFor(
        () => {
          expect(server.connections).toHaveLength(2);
        },
        { timeout: 5_000 },
      );
      await expect(client.listModels()).resolves.toEqual([]);
      expect(server.requests.filter((request) => request.method === "initialize")).toHaveLength(2);
      expect(startSharedServer).not.toHaveBeenCalled();
      expect(client.appServerMode).toBe("socket");
      expect(relayDebugLog).toHaveBeenCalledWith(
        "app_server.shared_socket.disconnected",
        expect.objectContaining({ ownership: "attached" }),
      );
      expect(relayDebugLog).toHaveBeenCalledWith("app_server.shared_socket.reconnected", {
        ownership: "attached",
        socketPath,
      });
    } finally {
      client.close();
      await server.close();
      await rm(codexHome, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "replaces a stale Unix socket after a slow shared app-server startup",
    async () => {
      // Given: a stale socket path and a real child that needs four seconds before listening.
      const codexHome = await mkdtemp(join(socketTempRoot, "codex-relay-slow-app-server-"));
      const fakeCodexBinary = join(codexHome, "fake-codex");
      const socketPath = join(codexHome, "app-server-control", "app-server-control.sock");
      await mkdir(dirname(socketPath), { recursive: true });
      await writeFile(socketPath, "");
      await writeFile(
        fakeCodexBinary,
        `#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { WebSocketServer } from ${JSON.stringify(import.meta.resolve("ws"))};

await setTimeout(4_000);
const socketPath = join(process.env.CODEX_HOME, "app-server-control", "app-server-control.sock");
await mkdir(join(process.env.CODEX_HOME, "app-server-control"), { recursive: true });
await rm(socketPath, { force: true });
const server = createServer();
const webSocketServer = new WebSocketServer({ server });
webSocketServer.on("connection", (socket) => {
  socket.on("message", (data) => {
    const request = JSON.parse(String(data));
    socket.send(JSON.stringify({
      id: request.id,
      result: request.method === "model/list" ? { data: [] } : {},
    }));
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, () => {
    server.off("error", reject);
    resolve();
  });
});
process.stdin.resume();
`,
      );
      await chmod(fakeCodexBinary, 0o755);
      vi.stubEnv("CODEX_BIN", fakeCodexBinary);
      vi.stubEnv("CODEX_HOME", codexHome);
      vi.stubEnv("CODEX_RELAY_APP_SERVER_MODE", "socket");
      const client = new CodexAppServerClient();

      try {
        // When: the relay initializes its shared app-server client.
        await client.initialize();

        // Then: it waits for a real listener instead of treating the stale path as ready.
        await expect(client.listModels()).resolves.toEqual([]);
      } finally {
        client.close();
        await rm(codexHome, { force: true, recursive: true });
      }
    },
    12_000,
  );
});

async function startSharedSocketServer(socketPath: string): Promise<SharedSocketServer> {
  await mkdir(dirname(socketPath), { recursive: true });
  const connections: WebSocket[] = [];
  const requests: JsonRpcRequest[] = [];
  const server = createServer();
  const webSocketServer = new WebSocketServer({ server });
  webSocketServer.on("connection", (socket) => {
    connections.push(socket);
    socket.on("message", (data) => {
      const request = JSON.parse(String(data)) as JsonRpcRequest;
      requests.push(request);
      socket.send(
        JSON.stringify({
          id: request.id,
          result: request.method === "model/list" ? { data: [] } : {},
        }),
      );
    });
  });
  await listen(server, socketPath);

  return {
    connections,
    requests,
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
