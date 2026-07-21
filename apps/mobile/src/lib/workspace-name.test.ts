import { describe, expect, it } from "vitest";

import { workspaceName } from "./workspace-name";

describe("workspaceName", () => {
  it("returns the final directory from POSIX and Windows paths", () => {
    expect(workspaceName("/Users/lea/projects/codex-relay")).toBe("codex-relay");
    expect(workspaceName("C:\\Users\\lea\\projects\\codex-relay")).toBe("codex-relay");
  });
});
