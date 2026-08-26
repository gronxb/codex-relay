import {
  StreamThreadRunEventSchema,
  type QueuedThreadInput,
  type StreamThreadRunEvent,
} from "codex-relay/api-schema";

export type DecodeStreamPayload = (payload: unknown) => unknown;

export type ThreadRunStreamHandlers = {
  onEvent: (event: StreamThreadRunEvent) => void;
  onError: (error: Error) => void;
};

export type HandleThreadRunStreamEventOptions = {
  fallbackThreadId: string;
  applyEvent: (event: StreamThreadRunEvent) => void;
  onPreviewTarget?: (
    threadId: string,
    target: Extract<StreamThreadRunEvent, { type: "thread.preview_target.detected" }>["target"],
  ) => void;
  onTerminal?: (threadId: string, event: StreamThreadRunEvent) => void;
};

export type CompleteThreadRunSessionOptions = {
  clearQueuedPrompts: (threadId: string) => void;
  closeStream?: () => void;
  onSuccessfulCompletion?: () => void;
  refreshUsageStatus: (threadId: string) => void | Promise<void>;
  setQueuedInputs: (threadId: string, inputs: QueuedThreadInput[]) => void;
  setRunning: (isRunning: boolean) => void;
  terminalEvent?: StreamThreadRunEvent;
  threadId: string;
};

export const threadRunStreamEventTypes: StreamThreadRunEvent["type"][] = [
  "thread.message.created",
  "thread.message.delta",
  "thread.message.completed",
  "thread.state.changed",
  "thread.goal.updated",
  "thread.error",
  "thread.preview_target.detected",
  "thread.input_request.created",
  "thread.input_request.resolved",
];

export function createThreadRunSseDispatcher(
  handlers: ThreadRunStreamHandlers,
  decodePayload: DecodeStreamPayload = identityPayload,
) {
  let pendingChunk = "";
  let closed = false;

  return {
    push(text: string) {
      if (closed) {
        return false;
      }
      pendingChunk += text;
      const parts = pendingChunk.split(/\r?\n\r?\n/);
      pendingChunk = parts.pop() ?? "";
      for (const part of parts) {
        if (!dispatchThreadRunSseChunk(part, handlers, decodePayload)) {
          closed = true;
          return false;
        }
      }
      return true;
    },
    flush() {
      if (closed) {
        return false;
      }
      if (
        pendingChunk.trim() &&
        !dispatchThreadRunSseChunk(pendingChunk, handlers, decodePayload)
      ) {
        closed = true;
        return false;
      }
      pendingChunk = "";
      return true;
    },
  };
}

export function parseThreadRunStreamPayload(
  data: string,
  decodePayload: DecodeStreamPayload = identityPayload,
) {
  try {
    const parsed = StreamThreadRunEventSchema.safeParse(decodePayload(JSON.parse(data)));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {}

  throw new Error("Codex Relay server returned an invalid stream event.");
}

export function dispatchThreadRunSseChunk(
  chunk: string,
  handlers: ThreadRunStreamHandlers,
  decodePayload: DecodeStreamPayload = identityPayload,
) {
  const data = chunk
    .split(/\r?\n/)
    .reduce<string[]>((lines, line) => {
      if (line.startsWith("data:")) {
        lines.push(line.slice("data:".length).trimStart());
      }
      return lines;
    }, [])
    .join("\n");
  if (!data) {
    return true;
  }

  try {
    handlers.onEvent(parseThreadRunStreamPayload(data, decodePayload));
    return true;
  } catch (error) {
    handlers.onError(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

export function isTerminalThreadRunEvent(event: StreamThreadRunEvent) {
  if (event.type === "thread.error") {
    return true;
  }
  return event.type === "thread.state.changed" && event.thread.state !== "running";
}

export function isSuccessfulThreadRunTerminalEvent(event: StreamThreadRunEvent) {
  return event.type === "thread.state.changed" && event.thread.state === "completed";
}

export function reconcileThreadRunEventAfterTerminal(
  event: StreamThreadRunEvent,
  terminalEvent: StreamThreadRunEvent | undefined,
): StreamThreadRunEvent | undefined {
  if (!terminalEvent) {
    return event;
  }

  const terminalState =
    terminalEvent.type === "thread.state.changed"
      ? {
          lastError: terminalEvent.thread.lastError,
          state: terminalEvent.thread.state,
        }
      : terminalEvent.type === "thread.error"
        ? {
            lastError: terminalEvent.thread?.lastError ?? terminalEvent.error.message,
            state: terminalEvent.thread?.state ?? ("failed" as const),
          }
        : undefined;
  switch (event.type) {
    case "thread.message.created":
    case "thread.message.completed":
      return terminalState
        ? {
            ...event,
            thread: {
              ...event.thread,
              ...terminalState,
            },
          }
        : event;
    case "thread.error":
      return terminalState && event.thread
        ? {
            ...event,
            thread: {
              ...event.thread,
              ...terminalState,
            },
          }
        : event;
    default:
      return undefined;
  }
}

export function handleThreadRunStreamEvent(
  event: StreamThreadRunEvent,
  options: HandleThreadRunStreamEventOptions,
) {
  if (event.type === "thread.preview_target.detected") {
    options.onPreviewTarget?.(event.threadId, event.target);
  }
  options.applyEvent(event);
  if (isTerminalThreadRunEvent(event)) {
    const terminalThreadId =
      "thread" in event && event.thread ? event.thread.id : options.fallbackThreadId;
    options.onTerminal?.(terminalThreadId, event);
  }
}

export function completeThreadRunSession(options: CompleteThreadRunSessionOptions) {
  options.setRunning(false);
  options.clearQueuedPrompts(options.threadId);
  options.setQueuedInputs(options.threadId, []);
  if (options.terminalEvent && isSuccessfulThreadRunTerminalEvent(options.terminalEvent)) {
    options.onSuccessfulCompletion?.();
  }
  void Promise.resolve(options.refreshUsageStatus(options.threadId)).catch(() => undefined);
}

function identityPayload(payload: unknown) {
  return payload;
}
