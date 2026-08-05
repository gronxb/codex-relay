import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPinnedThreadIds,
  pinThread,
  resetPinnedThreadState,
  togglePinnedThread,
  unpinThread,
} from "../../../apps/mobile/src/state/pinned-thread-store.js";

describe("mobile pinned thread store", () => {
  beforeEach(() => {
    resetPinnedThreadState();
  });

  it("adds pinned threads to the front in pin order", () => {
    pinThread("thread-a");
    pinThread("thread-b");

    expect(getPinnedThreadIds()).toEqual(["thread-b", "thread-a"]);
  });

  it("does not duplicate an already pinned thread", () => {
    pinThread("thread-a");
    pinThread("thread-a");

    expect(getPinnedThreadIds()).toEqual(["thread-a"]);
  });

  it("does not expose a mutable pinned thread array", () => {
    pinThread("thread-a");
    const threadIds = getPinnedThreadIds();
    (threadIds as string[]).push("thread-b");

    expect(getPinnedThreadIds()).toEqual(["thread-a"]);
  });

  it("removes only the selected pinned thread", () => {
    pinThread("thread-a");
    pinThread("thread-b");
    unpinThread("thread-a");

    expect(getPinnedThreadIds()).toEqual(["thread-b"]);
  });

  it("toggles a thread between pinned and unpinned", () => {
    togglePinnedThread("thread-a");
    expect(getPinnedThreadIds()).toEqual(["thread-a"]);

    togglePinnedThread("thread-a");
    expect(getPinnedThreadIds()).toEqual([]);
  });

  it("restores pinned threads after the store module reloads", async () => {
    pinThread("thread-a");
    vi.resetModules();

    const reloadedStore = await import("../../../apps/mobile/src/state/pinned-thread-store.js");

    expect(reloadedStore.getPinnedThreadIds()).toEqual(["thread-a"]);
    reloadedStore.resetPinnedThreadState();
  });
});
