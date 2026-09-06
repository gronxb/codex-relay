import { expect, it } from "vitest";

import { errorMessage } from "./api-error-message";

it("preserves timeout and native error messages instead of reporting network error", () => {
  expect(errorMessage(new Error("Request timed out."), "network error")).toBe("Request timed out.");
  expect(errorMessage({ error: { message: "Pair this device" } }, "fallback")).toBe(
    "Pair this device",
  );
  expect(errorMessage(undefined, "network error")).toBe("network error");
});
