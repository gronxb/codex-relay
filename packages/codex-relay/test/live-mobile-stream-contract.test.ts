import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { CodexAppServerClient } from "../src/app-server.js";
import {
  applyStreamEvent,
  chatStore$,
  resetChatSessionState,
  setRunning,
} from "../../../apps/mobile/src/state/chat-store.js";
import {
  createThreadRunSseDispatcher,
  handleThreadRunStreamEvent,
} from "../../../apps/mobile/src/lib/thread-run-stream.js";

const runLiveAppServerTest = process.env.CODEX_RELAY_LIVE_APP_SERVER_TEST === "1";
const liveDescribe = runLiveAppServerTest ? describe : describe.skip;

liveDescribe("live mobile stream contract", () => {
  let appServer: CodexAppServerClient | undefined;
  let secondAppServer: CodexAppServerClient | undefined;

  beforeEach(() => {
    resetChatSessionState();
  });

  afterEach(() => {
    appServer?.close();
    secondAppServer?.close();
    appServer = undefined;
    secondAppServer = undefined;
    vi.unstubAllEnvs();
  });

  it("shares a socket-backed thread between independent app-server clients", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-shared-workspace-"));
    vi.stubEnv("CODEX_RELAY_APP_SERVER_MODE", "socket");
    appServer = new CodexAppServerClient();
    secondAppServer = new CodexAppServerClient();
    await Promise.all([appServer.initialize(), secondAppServer.initialize()]);
    const secondClientNotifications: string[] = [];
    const unsubscribe = secondAppServer.onNotification((notification) => {
      secondClientNotifications.push(notification.method);
    });

    const thread = await appServer.startThread({
      approvalPolicy: "never",
      cwd: workspacePath,
      experimentalRawEvents: false,
      model: null,
      persistExtendedHistory: true,
      sandbox: "read-only",
      serviceTier: null,
    });

    try {
      await vi.waitFor(() => expect(secondClientNotifications).toContain("thread/started"));
      const sharedThread = await secondAppServer.readThread(thread.id, { includeTurns: false });
      expect(sharedThread.id).toBe(thread.id);
      expect(sharedThread.cwd).toBe(workspacePath);
    } finally {
      unsubscribe();
    }
  }, 30_000);

  it("round-trips a real app-server turn through the server SSE and mobile stream reducer", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-live-workspace-"));
    appServer = new CodexAppServerClient();
    const app = createApp({
      appServer,
      workspacePath,
    });

    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        runtimeMode: "full-access",
        title: "Live stream contract",
      }),
      headers: { "content-type": "application/json" },
    });
    const createPayload = await createResponse.json();
    const threadId = createPayload.thread.id as string;

    const response = await app.request(`/v1/threads/${threadId}/runs/stream`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        prompt: "Reply with exactly: relay-live-ok",
        reasoningEffort: "medium",
        runtimeMode: "full-access",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const consumed = consumeAsMobileChatStream(body, threadId);
    const messages = chatStore$.messagesByThreadId[threadId].peek() ?? [];
    const assistantMessage = messages.find((message) => message.role === "assistant");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(consumed.errors).toEqual([]);
    expect(consumed.eventTypes).toContain("thread.message.delta");
    expect(consumed.terminalThreadIds).toContain(threadId);
    expect(chatStore$.threadsById[threadId].state.peek()).toBe("completed");
    expect(assistantMessage?.state).toBe("completed");
    expect(assistantMessage?.content.toLowerCase()).toContain("relay-live-ok");
  }, 120_000);

  it("continues a real not-loaded app-server thread through the mobile stream reducer", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-live-workspace-"));
    appServer = new CodexAppServerClient();
    let app = createApp({
      appServer,
      workspacePath,
    });

    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        runtimeMode: "full-access",
        title: "Live continuation contract",
      }),
      headers: { "content-type": "application/json" },
    });
    const createPayload = await createResponse.json();
    const threadId = createPayload.thread.id as string;

    const firstResponse = await app.request(`/v1/threads/${threadId}/runs/stream`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        prompt: "Reply with exactly: relay-live-first-ok",
        reasoningEffort: "medium",
        runtimeMode: "full-access",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(await firstResponse.text()).toContain("relay-live-first-ok");

    appServer.close();
    appServer = new CodexAppServerClient();
    app = createApp({
      appServer,
      workspacePath,
    });
    resetChatSessionState();

    const response = await app.request(`/v1/threads/${threadId}/runs/stream`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        prompt: "Reply with exactly: relay-live-second-ok",
        reasoningEffort: "medium",
        runtimeMode: "full-access",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const consumed = consumeAsMobileChatStream(body, threadId);
    const messages = chatStore$.messagesByThreadId[threadId].peek() ?? [];
    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(consumed.errors).toEqual([]);
    expect(consumed.eventTypes).toContain("thread.message.delta");
    expect(consumed.terminalThreadIds).toContain(threadId);
    expect(chatStore$.threadsById[threadId].state.peek()).toBe("completed");
    expect(assistantMessage?.state).toBe("completed");
    expect(assistantMessage?.content.toLowerCase()).toContain("relay-live-second-ok");
  }, 120_000);

  it("round-trips real Ultra delegation as mobile subagent activity", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-live-workspace-"));
    appServer = new CodexAppServerClient();
    const app = createApp({
      appServer,
      workspacePath,
    });
    let threadId: string | undefined;

    try {
      const createResponse = await app.request("/v1/threads", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          runtimeMode: "full-access",
          title: "Live Ultra delegation contract",
        }),
        headers: { "content-type": "application/json" },
      });
      const createPayload = await createResponse.json();
      threadId = createPayload.thread.id as string;

      const response = await app.request(`/v1/threads/${threadId}/runs/stream`, {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          prompt:
            "Use exactly one subagent to independently answer 17 + 25. Return only the final number.",
          reasoningEffort: "ultra",
          runtimeMode: "full-access",
        }),
        headers: { "content-type": "application/json" },
      });
      const body = await response.text();
      const consumed = consumeAsMobileChatStream(body, threadId);
      const messages = chatStore$.messagesByThreadId[threadId].peek() ?? [];
      const subagentMessages = messages.filter((message) => message.kind === "subagentAction");
      const assistantMessage = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");

      expect(response.status).toBe(200);
      expect(consumed.errors).toEqual([]);
      expect(consumed.terminalThreadIds).toContain(threadId);
      expect(subagentMessages.length).toBeGreaterThan(0);
      expect(assistantMessage?.content).toContain("42");
    } finally {
      if (threadId) {
        await app.request(`/v1/threads/${threadId}`, { method: "DELETE" });
      }
    }
  }, 240_000);
});

function consumeAsMobileChatStream(body: string, threadId: string) {
  const errors: Error[] = [];
  const eventTypes: string[] = [];
  const terminalThreadIds: string[] = [];
  const dispatcher = createThreadRunSseDispatcher({
    onEvent(event) {
      eventTypes.push(event.type);
      handleThreadRunStreamEvent(event, {
        fallbackThreadId: threadId,
        applyEvent: applyStreamEvent,
        onTerminal(terminalThreadId) {
          terminalThreadIds.push(terminalThreadId);
          setRunning(false);
        },
      });
    },
    onError(error) {
      errors.push(error);
    },
  });

  dispatcher.push(body);
  dispatcher.flush();
  return { errors, eventTypes, terminalThreadIds };
}
