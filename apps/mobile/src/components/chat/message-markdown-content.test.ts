import { describe, expect, it } from "vitest";

import {
  messageCodeContentForRender,
  messageMarkdownContentForRender,
} from "./message-markdown-content";

describe("messageMarkdownContentForRender", () => {
  it.each([
    ["soft break", "first\n"],
    ["blank line", "first\n\n"],
    ["hard break spaces", "first  "],
    ["list indentation", "- parent\n  "],
  ])("preserves trailing Markdown syntax while streaming: %s", (_name, content) => {
    expect(messageMarkdownContentForRender(content)).toBe(content);
  });

  it("keeps an empty streaming message renderable", () => {
    expect(messageMarkdownContentForRender("")).toBe(" ");
  });
});

describe("messageCodeContentForRender", () => {
  it("preserves incomplete fenced-code newlines while streaming", () => {
    expect(messageCodeContentForRender("const first = 1;\n\n")).toBe("const first = 1;\n\n");
  });
});
