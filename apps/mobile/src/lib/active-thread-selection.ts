import type { ThreadSummary } from "codex-relay/api-schema";

export function activeThreadAfterRefresh({
  currentActiveThreadId,
  missingActiveThreadRestored,
  preferFirstThread = false,
  threads,
}: {
  currentActiveThreadId: string | undefined;
  missingActiveThreadRestored: boolean;
  preferFirstThread?: boolean;
  threads: ThreadSummary[];
}) {
  if (preferFirstThread && threads[0]) {
    return threads[0].id;
  }
  if (
    currentActiveThreadId &&
    (missingActiveThreadRestored || threads.some((thread) => thread.id === currentActiveThreadId))
  ) {
    return currentActiveThreadId;
  }

  return threads[0]?.id;
}
