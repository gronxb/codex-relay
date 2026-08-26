import { describe, expect, it } from "vitest";
import type { ChatMessage, QueuedThreadInput, ThreadSummary } from "../src/api-schema.js";

import {
  appendOptimisticSteeringMessageToDetail,
  mergeThreadDetailState,
  upsertMessage,
} from "../../../apps/mobile/src/lib/server-state-messages.js";

describe("mobile optimistic queued-input steering state", () => {
  it("shows a steered queued prompt immediately when thread detail is not cached", async () => {
    const thread = threadSummary("thread-steering");
    const input = queuedInput("queued-goal", "/goal Add tests before editing");

    const detail = appendOptimisticSteeringMessageToDetail(undefined, {
      input,
      nowIso: "2026-06-06T00:00:00.000Z",
      thread,
      threadId: thread.id,
    });

    expect(detail?.thread.id).toBe(thread.id);
    expect(detail?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", input.prompt],
    ]);
  });

  it("replaces the optimistic steering prompt when stream and refresh data arrive", async () => {
    const thread = threadSummary("thread-steering-merge");
    const input = queuedInput("queued-merge", "/goal Keep one message");
    const canonicalMessage = chatMessage("server-user", thread.id, input.prompt);
    const optimisticDetail = appendOptimisticSteeringMessageToDetail(undefined, {
      input,
      nowIso: "2026-06-06T00:00:00.000Z",
      thread,
      threadId: thread.id,
    });

    const streamedMessages = upsertMessage(optimisticDetail?.messages ?? [], canonicalMessage);
    const refreshedDetail = mergeThreadDetailState(
      { thread, messages: streamedMessages, pendingInputRequests: [] },
      { thread, messages: [canonicalMessage], pendingInputRequests: [] },
    );

    expect(refreshedDetail.messages).toHaveLength(1);
    expect(refreshedDetail.messages[0]).toMatchObject({
      content: input.prompt,
      id: canonicalMessage.id,
      role: "user",
    });
  });

  it("does not let a late thread snapshot replace a completed streamed message", () => {
    const completedThread = {
      ...threadSummary("thread-late-snapshot"),
      state: "completed" as const,
      updatedAt: "2026-06-06T00:00:03.000Z",
    };
    const staleThread = {
      ...completedThread,
      state: "running" as const,
      updatedAt: "2026-06-06T00:00:01.000Z",
    };
    const completedMessage = {
      ...chatMessage("assistant-late-snapshot", completedThread.id, "Hello world"),
      role: "assistant" as const,
      state: "completed" as const,
      updatedAt: "2026-06-06T00:00:03.000Z",
    };
    const staleMessage = {
      ...completedMessage,
      content: "Hello",
      state: "streaming" as const,
      updatedAt: "2026-06-06T00:00:01.000Z",
    };

    const merged = mergeThreadDetailState(
      {
        thread: completedThread,
        messages: [completedMessage],
        pendingInputRequests: [],
      },
      { thread: staleThread, messages: [staleMessage], pendingInputRequests: [] },
    );

    expect(merged.thread).toMatchObject({ state: "completed" });
    expect(merged.messages).toEqual([completedMessage]);
  });

  it("does not reopen a terminal thread whose message cache is still empty", () => {
    const completedThread = {
      ...threadSummary("thread-empty-terminal"),
      state: "completed" as const,
      updatedAt: "2026-06-06T00:00:03.000Z",
    };
    const staleRunningThread = {
      ...completedThread,
      state: "running" as const,
      updatedAt: "2026-06-06T00:00:01.000Z",
    };

    const merged = mergeThreadDetailState(
      { thread: completedThread, messages: [], pendingInputRequests: [] },
      { thread: staleRunningThread, messages: [], pendingInputRequests: [] },
    );

    expect(merged.thread.state).toBe("completed");
  });

  it("sorts late-created messages by their server creation time", () => {
    const thread = threadSummary("thread-message-order");
    const newer = {
      ...chatMessage("message-newer", thread.id, "newer"),
      createdAt: "2026-06-06T00:00:02.000Z",
    };
    const older = {
      ...chatMessage("message-older", thread.id, "older"),
      createdAt: "2026-06-06T00:00:01.000Z",
    };

    expect(upsertMessage([newer], older).map((message) => message.id)).toEqual([
      "message-older",
      "message-newer",
    ]);
  });

  it("does not regress a completed message when its creation event is replayed", () => {
    const thread = threadSummary("thread-replayed-message");
    const completed = {
      ...chatMessage("assistant-replayed", thread.id, "Final answer"),
      role: "assistant" as const,
      state: "completed" as const,
      updatedAt: "2026-06-06T00:00:03.000Z",
    };
    const replayedCreation = {
      ...completed,
      content: "",
      state: "streaming" as const,
      updatedAt: "2026-06-06T00:00:01.000Z",
    };

    expect(upsertMessage([completed], replayedCreation)).toEqual([completed]);
  });

  it("does not restore a local message after its canonical replacement arrives", () => {
    const thread = threadSummary("thread-replacement-replay");
    const localMessage = chatMessage("local-user", thread.id, "Keep one copy");
    const canonicalMessage = {
      ...chatMessage("canonical-user", thread.id, "Keep one copy"),
      details: { replacesMessageId: localMessage.id },
    };
    const canonicalDetail = {
      thread,
      messages: [canonicalMessage],
      pendingInputRequests: [],
    };

    expect(upsertMessage([canonicalMessage], localMessage)).toEqual([canonicalMessage]);
    expect(
      mergeThreadDetailState(canonicalDetail, {
        thread,
        messages: [localMessage],
        pendingInputRequests: [],
      }).messages,
    ).toEqual([canonicalMessage]);
  });
});

function threadSummary(id: string): ThreadSummary {
  const now = "2026-06-06T00:00:00.000Z";
  return {
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    state: "running",
    messageCount: 0,
  };
}

function queuedInput(id: string, prompt: string): QueuedThreadInput {
  return {
    attachments: [],
    id,
    prompt,
    skills: [],
  };
}

function chatMessage(id: string, threadId: string, content: string): ChatMessage {
  return {
    id,
    threadId,
    role: "user",
    kind: "chat",
    content,
    createdAt: "2026-06-06T00:00:00.000Z",
    state: "completed",
  };
}
