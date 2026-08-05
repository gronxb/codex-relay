import type { ThreadSummary } from "codex-relay/api-schema";

import { workspaceName } from "../../lib/workspace-name";

const collapsedProjectThreadCount = 5;

export type DrawerRow =
  | { id: "pinned"; kind: "pinned" }
  | {
      id: string;
      kind: "project";
      projectKey: string;
      title: string;
      workspacePath?: string;
    }
  | { id: string; kind: "thread"; projectKey: string; thread: ThreadSummary }
  | { id: string; kind: "more"; hiddenCount: number; projectKey: string };

type ThreadGroup = {
  title: string;
  threads: ThreadSummary[];
  workspacePath?: string;
};

export function buildDrawerRows(
  threads: ThreadSummary[],
  expandedProjects: Record<string, boolean>,
  activeThreadId: string | undefined,
  pinnedThreadIds: string[] = [],
  forceExpanded = false,
): DrawerRow[] {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const pinnedThreads = forceExpanded
    ? []
    : pinnedThreadIds.reduce<ThreadSummary[]>((result, threadId) => {
        const thread = threadsById.get(threadId);
        if (thread && !result.includes(thread)) {
          result.push(thread);
        }
        return result;
      }, []);
  const pinnedThreadIdsSet = new Set(pinnedThreads.map((thread) => thread.id));
  const groups = new Map<string, ThreadGroup>();

  for (const thread of threads) {
    const title = workspaceName(thread.cwd) ?? "codex-relay";
    const projectKey = thread.cwd ?? title;
    const group = groups.get(projectKey);
    if (group) {
      group.threads.push(thread);
    } else {
      groups.set(projectKey, { title, threads: [thread], workspacePath: thread.cwd });
    }
  }

  const rows: DrawerRow[] = [];
  if (pinnedThreads.length > 0) {
    rows.push({ id: "pinned", kind: "pinned" });
    rows.push(...pinnedThreads.map((thread) => threadRow(thread, projectKeyForThread(thread))));
  }

  for (const [projectKey, group] of groups) {
    const unpinnedThreads = forceExpanded
      ? group.threads
      : group.threads.filter((thread) => !pinnedThreadIdsSet.has(thread.id));
    const isExpanded = forceExpanded || (expandedProjects[projectKey] ?? false);
    const activeThread = activeThreadId
      ? unpinnedThreads.find((thread) => thread.id === activeThreadId)
      : undefined;
    const collapsedThreads = unpinnedThreads.slice(0, collapsedProjectThreadCount);
    const visibleThreads =
      isExpanded || !activeThread || collapsedThreads.includes(activeThread)
        ? isExpanded
          ? unpinnedThreads
          : collapsedThreads
        : [...collapsedThreads.slice(0, collapsedProjectThreadCount - 1), activeThread];
    const hiddenCount = unpinnedThreads.length - visibleThreads.length;

    rows.push({
      id: `project:${projectKey}`,
      kind: "project",
      projectKey,
      title: group.title,
      workspacePath: group.workspacePath,
    });
    rows.push(...visibleThreads.map((thread) => threadRow(thread, projectKey)));

    if (hiddenCount > 0) {
      rows.push({
        id: `more:${projectKey}`,
        kind: "more",
        hiddenCount,
        projectKey,
      });
    }
  }

  return rows;
}

function projectKeyForThread(thread: ThreadSummary) {
  const title = workspaceName(thread.cwd) ?? "codex-relay";
  return thread.cwd ?? title;
}

function threadRow(thread: ThreadSummary, projectKey: string): DrawerRow {
  return {
    id: `thread:${thread.id}`,
    kind: "thread",
    projectKey,
    thread,
  };
}
