import type { ThreadSummary } from "codex-relay/api-schema";

export function activeThreadAfterRefresh({
  currentActiveThreadId,
  missingActiveThreadRestored,
  threads,
}: {
  currentActiveThreadId: string | undefined;
  missingActiveThreadRestored: boolean;
  threads: ThreadSummary[];
}) {
  if (
    currentActiveThreadId &&
    (missingActiveThreadRestored || threads.some((thread) => thread.id === currentActiveThreadId))
  ) {
    return currentActiveThreadId;
  }

  return threads[0]?.id;
}
