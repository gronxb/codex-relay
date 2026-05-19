import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../src/api-schema.js";

import { activeThreadAfterRefresh } from "../../../apps/mobile/src/lib/active-thread-selection.js";

describe("mobile active thread refresh selection", () => {
  it("keeps the current thread when it remains in the refreshed list", () => {
    expect(
      activeThreadAfterRefresh({
        currentActiveThreadId: "thread-current",
        missingActiveThreadRestored: false,
        threads: [threadSummary("thread-current"), threadSummary("thread-other")],
      }),
    ).toBe("thread-current");
  });

  it("keeps a newly created active thread when detail restore succeeds before the list catches up", () => {
    expect(
      activeThreadAfterRefresh({
        currentActiveThreadId: "thread-new",
        missingActiveThreadRestored: true,
        threads: [threadSummary("thread-older")],
      }),
    ).toBe("thread-new");
  });

  it("falls back to the first refreshed thread only when the current thread cannot be restored", () => {
    expect(
      activeThreadAfterRefresh({
        currentActiveThreadId: "thread-missing",
        missingActiveThreadRestored: false,
        threads: [threadSummary("thread-fallback")],
      }),
    ).toBe("thread-fallback");
  });
});

function threadSummary(id: string): ThreadSummary {
  const now = "2026-05-19T00:00:00.000Z";
  return {
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    state: "completed",
    messageCount: 0,
  };
}
