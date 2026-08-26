import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedThreadInput, StreamThreadRunEvent, ThreadSummary } from "../src/api-schema.js";

import { createApp } from "../src/app.js";
import {
  applyStreamEvent,
  chatStore$,
  clearQueuedPrompts,
  replaceThreads,
  resetChatSessionState,
  setActiveThread,
  setRunning,
} from "../../../apps/mobile/src/state/chat-store.js";
import {
  completeThreadRunSession,
  createThreadRunSseDispatcher,
  handleThreadRunStreamEvent,
  reconcileThreadRunEventAfterTerminal,
  threadRunStreamEventTypes,
} from "../../../apps/mobile/src/lib/thread-run-stream.js";

describe("mobile stream contract", () => {
  beforeEach(() => {
    resetChatSessionState();
  });

  it("subscribes to pending input request events on named SSE streams", () => {
    expect(threadRunStreamEventTypes).toContain("thread.input_request.created");
    expect(threadRunStreamEventTypes).toContain("thread.input_request.resolved");
  });

  it("feeds server SSE through the same mobile parser and chat reducer used by the app", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-mobile-contract",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Mobile contract",
        preview: "Mobile contract",
        source: "app",
        status: { type: "idle" },
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "thread/status/changed",
              params: { status: { type: "active" }, threadId: "app-thread-mobile-contract" },
            });
            handler({
              method: "turn/started",
              params: {
                threadId: "app-thread-mobile-contract",
                turn: {
                  id: "turn-mobile-contract",
                  status: "inProgress",
                  startedAt: now,
                  completedAt: null,
                },
              },
            });
            handler({
              method: "item/started",
              params: {
                item: { id: "assistant-mobile-contract", text: "", type: "agentMessage" },
                threadId: "app-thread-mobile-contract",
                turnId: "turn-mobile-contract",
              },
            });
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "hi",
                itemId: "assistant-mobile-contract",
                threadId: "app-thread-mobile-contract",
                turnId: "turn-mobile-contract",
              },
            });
            handler({
              method: "item/completed",
              params: {
                item: { id: "assistant-mobile-contract", text: "hi", type: "agentMessage" },
                threadId: "app-thread-mobile-contract",
                turnId: "turn-mobile-contract",
              },
            });
            handler({
              method: "thread/status/changed",
              params: { status: { type: "idle" }, threadId: "app-thread-mobile-contract" },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-mobile-contract",
                turn: {
                  id: "turn-mobile-contract",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-mobile-contract",
          items: [],
          status: "inProgress",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Mobile contract" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-mobile-contract/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Reply with hi" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const terminalIndex = body.indexOf('"state":"completed"');
    const assistantIndex = body.indexOf("assistant-mobile-contract");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(assistantIndex).toBeGreaterThan(-1);
    expect(terminalIndex).toBeGreaterThan(assistantIndex);

    const consumed = consumeAsMobileChatStream(body, "app-thread-mobile-contract");
    expect(consumed.errors).toEqual([]);
    expect(consumed.eventTypes).toContain("thread.message.delta");
    expect(consumed.terminalThreadIds).toContain("app-thread-mobile-contract");

    const messages = chatStore$.messagesByThreadId["app-thread-mobile-contract"].peek() ?? [];
    expect(chatStore$.threadsById["app-thread-mobile-contract"].state.peek()).toBe("completed");
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Reply with hi"],
      ["assistant", "hi"],
    ]);
    expect(messages.find((message) => message.role === "assistant")?.state).toBe("completed");
  });

  it("does not duplicate image prompt user messages when app-server echoes the turn item", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const imagePath = join(workspacePath, "screenshot.png");
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-image-contract",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Image contract",
        preview: "Image contract",
        source: "app",
        status: { type: "idle" },
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "thread/status/changed",
              params: { status: { type: "active" }, threadId: "app-thread-image-contract" },
            });
            handler({
              method: "turn/started",
              params: {
                threadId: "app-thread-image-contract",
                turn: {
                  id: "turn-image-contract",
                  status: "inProgress",
                  startedAt: now,
                  completedAt: null,
                },
              },
            });
            handler({
              method: "item/started",
              params: {
                item: {
                  id: "user-image-contract",
                  type: "userMessage",
                  content: [
                    { type: "text", text: "Describe this image", text_elements: [] },
                    { type: "localImage", path: imagePath },
                  ],
                },
                threadId: "app-thread-image-contract",
                turnId: "turn-image-contract",
              },
            });
            handler({
              method: "item/completed",
              params: {
                item: {
                  id: "assistant-image-contract",
                  text: "image noted",
                  type: "agentMessage",
                },
                threadId: "app-thread-image-contract",
                turnId: "turn-image-contract",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-image-contract",
                turn: {
                  id: "turn-image-contract",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-image-contract",
          items: [],
          status: "inProgress",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Image contract" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-image-contract/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        attachments: [
          {
            mimeType: "image/png",
            name: "screenshot.png",
            path: imagePath,
            type: "image",
          },
        ],
        prompt: "Describe this image",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const consumed = consumeAsMobileChatStream(body, "app-thread-image-contract");
    const messages = chatStore$.messagesByThreadId["app-thread-image-contract"].peek() ?? [];
    const userMessages = messages.filter((message) => message.role === "user");

    expect(response.status).toBe(200);
    expect(consumed.errors).toEqual([]);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toContain("Describe this image");
    expect(userMessages[0]?.content).toContain("Attached image 1");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("keeps app-server modelProvider out of one-word mobile replies", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        const notifications = [
          {
            method: "item/agentMessage/delta",
            params: {
              delta: "hello",
              itemId: "assistant-provider-contract",
              threadId: "app-thread-provider-contract",
              turnId: "turn-provider-contract",
            },
          },
          {
            method: "item/completed",
            params: {
              item: { id: "assistant-provider-contract", text: "hello", type: "agentMessage" },
              threadId: "app-thread-provider-contract",
              turnId: "turn-provider-contract",
            },
          },
          {
            method: "turn/completed",
            params: {
              threadId: "app-thread-provider-contract",
              turn: {
                id: "turn-provider-contract",
                items: [],
                status: "completed",
                error: null,
                startedAt: now,
                completedAt: now,
                durationMs: 1,
              },
            },
          },
        ];
        for (const notification of notifications) {
          for (const handler of notificationHandlers) {
            handler(notification);
          }
        }
      });
      return {
        id: "turn-provider-contract",
        items: [],
        status: "inProgress",
        startedAt: now,
        completedAt: null,
      };
    });
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-provider-contract",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "openai",
        name: "Provider contract",
        preview: "Provider contract",
        source: "app",
        status: { type: "idle" },
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      workspacePath,
    });

    await app.request("/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        model: "gpt-5.5",
        reasoningEffort: "medium",
        runtimeMode: "default",
      }),
      headers: { "content-type": "application/json" },
    });
    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Provider contract" }),
      headers: { "content-type": "application/json" },
    });
    const createBody = await createResponse.json();
    const response = await app.request("/v1/threads/app-thread-provider-contract/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const consumed = consumeAsMobileChatStream(body, "app-thread-provider-contract");

    expect(createResponse.status).toBe(201);
    expect(createBody.thread).not.toHaveProperty("model");
    expect(response.status).toBe(200);
    expect(body).not.toContain("event: thread.error");
    expect(body).not.toContain("'openai' model");
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: "medium",
        model: "gpt-5.5",
      }),
    );
    expect(startTurn).not.toHaveBeenCalledWith(expect.objectContaining({ model: "openai" }));
    expect(consumed.errors).toEqual([]);
    expect(consumed.eventTypes).toContain("thread.message.delta");
    expect(consumed.terminalThreadIds).toContain("app-thread-provider-contract");

    const messages = chatStore$.messagesByThreadId["app-thread-provider-contract"].peek() ?? [];
    expect(chatStore$.threadsById["app-thread-provider-contract"].state.peek()).toBe("completed");
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "hi"],
      ["assistant", "hello"],
    ]);
  });

  it("completes terminal stream state without client-aborting the server-owned stream", () => {
    const closeStream = vi.fn<() => void>();
    const refreshUsageStatus = vi.fn<(threadId: string) => void>();
    const setQueuedInputs = vi.fn<(threadId: string, inputs: QueuedThreadInput[]) => void>();
    const setRunningSpy = vi.fn<(isRunning: boolean) => void>((isRunning) => setRunning(isRunning));
    replaceThreads([
      {
        id: "thread-terminal",
        title: "Terminal",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        state: "idle",
        messageCount: 0,
      },
    ]);
    setActiveThread("thread-terminal");
    setRunning(true);

    completeThreadRunSession({
      threadId: "thread-terminal",
      clearQueuedPrompts,
      closeStream,
      refreshUsageStatus,
      setQueuedInputs,
      setRunning: setRunningSpy,
    });

    expect(closeStream).not.toHaveBeenCalled();
    expect(setRunningSpy).toHaveBeenCalledWith(false);
    expect(chatStore$.threadsById["thread-terminal"].state.peek()).toBe("completed");
    expect(setQueuedInputs).toHaveBeenCalledWith("thread-terminal", []);
    expect(refreshUsageStatus).toHaveBeenCalledWith("thread-terminal");
  });

  it("applies authoritative snapshots after terminal without reopening the thread", () => {
    const failedThread = threadSummary("thread-post-terminal", "failed");
    const terminalEvent = {
      type: "thread.state.changed",
      thread: failedThread,
    } satisfies StreamThreadRunEvent;
    const staleRunningThread = {
      ...failedThread,
      lastError: undefined,
      state: "running" as const,
      updatedAt: "2026-04-29T00:00:01.000Z",
    };
    const errorMessageEvent = {
      type: "thread.message.created",
      thread: staleRunningThread,
      message: {
        content: "The turn failed.",
        createdAt: "2026-04-29T00:00:01.000Z",
        id: "error-post-terminal",
        kind: "chat",
        role: "error",
        state: "failed",
        threadId: failedThread.id,
        updatedAt: "2026-04-29T00:00:01.000Z",
      },
    } satisfies StreamThreadRunEvent;
    const lateItemEvent = {
      type: "thread.message.completed",
      thread: staleRunningThread,
      message: {
        content: "late command output",
        createdAt: "2026-04-29T00:00:02.000Z",
        id: "command-post-terminal",
        kind: "commandExecution",
        role: "tool",
        state: "completed",
        threadId: failedThread.id,
        updatedAt: "2026-04-29T00:00:02.000Z",
      },
    } satisfies StreamThreadRunEvent;
    const errorEvent = {
      type: "thread.error",
      thread: staleRunningThread,
      error: { code: "codex_run_failed", message: "The turn failed." },
    } satisfies StreamThreadRunEvent;

    replaceThreads([failedThread]);
    setActiveThread(failedThread.id);
    const consumed = consumeTerminalSequenceAsMobileChatScreen([
      terminalEvent,
      errorMessageEvent,
      errorEvent,
      lateItemEvent,
      { type: "thread.state.changed", thread: staleRunningThread },
      {
        type: "thread.message.delta",
        threadId: failedThread.id,
        messageId: "command-post-terminal",
        delta: "stale",
      },
    ]);

    expect(consumed.appliedEventTypes).toEqual([
      "thread.state.changed",
      "thread.message.created",
      "thread.error",
      "thread.message.completed",
    ]);
    expect(consumed.terminalThreadIds).toEqual([failedThread.id]);
    expect(
      consumed.appliedEvents
        .filter((event) => "thread" in event && event.thread)
        .map((event) => ("thread" in event ? event.thread?.state : undefined)),
    ).toEqual(["failed", "failed", "failed", "failed"]);
    expect(
      (chatStore$.messagesByThreadId[failedThread.id].peek() ?? []).map((message) => [
        message.role,
        message.content,
      ]),
    ).toEqual([
      ["error", "The turn failed."],
      ["tool", "late command output"],
    ]);
  });
});

function threadSummary(id: string, state: ThreadSummary["state"]): ThreadSummary {
  return {
    createdAt: "2026-04-29T00:00:00.000Z",
    id,
    lastError: state === "failed" ? "The turn failed." : undefined,
    messageCount: 0,
    state,
    title: id,
    updatedAt: "2026-04-29T00:00:00.000Z",
  };
}

function consumeTerminalSequenceAsMobileChatScreen(events: StreamThreadRunEvent[]) {
  const appliedEvents: StreamThreadRunEvent[] = [];
  const appliedEventTypes: StreamThreadRunEvent["type"][] = [];
  const terminalThreadIds: string[] = [];
  let terminalEvent: StreamThreadRunEvent | undefined;

  for (const event of events) {
    const reconciledEvent = reconcileThreadRunEventAfterTerminal(event, terminalEvent);
    if (!reconciledEvent) {
      continue;
    }
    handleThreadRunStreamEvent(reconciledEvent, {
      fallbackThreadId: "thread-post-terminal",
      applyEvent(streamEvent) {
        appliedEvents.push(streamEvent);
        appliedEventTypes.push(streamEvent.type);
        applyStreamEvent(streamEvent);
      },
      onTerminal(threadId, streamEvent) {
        if (terminalEvent) {
          return;
        }
        terminalEvent = streamEvent;
        terminalThreadIds.push(threadId);
      },
    });
  }

  return { appliedEvents, appliedEventTypes, terminalThreadIds };
}

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
          completeThreadRunSession({
            threadId: terminalThreadId,
            clearQueuedPrompts,
            refreshUsageStatus: () => undefined,
            setQueuedInputs: () => undefined,
            setRunning,
          });
        },
      });
    },
    onError(error) {
      errors.push(error);
    },
  });

  for (let index = 0; index < body.length; index += 7) {
    dispatcher.push(body.slice(index, index + 7));
  }
  dispatcher.flush();

  return { errors, eventTypes, terminalThreadIds };
}
