import { describe, expect, it } from "vitest";

import { approvalCommand, relayStartCommand } from "./pairing-commands";

describe("pairing commands", () => {
  it("uses the latest relay package for setup and default-port approval", () => {
    expect(relayStartCommand).toBe("npx codex-relay@latest");
    expect(approvalCommand("ABCD-1234")).toBe("npx codex-relay@latest approve ABCD-1234");
    expect(approvalCommand("ABCD-1234", "http://192.168.1.4:8787")).toBe(
      "npx codex-relay@latest approve ABCD-1234",
    );
  });

  it("includes a non-default relay port in the approval command", () => {
    expect(approvalCommand("ABCD-1234", "http://192.168.1.4:9123")).toBe(
      "PORT=9123 npx codex-relay@latest approve ABCD-1234",
    );
  });

  it("falls back to the default command for an invalid server URL", () => {
    expect(approvalCommand("ABCD-1234", "not a URL")).toBe(
      "npx codex-relay@latest approve ABCD-1234",
    );
  });
});
