import type {
  ChatMessage,
  QueuedThreadInput,
  ThreadDetailResponse,
  ThreadSummary,
} from "codex-relay/api-schema";
import {
  chatMessageDetailsFromPromptContext,
  promptMarkdownWithSkills,
} from "codex-relay/api-schema";

const optimisticSteeringMessageIdPrefix = "optimistic-steering:";

export function appendOptimisticSteeringMessageToDetail(
  current: ThreadDetailResponse | undefined,
  options: {
    input: QueuedThreadInput;
    nowIso: string;
    thread: ThreadSummary | undefined;
    threadId: string;
  },
): ThreadDetailResponse | undefined {
  const thread = current?.thread ?? options.thread;
  if (!thread) {
    return current;
  }
  const message: ChatMessage = {
    id: optimisticSteeringMessageId(options.input.id),
    threadId: options.threadId,
    role: "user",
    kind: "chat",
    content: promptMarkdownWithSkills(options.input.prompt, options.input.skills),
    createdAt: options.nowIso,
    details: chatMessageDetailsFromPromptContext(options.input, {
      optimisticQueuedInputId: options.input.id,
    }),
    state: "completed",
  };
  return {
    thread,
    messages: upsertMessage(current?.messages ?? [], message),
    pendingInputRequests: current?.pendingInputRequests ?? [],
  };
}

export function mergeThreadDetailState(
  current: ThreadDetailResponse | undefined,
  response: ThreadDetailResponse,
) {
  if (!current || current.thread.id !== response.thread.id) {
    return response;
  }
  const messages = mergeMessages(current.messages, response.messages);
  return {
    ...response,
    thread: preferredThreadSnapshot(current.thread, response.thread),
    messages,
  };
}

export function upsertMessage(messages: ChatMessage[], message: ChatMessage) {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex !== -1) {
    return messages.map((candidate) =>
      candidate.id === message.id ? preferredMessageSnapshot(candidate, message) : candidate,
    );
  }
  if (messages.some((candidate) => replacementMessageId(candidate) === message.id)) {
    return messages;
  }
  const replacementId = replacementMessageId(message);
  const replacementIndex = replacementId
    ? messages.findIndex((candidate) => candidate.id === replacementId)
    : -1;
  if (replacementIndex !== -1) {
    return messages.map((candidate, index) => (index === replacementIndex ? message : candidate));
  }
  const optimisticIndex =
    message.role === "user"
      ? messages.findIndex(
          (candidate) =>
            candidate.id.startsWith(optimisticSteeringMessageIdPrefix) &&
            candidate.role === "user" &&
            candidate.content === message.content,
        )
      : -1;
  if (optimisticIndex !== -1) {
    return messages.map((candidate, index) => (index === optimisticIndex ? message : candidate));
  }
  const lastMessage = messages[messages.length - 1];
  if (isDuplicateOptimisticQueuedMessage(lastMessage, message)) {
    return messages.map((candidate, index) =>
      index === messages.length - 1 ? message : candidate,
    );
  }
  return sortMessagesByCreation([...messages, message]);
}

function optimisticSteeringMessageId(inputId: string) {
  return `${optimisticSteeringMessageIdPrefix}${inputId}`;
}

function mergeMessages(baseMessages: ChatMessage[], incomingMessages: ChatMessage[]) {
  const replacedMessageIds = new Set(
    [...baseMessages, ...incomingMessages]
      .map(replacementMessageId)
      .filter((id): id is string => id !== undefined),
  );
  const baseById = new Map(baseMessages.map((message) => [message.id, message]));
  const incomingById = new Map(
    incomingMessages.map((message) => [
      message.id,
      baseById.has(message.id)
        ? preferredMessageSnapshot(baseById.get(message.id)!, message)
        : message,
    ]),
  );
  const indexesById = new Map<string, number>();
  const seenIds = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const candidate of [...baseMessages, ...incomingMessages]) {
    const message = incomingById.get(candidate.id) ?? candidate;
    if (seenIds.has(message.id) || replacedMessageIds.has(message.id)) {
      continue;
    }
    const replacementId = replacementMessageId(message);
    if (replacementId) {
      const replacementIndex = indexesById.get(replacementId);
      if (replacementIndex !== undefined) {
        messages[replacementIndex] = message;
        seenIds.delete(replacementId);
        seenIds.add(message.id);
        indexesById.delete(replacementId);
        indexesById.set(message.id, replacementIndex);
        continue;
      }
    }
    const lastMessage = messages[messages.length - 1];
    if (isDuplicateOptimisticQueuedMessage(lastMessage, message)) {
      messages[messages.length - 1] = message;
      seenIds.delete(lastMessage.id);
      seenIds.add(message.id);
      indexesById.delete(lastMessage.id);
      indexesById.set(message.id, messages.length - 1);
      continue;
    }
    seenIds.add(message.id);
    indexesById.set(message.id, messages.length);
    messages.push(message);
  }
  return sortMessagesByCreation(messages);
}

function preferredMessageSnapshot(current: ChatMessage, incoming: ChatMessage) {
  const currentUpdatedAt = current.updatedAt ?? current.createdAt;
  const incomingUpdatedAt = incoming.updatedAt ?? incoming.createdAt;
  if (currentUpdatedAt !== incomingUpdatedAt) {
    return currentUpdatedAt > incomingUpdatedAt ? current : incoming;
  }
  if (current.state === "completed" && incoming.state !== "completed") {
    return current;
  }
  return incoming;
}

export function preferredThreadSnapshot(current: ThreadSummary, incoming: ThreadSummary) {
  if (current.updatedAt !== incoming.updatedAt) {
    return current.updatedAt > incoming.updatedAt ? current : incoming;
  }
  if (current.state !== "running" && incoming.state === "running") {
    return current;
  }
  return incoming;
}

function sortMessagesByCreation(messages: ChatMessage[]) {
  return messages
    .map((message, index) => ({ index, message }))
    .sort(
      (left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) || left.index - right.index,
    )
    .map(({ message }) => message);
}

function isDuplicateOptimisticQueuedMessage(
  previous: ChatMessage | undefined,
  incoming: ChatMessage,
) {
  return (
    previous?.id.startsWith(optimisticSteeringMessageIdPrefix) === true &&
    previous.threadId === incoming.threadId &&
    previous.role === incoming.role &&
    previous.content === incoming.content
  );
}

function replacementMessageId(message: ChatMessage) {
  const replacementId = message.details?.replacesMessageId;
  return typeof replacementId === "string" && replacementId.length > 0 ? replacementId : undefined;
}
