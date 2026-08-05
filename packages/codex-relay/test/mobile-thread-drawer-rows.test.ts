import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../src/api-schema.js";

import { buildDrawerRows } from "../../../apps/mobile/src/components/chat/thread-drawer-rows.js";

describe("mobile thread drawer rows", () => {
  it("renders pinned threads once in pinned order above their project", () => {
    const threads = [
      threadSummary("thread-a", "/work/project"),
      threadSummary("thread-b", "/work/project"),
      threadSummary("thread-c", "/work/project"),
    ];

    expect(buildDrawerRows(threads, {}, undefined, ["thread-b", "thread-a"])).toEqual([
      { id: "pinned", kind: "pinned" },
      pinnedThreadRow(threads[1], "project"),
      pinnedThreadRow(threads[0], "project"),
      projectRow("/work/project"),
      threadRow(threads[2]),
    ]);
  });

  it("keeps a project header when every chat in the project is pinned", () => {
    const threads = [
      threadSummary("thread-a", "/work/project"),
      threadSummary("thread-b", "/work/project"),
    ];

    expect(buildDrawerRows(threads, {}, undefined, ["thread-a", "thread-b"])).toEqual([
      { id: "pinned", kind: "pinned" },
      pinnedThreadRow(threads[0], "project"),
      pinnedThreadRow(threads[1], "project"),
      projectRow("/work/project"),
    ]);
  });

  it("omits missing pinned ids while rendering available pinned threads", () => {
    const threads = [
      threadSummary("thread-a", "/work/project"),
      threadSummary("thread-b", "/work/project"),
    ];

    expect(buildDrawerRows(threads, {}, undefined, ["thread-missing", "thread-b"])).toEqual([
      { id: "pinned", kind: "pinned" },
      pinnedThreadRow(threads[1], "project"),
      projectRow("/work/project"),
      threadRow(threads[0]),
    ]);
  });

  it("keeps the collapsed project limit for unpinned chats", () => {
    const threads = Array.from({ length: 7 }, (_, index) =>
      threadSummary(`thread-${index + 1}`, "/work/project"),
    );

    const rows = buildDrawerRows(threads, {}, undefined, ["thread-1"]);

    expect(rows.filter((row) => row.kind === "thread").map((row) => row.thread.id)).toEqual([
      "thread-1",
      "thread-2",
      "thread-3",
      "thread-4",
      "thread-5",
      "thread-6",
    ]);
    expect(rows.find((row) => row.kind === "more")).toEqual({
      id: "more:/work/project",
      kind: "more",
      hiddenCount: 1,
      projectKey: "/work/project",
    });
  });

  it("renders search results once in normal workspace order without a pinned header", () => {
    const threads = [
      threadSummary("thread-a", "/work/alpha"),
      threadSummary("thread-b", "/work/alpha"),
      threadSummary("thread-c", "/work/beta"),
    ];

    expect(buildDrawerRows(threads, {}, undefined, ["thread-b"], true)).toEqual([
      projectRow("/work/alpha"),
      threadRow(threads[0]),
      threadRow(threads[1]),
      projectRow("/work/beta"),
      threadRow(threads[2]),
    ]);
  });

  it("adds workspace labels only to pinned section rows", () => {
    const thread = threadSummary("thread-a", "/work/very-long-project-folder-name");

    const pinnedRows = buildDrawerRows([thread], {}, undefined, [thread.id]);
    const searchRows = buildDrawerRows([thread], {}, undefined, [thread.id], true);

    expect(pinnedRows.find((row) => row.kind === "thread")).toEqual(
      pinnedThreadRow(thread, "very-long-project-folder-name"),
    );
    expect(searchRows.find((row) => row.kind === "thread")).toEqual(threadRow(thread));
  });

  it("keeps an active seventh chat visible in a collapsed project", () => {
    const threads = Array.from({ length: 7 }, (_, index) =>
      threadSummary(`thread-${index + 1}`, "/work/project"),
    );

    const rows = buildDrawerRows(threads, {}, "thread-7");

    expect(rows.filter((row) => row.kind === "thread").map((row) => row.thread.id)).toEqual([
      "thread-1",
      "thread-2",
      "thread-3",
      "thread-4",
      "thread-7",
    ]);
    expect(rows.find((row) => row.kind === "more")).toEqual({
      id: "more:/work/project",
      kind: "more",
      hiddenCount: 2,
      projectKey: "/work/project",
    });
  });

  it("keeps only the first duplicate thread id in normal mode", () => {
    const firstThread = threadSummary("thread-duplicate", "/work/first");
    const duplicateThread = threadSummary("thread-duplicate", "/work/second");

    expect(buildDrawerRows([firstThread, duplicateThread], {}, undefined)).toEqual([
      projectRow("/work/first"),
      threadRow(firstThread),
    ]);
  });

  it("keeps only the first duplicate thread id in force-expanded mode", () => {
    const firstThread = threadSummary("thread-duplicate", "/work/first");
    const duplicateThread = threadSummary("thread-duplicate", "/work/second");

    expect(buildDrawerRows([firstThread, duplicateThread], {}, undefined, [], true)).toEqual([
      projectRow("/work/first"),
      threadRow(firstThread),
    ]);
  });

  it("renders repeated pinned ids only once", () => {
    const thread = threadSummary("thread-a", "/work/project");

    expect(buildDrawerRows([thread], {}, undefined, ["thread-a", "thread-a"])).toEqual([
      { id: "pinned", kind: "pinned" },
      pinnedThreadRow(thread, "project"),
      projectRow("/work/project"),
    ]);
  });

  it("shows every chat in an expanded project without a more row", () => {
    const threads = Array.from({ length: 7 }, (_, index) =>
      threadSummary(`thread-${index + 1}`, "/work/project"),
    );

    const rows = buildDrawerRows(threads, { "/work/project": true }, undefined);

    expect(rows.filter((row) => row.kind === "thread").map((row) => row.thread.id)).toEqual(
      threads.map((thread) => thread.id),
    );
    expect(rows.find((row) => row.kind === "more")).toBeUndefined();
  });

  it("uses the codex-relay fallback project for a pinned thread without a cwd", () => {
    const thread = threadSummary("thread-a");

    expect(buildDrawerRows([thread], {}, undefined, ["thread-a"])).toEqual([
      { id: "pinned", kind: "pinned" },
      pinnedThreadRow(thread, "codex-relay"),
      {
        id: "project:codex-relay",
        kind: "project",
        projectKey: "codex-relay",
        title: "codex-relay",
        workspacePath: undefined,
      },
    ]);
  });
});

function threadSummary(id: string, cwd?: string): ThreadSummary {
  const now = "2026-08-05T00:00:00.000Z";
  return {
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    state: "completed",
    cwd,
    messageCount: 0,
  };
}

function projectRow(projectKey: string) {
  return {
    id: `project:${projectKey}`,
    kind: "project" as const,
    projectKey,
    title: projectKey.split("/").at(-1),
    workspacePath: projectKey,
  };
}

function threadRow(thread: ThreadSummary) {
  return {
    id: `thread:${thread.id}`,
    kind: "thread" as const,
    projectKey: thread.cwd ?? "codex-relay",
    thread,
  };
}

function pinnedThreadRow(thread: ThreadSummary, workspaceTitle: string) {
  return {
    ...threadRow(thread),
    workspaceTitle,
  };
}
