import { describe, expect, it } from "vitest";

import { messageSegmentRenderKey } from "./message-segment-key";

describe("messageSegmentRenderKey", () => {
  it("keeps a streaming Markdown segment mounted as its content grows", () => {
    const initialSegment = { content: "Hello", kind: "markdown" as const };
    const appendedSegment = { content: "Hello world", kind: "markdown" as const };

    expect(messageSegmentRenderKey(initialSegment, 0)).toBe(
      messageSegmentRenderKey(appendedSegment, 0),
    );
  });

  it("changes identity when the renderer kind changes at the same position", () => {
    expect(messageSegmentRenderKey({ kind: "markdown" }, 0)).not.toBe(
      messageSegmentRenderKey({ kind: "code" }, 0),
    );
  });
});
