import { describe, expect, it, vi } from "vitest";

import { ListThreadsResponseSchema } from "../src/api-schema.js";
import {
  CodexAppServerClient,
  type AppServerNotification,
  type AppServerRequest,
} from "../src/app-server.js";
import { createApp } from "../src/app.js";
import type { CodexClient } from "../src/codex.js";
import { createTursoPairingSessionStore } from "../src/pairing-store.js";
import type { PushNotificationSender, RelayPushNotification } from "../src/push-notifications.js";

function unavailableCodex(): CodexClient {
  return {
    resumeThread() {
      throw new Error("Subagent input reached the legacy Codex client.");
    },
    startThread() {
      throw new Error("Subagent input started a legacy Codex thread.");
    },
  };
}

function appServerThread(id: string, parentThreadId: string | null = null) {
  const now = Date.now() / 1000;
  return {
    id,
    parentThreadId,
    preview: id,
    createdAt: now,
    updatedAt: now,
    status: { type: "idle" },
    cwd: "/tmp/codex-relay",
    source: "cli",
    modelProvider: "openai",
    name: id,
    turns: [],
  };
}

function appServerWithThreads(
  listedThreads: ReturnType<typeof appServerThread>[],
  readableThreads = listedThreads,
) {
  const appServer = new CodexAppServerClient();
  vi.spyOn(appServer, "listThreads").mockResolvedValue(listedThreads);
  vi.spyOn(appServer, "readThread").mockImplementation(async (threadId) => {
    const thread = readableThreads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new Error(`Unknown test thread ${threadId}.`);
    }
    return thread;
  });
  vi.spyOn(appServer, "onNotification").mockImplementation(() => () => false);
  vi.spyOn(appServer, "onRequest").mockImplementation(() => () => false);
  return appServer;
}

describe("subagent thread boundaries", () => {
  it("lists parent threads without spawned subagent threads", async () => {
    // Given
    const parentThread = appServerThread("parent-thread");
    const subagentThread = appServerThread("subagent-thread", parentThread.id);
    const app = createApp({
      appServer: appServerWithThreads([subagentThread, parentThread]),
      codex: unavailableCodex(),
    });

    // When
    const response = await app.request("/v1/threads");
    const body = ListThreadsResponseSchema.parse(await response.json());

    // Then
    expect(response.status).toBe(200);
    expect(body.threads.map((thread) => thread.id)).toEqual([parentThread.id]);
  });

  it("rejects direct reads and chat input for a spawned subagent thread", async () => {
    // Given
    const subagentThread = appServerThread("subagent-thread", "parent-thread");
    const app = createApp({
      appServer: appServerWithThreads([], [subagentThread]),
      codex: unavailableCodex(),
    });

    // When
    const detailResponse = await app.request(`/v1/threads/${subagentThread.id}`);
    const runResponse = await app.request(`/v1/threads/${subagentThread.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ prompt: "Continue directly" }),
      headers: { "content-type": "application/json" },
    });

    // Then
    expect(detailResponse.status).toBe(404);
    expect(runResponse.status).toBe(404);
  });

  it("suppresses completion and action-required pushes from spawned subagents", async () => {
    // Given
    const sessions = await createTursoPairingSessionStore(":memory:");
    await sessions.createSession("client-token", {
      clientSessionId: "phone-session",
      expiresAt: Date.now() + 60_000,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: true,
      clientSessionId: "phone-session",
      expoPushToken: "ExponentPushToken[phone-token]",
      platform: "ios",
      turnTerminal: true,
    });
    const notificationHandlers = new Set<(notification: AppServerNotification) => void>();
    const requestHandlers = new Set<(request: AppServerRequest) => void>();
    const appServer = new CodexAppServerClient();
    vi.spyOn(appServer, "onNotification").mockImplementation((handler) => {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    });
    vi.spyOn(appServer, "onRequest").mockImplementation((handler) => {
      requestHandlers.add(handler);
      return () => requestHandlers.delete(handler);
    });
    const sent: RelayPushNotification[][] = [];
    const sender: PushNotificationSender = {
      async send(notifications) {
        sent.push([...notifications]);
        return { invalidExpoPushTokens: [] };
      },
    };
    createApp({
      appServer,
      codex: unavailableCodex(),
      pairing: {
        createClientToken: () => "unused-client-token",
        hashClientToken: (token) => token,
        sessions,
        tokenTtlMs: 60_000,
      },
      pushNotificationSender: sender,
    });

    // When
    for (const handler of notificationHandlers) {
      handler({
        method: "item/completed",
        params: {
          item: {
            agentsStates: {},
            id: "spawn-agent",
            model: null,
            prompt: null,
            reasoningEffort: null,
            receiverThreadIds: ["subagent-thread"],
            senderThreadId: "parent-thread",
            status: "completed",
            tool: "spawnAgent",
            type: "collabAgentToolCall",
          },
          threadId: "parent-thread",
          turnId: "parent-turn",
        },
      });
    }
    for (const handler of requestHandlers) {
      handler({
        id: 1,
        method: "item/tool/requestUserInput",
        params: { threadId: "subagent-thread", turnId: "subagent-turn" },
      });
    }
    for (const handler of notificationHandlers) {
      handler({
        method: "turn/completed",
        params: {
          status: "completed",
          threadId: "subagent-thread",
          turnId: "subagent-turn",
        },
      });
    }
    for (const handler of requestHandlers) {
      handler({
        id: 2,
        method: "item/tool/requestUserInput",
        params: { threadId: "parent-thread", turnId: "parent-turn" },
      });
    }
    for (const handler of notificationHandlers) {
      handler({
        method: "turn/completed",
        params: { status: "completed", threadId: "parent-thread", turnId: "parent-turn" },
      });
    }
    await vi.waitFor(() =>
      expect(sent.flat().some((notification) => notification.data.intent === "turn_terminal")).toBe(
        true,
      ),
    );

    // Then
    expect(sent).toEqual([
      [
        expect.objectContaining({
          data: {
            intent: "action_required",
            threadId: "parent-thread",
            turnId: "parent-turn",
          },
        }),
      ],
      [
        expect.objectContaining({
          data: {
            intent: "turn_terminal",
            threadId: "parent-thread",
            turnId: "parent-turn",
          },
        }),
      ],
    ]);
  });
});
