import { describe, expect, it } from "vitest";

import { extractStreamText } from "../src/codex.js";

describe("Codex SDK event compatibility", () => {
  it("extracts the nested error from a failed turn", () => {
    expect(
      extractStreamText({
        type: "turn.failed",
        error: { message: "The Codex turn failed." },
      }),
    ).toBe("The Codex turn failed.");
  });
});
