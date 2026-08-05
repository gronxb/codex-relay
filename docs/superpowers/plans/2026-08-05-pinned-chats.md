# Pinned Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locally persisted pinned chats to the mobile conversation drawer, with a dedicated `Pinned` section and pin controls in the existing chat actions sheet.

**Architecture:** Store an ordered device-local list of thread IDs in a dedicated Legend State observable persisted through the existing MMKV adapter. Move drawer row construction into a pure tested module, then connect the persisted state to `ThreadDrawerContent` without changing Relay APIs or shared schemas.

**Tech Stack:** TypeScript, React Native, Legend State, MMKV, TanStack Query, Vitest, Lucide icons

---

### Task 1: Persist pinned thread IDs locally

**Files:**

- Create: `apps/mobile/src/state/pinned-thread-store.ts`
- Create: `packages/codex-relay/test/mobile-pinned-thread-store.test.ts`

- [ ] **Step 1: Write the failing store tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  getPinnedThreadIds,
  pinThread,
  resetPinnedThreadState,
  unpinThread,
} from "../../../apps/mobile/src/state/pinned-thread-store.js";

describe("mobile pinned thread store", () => {
  beforeEach(() => {
    resetPinnedThreadState();
  });

  it("keeps the most recently pinned thread first", () => {
    pinThread("thread-a");
    pinThread("thread-b");

    expect(getPinnedThreadIds()).toEqual(["thread-b", "thread-a"]);
  });

  it("does not duplicate an existing pin", () => {
    pinThread("thread-a");
    pinThread("thread-a");

    expect(getPinnedThreadIds()).toEqual(["thread-a"]);
  });

  it("removes only the selected pin", () => {
    pinThread("thread-a");
    pinThread("thread-b");

    unpinThread("thread-b");

    expect(getPinnedThreadIds()).toEqual(["thread-a"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-pinned-thread-store.test.ts
```

Expected: FAIL because `pinned-thread-store.ts` does not exist.

- [ ] **Step 3: Implement the minimal persisted store**

```ts
import { observable } from "@legendapp/state";

import { persistLocalObservable } from "./persistence";

type PinnedThreadState = {
  threadIds: string[];
};

export const pinnedThreadStore$ = observable<PinnedThreadState>(createDefaultPinnedThreadState());

persistLocalObservable(pinnedThreadStore$, "pinned-threads");

export function getPinnedThreadIds() {
  return pinnedThreadStore$.threadIds.peek();
}

export function pinThread(threadId: string) {
  pinnedThreadStore$.threadIds.set((current) =>
    current.includes(threadId) ? current : [threadId, ...current],
  );
}

export function unpinThread(threadId: string) {
  pinnedThreadStore$.threadIds.set((current) => {
    const next = current.filter((candidate) => candidate !== threadId);
    return next.length === current.length ? current : next;
  });
}

export function resetPinnedThreadState() {
  pinnedThreadStore$.set(createDefaultPinnedThreadState());
}

function createDefaultPinnedThreadState(): PinnedThreadState {
  return { threadIds: [] };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-pinned-thread-store.test.ts
```

Expected: 3 tests pass with no warnings.

- [ ] **Step 5: Commit the store**

```bash
git add apps/mobile/src/state/pinned-thread-store.ts packages/codex-relay/test/mobile-pinned-thread-store.test.ts
git commit -m "feat: persist pinned chats locally"
```

### Task 2: Build pinned drawer rows without duplicates

**Files:**

- Create: `apps/mobile/src/components/chat/thread-drawer-rows.ts`
- Create: `packages/codex-relay/test/mobile-thread-drawer-rows.test.ts`
- Modify: `apps/mobile/src/components/chat/ThreadDrawerContent.tsx:76-88,267-276,1406-1470`

- [ ] **Step 1: Write the failing row-builder tests**

```ts
import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../src/api-schema.js";

import { buildDrawerRows } from "../../../apps/mobile/src/components/chat/thread-drawer-rows.js";

describe("mobile thread drawer rows", () => {
  it("shows pinned chats once in pinned order above workspace groups", () => {
    const threads = [thread("thread-a"), thread("thread-b"), thread("thread-c")];

    const rows = buildDrawerRows(threads, {}, undefined, ["thread-b", "thread-a"]);

    expect(rows.map((row) => row.id)).toEqual([
      "pinned",
      "thread:thread-b",
      "thread:thread-a",
      "project:/workspace/alpha",
      "thread:thread-c",
    ]);
  });

  it("keeps a workspace header when all of its chats are pinned", () => {
    const rows = buildDrawerRows([thread("thread-a"), thread("thread-b")], {}, undefined, [
      "thread-b",
      "thread-a",
    ]);

    expect(rows.at(-1)).toMatchObject({
      id: "project:/workspace/alpha",
      kind: "project",
    });
  });

  it("omits unavailable pinned IDs without deleting available pins", () => {
    const rows = buildDrawerRows([thread("thread-a")], {}, undefined, ["missing", "thread-a"]);

    expect(rows.map((row) => row.id)).toEqual([
      "pinned",
      "thread:thread-a",
      "project:/workspace/alpha",
    ]);
  });

  it("counts hidden unpinned chats independently from pinned chats", () => {
    const threads = Array.from({ length: 7 }, (_, index) => thread(`thread-${index + 1}`));

    const rows = buildDrawerRows(threads, {}, undefined, ["thread-1"]);

    expect(rows.filter((row) => row.kind === "thread")).toHaveLength(6);
    expect(rows.find((row) => row.kind === "more")).toMatchObject({ hiddenCount: 1 });
  });

  it("uses normal expanded workspace results while searching", () => {
    const rows = buildDrawerRows(
      [thread("thread-a"), thread("thread-b")],
      {},
      undefined,
      ["thread-a"],
      true,
    );

    expect(rows.map((row) => row.id)).toEqual([
      "project:/workspace/alpha",
      "thread:thread-a",
      "thread:thread-b",
    ]);
  });

  it("keeps an active collapsed chat visible", () => {
    const threads = Array.from({ length: 7 }, (_, index) => thread(`thread-${index + 1}`));

    const rows = buildDrawerRows(threads, {}, "thread-7");
    const visibleThreadIds = rows
      .filter((row) => row.kind === "thread")
      .map((row) => row.thread.id);

    expect(visibleThreadIds).toEqual(["thread-1", "thread-2", "thread-3", "thread-4", "thread-7"]);
    expect(rows.find((row) => row.kind === "more")).toMatchObject({ hiddenCount: 2 });
  });
});

function thread(id: string): ThreadSummary {
  return {
    id,
    title: id,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    state: "completed",
    cwd: "/workspace/alpha",
    messageCount: 0,
  };
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-thread-drawer-rows.test.ts
```

Expected: FAIL because `thread-drawer-rows.ts` does not exist.

- [ ] **Step 3: Implement the pure row builder**

```ts
import type { ThreadSummary } from "codex-relay/api-schema";

import { workspaceName } from "@/lib/workspace-name";

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

export function buildDrawerRows(
  threads: ThreadSummary[],
  expandedProjects: Record<string, boolean>,
  activeThreadId: string | undefined,
  pinnedThreadIds: string[] = [],
  forceExpanded = false,
): DrawerRow[] {
  const groups = new Map<
    string,
    { title: string; threads: ThreadSummary[]; workspacePath?: string }
  >();
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const pinnedThreads = forceExpanded
    ? []
    : pinnedThreadIds
        .map((threadId) => threadsById.get(threadId))
        .filter((thread): thread is ThreadSummary => Boolean(thread));
  const displayedPinnedIds = new Set(pinnedThreads.map((thread) => thread.id));

  for (const thread of threads) {
    const project = projectDetails(thread);
    const group = groups.get(project.key);
    if (group) {
      group.threads.push(thread);
    } else {
      groups.set(project.key, {
        title: project.title,
        threads: [thread],
        workspacePath: project.workspacePath,
      });
    }
  }

  const rows: DrawerRow[] = [];
  if (pinnedThreads.length > 0) {
    rows.push(
      { id: "pinned", kind: "pinned" },
      ...pinnedThreads.map((thread) => ({
        id: `thread:${thread.id}`,
        kind: "thread" as const,
        projectKey: projectDetails(thread).key,
        thread,
      })),
    );
  }

  for (const [projectKey, group] of groups) {
    const projectThreads = forceExpanded
      ? group.threads
      : group.threads.filter((thread) => !displayedPinnedIds.has(thread.id));
    const isExpanded = forceExpanded || (expandedProjects[projectKey] ?? false);
    const activeThread = activeThreadId
      ? projectThreads.find((thread) => thread.id === activeThreadId)
      : undefined;
    const collapsedThreads = projectThreads.slice(0, collapsedProjectThreadCount);
    const visibleThreads =
      isExpanded || !activeThread || collapsedThreads.includes(activeThread)
        ? isExpanded
          ? projectThreads
          : collapsedThreads
        : [...collapsedThreads.slice(0, collapsedProjectThreadCount - 1), activeThread];
    const hiddenCount = projectThreads.length - visibleThreads.length;

    rows.push(
      {
        id: `project:${projectKey}`,
        kind: "project",
        projectKey,
        title: group.title,
        workspacePath: group.workspacePath,
      },
      ...visibleThreads.map((thread) => ({
        id: `thread:${thread.id}`,
        kind: "thread" as const,
        projectKey,
        thread,
      })),
    );

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

function projectDetails(thread: ThreadSummary) {
  const title = workspaceName(thread.cwd) ?? "codex-relay";
  return {
    key: thread.cwd ?? title,
    title,
    workspacePath: thread.cwd,
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-thread-drawer-rows.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Replace the inline row builder with the tested module**

Add the import and keep the existing `workspaceName` import because it is also used by the workspace picker:

```ts
import { buildDrawerRows, type DrawerRow } from "./thread-drawer-rows";
```

Delete the local `DrawerRow` union, `collapsedProjectThreadCount`, and `buildDrawerRows` function from `ThreadDrawerContent.tsx`. Update the call so search remains the fifth `forceExpanded` argument until persisted state is connected in Task 3:

```ts
const rows = useMemo(
  () =>
    buildDrawerRows(
      visibleThreads,
      expandedProjects,
      activeThreadId,
      [],
      Boolean(normalizedSearchQuery),
    ),
  [activeThreadId, expandedProjects, normalizedSearchQuery, visibleThreads],
);
```

- [ ] **Step 6: Verify the refactor**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-thread-drawer-rows.test.ts
corepack pnpm -r typecheck
```

Expected: focused tests and all workspace typechecks pass.

- [ ] **Step 7: Commit the row builder**

```bash
git add apps/mobile/src/components/chat/ThreadDrawerContent.tsx apps/mobile/src/components/chat/thread-drawer-rows.ts packages/codex-relay/test/mobile-thread-drawer-rows.test.ts
git commit -m "feat: group pinned chats in the drawer"
```

### Task 3: Add pin actions and archive cleanup to the drawer

**Files:**

- Modify: `apps/mobile/src/state/pinned-thread-store.ts`
- Modify: `packages/codex-relay/test/mobile-pinned-thread-store.test.ts`
- Modify: `apps/mobile/src/components/ui/icon.tsx:1-51,54-106,110-165`
- Modify: `apps/mobile/src/components/chat/ThreadDrawerContent.tsx:170-325,400-428,495-550,871-1050`

- [ ] **Step 1: Add a failing toggle test**

Add `togglePinnedThread` to the test import, then add:

```ts
it("toggles a thread pin", () => {
  togglePinnedThread("thread-a");
  expect(getPinnedThreadIds()).toEqual(["thread-a"]);

  togglePinnedThread("thread-a");
  expect(getPinnedThreadIds()).toEqual([]);
});
```

- [ ] **Step 2: Run the focused store test and verify RED**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-pinned-thread-store.test.ts
```

Expected: FAIL because `togglePinnedThread` is not exported.

- [ ] **Step 3: Implement the tested toggle**

```ts
export function togglePinnedThread(threadId: string) {
  if (getPinnedThreadIds().includes(threadId)) {
    unpinThread(threadId);
    return;
  }
  pinThread(threadId);
}
```

- [ ] **Step 4: Run the focused store test and verify GREEN**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-pinned-thread-store.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Add the shared pin icon**

Import `Pin` from `lucide-react-native`, add `"pin"` to `AppIconName`, and register it:

```ts
pin: Pin,
```

- [ ] **Step 6: Subscribe the drawer to pinned state and pass it to the row builder**

Add:

```ts
import { pinnedThreadStore$, togglePinnedThread, unpinThread } from "@/state/pinned-thread-store";
```

Read state beside `activeThreadId`:

```ts
const pinnedThreadIds = useSelector(() => pinnedThreadStore$.threadIds.get());
```

Build rows with the persisted IDs:

```ts
const rows = useMemo(
  () =>
    buildDrawerRows(
      visibleThreads,
      expandedProjects,
      activeThreadId,
      pinnedThreadIds,
      Boolean(normalizedSearchQuery),
    ),
  [activeThreadId, expandedProjects, normalizedSearchQuery, pinnedThreadIds, visibleThreads],
);
```

Update the archive mutation so only a successful archive removes the pin:

```ts
onSuccess: async (_response, threadId) => {
  unpinThread(threadId);
  await queryClient.invalidateQueries({ queryKey: serverStateKeys.threads() });
},
```

- [ ] **Step 7: Add pin and unpin behavior to the action sheet**

After `closeThreadActions`, add:

```ts
const handleTogglePinnedThread = useCallback(
  (thread: ThreadSummary) => {
    togglePinnedThread(thread.id);
    hapticSelection();
    if (threadWithActions?.id === thread.id) {
      closeThreadActions();
    }
  },
  [closeThreadActions, threadWithActions?.id],
);
const threadWithActionsIsPinned = Boolean(
  threadWithActions && pinnedThreadIds.includes(threadWithActions.id),
);
```

Replace the non-rename branch of the action sheet with:

```tsx
threadWithActions ? (
  <>
    <SheetActionRow
      accessibilityLabel={threadWithActionsIsPinned ? "Unpin chat" : "Pin chat"}
      icon="pin"
      onPress={() => handleTogglePinnedThread(threadWithActions)}
      title={threadWithActionsIsPinned ? "Unpin chat" : "Pin chat"}
    />
    {canMutateAppServerThreads ? (
      <SheetActionRow
        accessibilityLabel="Rename chat"
        icon="newChat"
        onPress={openRenameThread}
        title="Rename chat"
      />
    ) : null}
  </>
) : null;
```

- [ ] **Step 8: Render the pinned header and make chat actions available for every thread**

Add a pinned header branch before the project branch:

```tsx
if (item.kind === "pinned") {
  return (
    <View style={styles.projectHeader}>
      <View style={styles.rowIconSlot}>
        <Icon name="pin" size={15} tintColor={theme.textSecondary} />
      </View>
      <Text style={styles.projectTitle}>Pinned</Text>
    </View>
  );
}
```

Rename the row callback prop from `onRenameThread` to `onOpenThreadActions`, add `pinned` and `onTogglePinnedThread`, then use:

```tsx
accessibilityActions={[
  { label: pinned ? "Unpin chat" : "Pin chat", name: "toggle-pin" },
  ...(canRenameThread ? [{ label: "Rename chat", name: "rename" }] : []),
]}
accessibilityHint="Long press for chat actions"
onAccessibilityAction={(event) => {
  if (event.nativeEvent.actionName === "toggle-pin") {
    onTogglePinnedThread(item.thread);
  } else if (event.nativeEvent.actionName === "rename") {
    onOpenThreadActions(item.thread);
  }
}}
onLongPress={() => onOpenThreadActions(item.thread)}
```

Pass the new props from `renderDrawerRow`:

```tsx
onOpenThreadActions={openThreadActions}
onTogglePinnedThread={handleTogglePinnedThread}
pinned={item.kind === "thread" && pinnedThreadIds.includes(item.thread.id)}
```

Include the new callbacks and `pinned` value in `areDrawerRowItemsEqual`, and include `handleTogglePinnedThread` plus `pinnedThreadIds` in the `renderDrawerRow` dependency list.

- [ ] **Step 9: Format and verify the integrated feature**

Run:

```bash
corepack pnpm exec oxfmt apps/mobile/src/state/pinned-thread-store.ts apps/mobile/src/components/ui/icon.tsx apps/mobile/src/components/chat/thread-drawer-rows.ts apps/mobile/src/components/chat/ThreadDrawerContent.tsx packages/codex-relay/test/mobile-pinned-thread-store.test.ts packages/codex-relay/test/mobile-thread-drawer-rows.test.ts --write
corepack pnpm --filter codex-relay exec vitest run test/mobile-pinned-thread-store.test.ts test/mobile-thread-drawer-rows.test.ts
corepack pnpm -r typecheck
```

Expected: 10 focused tests pass and all workspace typechecks pass.

- [ ] **Step 10: Commit the UI integration**

```bash
git add apps/mobile/src/state/pinned-thread-store.ts apps/mobile/src/components/ui/icon.tsx apps/mobile/src/components/chat/thread-drawer-rows.ts apps/mobile/src/components/chat/ThreadDrawerContent.tsx packages/codex-relay/test/mobile-pinned-thread-store.test.ts packages/codex-relay/test/mobile-thread-drawer-rows.test.ts
git commit -m "feat: add pinned chat actions"
```

### Task 4: Complete repository and contributor validation

**Files:**

- Verify only, no planned source changes

- [ ] **Step 1: Build the package required by mobile-importing server tests**

```bash
corepack pnpm --filter codex-relay build
```

Expected: `dist/api-schema.js` and the remaining package artifacts build successfully.

- [ ] **Step 2: Run the complete server test suite**

```bash
corepack pnpm --filter codex-relay test
```

Expected: all non-live tests pass, with only the repository's expected live-test skips.

- [ ] **Step 3: Run CI-equivalent static checks**

```bash
corepack pnpm exec oxlint apps packages --import-plugin --react-plugin --jsx-a11y-plugin --vitest-plugin
corepack pnpm format:check
corepack pnpm -r typecheck
node --test scripts/mobile-release-version.test.mjs
corepack pnpm --filter @codex-relay/mobile exec vitest run src/lib/mobile-release-version.test.ts
```

Expected: lint, formatting, all workspace typechecks, and release-policy tests pass.

- [ ] **Step 4: Attempt manual mobile verification**

Verify on an available simulator or device:

1. Long-press an unpinned chat and choose `Pin chat`.
2. Confirm it moves to `Pinned` and disappears from its workspace group.
3. Restart the app and confirm the pin remains.
4. Unpin the chat and confirm it returns to its workspace group.
5. Pin a chat, archive it successfully, and confirm the pin disappears.
6. Search for a pinned chat and confirm it appears once in normal search results.

If no simulator or paired Relay is available, record the missing manual checks in the final handoff and future PR validation section.

- [ ] **Step 5: Review the final diff and history**

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors, no uncommitted source changes, and Conventional Commit messages only. The eventual PR should be in English, link issue #58, list validation commands, and include a screenshot or recording when manual UI verification is available. Include a patch changeset for `@codex-relay/mobile`; no `codex-relay` package changeset is required.

### Task 5: Show workspace metadata on pinned rows

**Files:**

- Modify: `apps/mobile/src/components/chat/thread-drawer-rows.ts`
- Modify: `apps/mobile/src/components/chat/ThreadDrawerContent.tsx`
- Test: `packages/codex-relay/test/mobile-thread-drawer-rows.test.ts`

- [ ] **Step 1: Write a failing row-builder test**

Add a test proving pinned rows receive the leaf workspace label while normal search rows do not:

```ts
it("adds workspace labels only to pinned section rows", () => {
  const thread = threadSummary("thread-a", "/work/very-long-project-folder-name");

  const pinnedRows = buildDrawerRows([thread], {}, undefined, [thread.id]);
  const searchRows = buildDrawerRows([thread], {}, undefined, [thread.id], true);

  expect(pinnedRows.find((row) => row.kind === "thread")).toEqual({
    ...threadRow(thread),
    workspaceTitle: "very-long-project-folder-name",
  });
  expect(searchRows.find((row) => row.kind === "thread")).toEqual(threadRow(thread));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-thread-drawer-rows.test.ts
```

Expected: FAIL because pinned thread rows do not yet contain `workspaceTitle`.

- [ ] **Step 3: Add pinned workspace metadata to the row model**

Extend the thread row variant:

```ts
| {
    id: string;
    kind: "thread";
    projectKey: string;
    thread: ThreadSummary;
    workspaceTitle?: string;
  }
```

Create pinned rows with the workspace label while leaving normal rows unchanged:

```ts
rows.push(
  ...pinnedThreads.map((thread) =>
    threadRow(thread, projectKeyForThread(thread), workspaceName(thread.cwd) ?? "codex-relay"),
  ),
);
```

Update `threadRow` to accept and conditionally include the optional label:

```ts
function threadRow(thread: ThreadSummary, projectKey: string, workspaceTitle?: string): DrawerRow {
  return {
    id: `thread:${thread.id}`,
    kind: "thread",
    projectKey,
    thread,
    ...(workspaceTitle ? { workspaceTitle } : {}),
  };
}
```

- [ ] **Step 4: Render compact pinned metadata**

Calculate the relative time once and render pinned metadata with middle ellipsis:

```tsx
const relativeTime = formatRelativeTime(item.thread.lastActivityAt ?? item.thread.updatedAt);

const metadata = (
  <Text
    ellipsizeMode={item.workspaceTitle ? "middle" : "tail"}
    numberOfLines={1}
    style={styles.threadTime}
  >
    {item.workspaceTitle ? `${item.workspaceTitle} · ${relativeTime}` : relativeTime}
  </Text>
);
```

Include `workspaceTitle` in the thread-row memo comparison:

```ts
previous.item.workspaceTitle === next.item.workspaceTitle &&
```

- [ ] **Step 5: Verify GREEN and static checks**

Run:

```bash
corepack pnpm --filter codex-relay exec vitest run test/mobile-thread-drawer-rows.test.ts
corepack pnpm exec oxfmt apps/mobile/src/components/chat/thread-drawer-rows.ts apps/mobile/src/components/chat/ThreadDrawerContent.tsx packages/codex-relay/test/mobile-thread-drawer-rows.test.ts --write
corepack pnpm -r typecheck
```

Expected: the focused tests and all workspace typechecks pass, and formatting produces no remaining diff.

- [ ] **Step 6: Verify on Android and commit**

Open the drawer in the paired Android emulator and confirm:

1. A pinned row shows `<workspace> · <relative time>` below its title.
2. A long workspace label stays on one line with middle ellipsis.
3. A normal workspace row still shows only relative time.

Save a fresh screenshot, then commit:

```bash
git add apps/mobile/src/components/chat/thread-drawer-rows.ts apps/mobile/src/components/chat/ThreadDrawerContent.tsx packages/codex-relay/test/mobile-thread-drawer-rows.test.ts
git commit -m "feat: label pinned chats by workspace"
```
