import { observable } from "@legendapp/state";

import { persistLocalObservable } from "./persistence";

type PinnedThreadState = {
  threadIds: string[];
};

export const pinnedThreadStore$ = observable<PinnedThreadState>({
  threadIds: [],
});

persistLocalObservable(pinnedThreadStore$, "pinned-threads");

export function getPinnedThreadIds(): readonly string[] {
  return [...pinnedThreadStore$.threadIds.peek()];
}

export function pinThread(threadId: string) {
  pinnedThreadStore$.threadIds.set((current) => {
    if (current.includes(threadId)) {
      return current;
    }

    return [threadId, ...current];
  });
}

export function unpinThread(threadId: string) {
  pinnedThreadStore$.threadIds.set((current) => {
    if (!current.includes(threadId)) {
      return current;
    }

    return current.filter((candidate) => candidate !== threadId);
  });
}

export function togglePinnedThread(threadId: string) {
  if (pinnedThreadStore$.threadIds.peek().includes(threadId)) {
    unpinThread(threadId);
    return;
  }

  pinThread(threadId);
}

export function resetPinnedThreadState() {
  pinnedThreadStore$.set({ threadIds: [] });
}
