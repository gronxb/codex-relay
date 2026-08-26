import type { ListThreadsResponse } from "codex-relay/api-schema";
import type { QueryClient } from "@tanstack/react-query";

import { serverStateKeys } from "@/lib/server-state";
import { chatStore$, setActiveThread } from "@/state/chat-store";

let hydratedDefaultThreadId: string | undefined;

export function restoreChatStoreFromQueryCache(queryClient: QueryClient) {
  const threads = queryClient.getQueryData<ListThreadsResponse>(serverStateKeys.threads());
  if (!chatStore$.activeThreadId.peek() && threads?.threads[0]) {
    hydratedDefaultThreadId = threads.threads[0].id;
    setActiveThread(threads.threads[0].id);
  }
}

export function consumeHydratedDefaultThread(threadId: string | undefined) {
  const wasHydratedDefault = Boolean(threadId && threadId === hydratedDefaultThreadId);
  hydratedDefaultThreadId = undefined;
  return wasHydratedDefault;
}
