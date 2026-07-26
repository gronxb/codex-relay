import { describe, expect, it } from "vitest";

import {
  isRelayHealthy,
  relayHealthUrl,
  relayServiceCommand,
} from "../../../scripts/relay-watchdog-command.mjs";

describe("relay watchdog service command", () => {
  it("keeps the relay server in watch mode for local library development", () => {
    const command = relayServiceCommand(["--dangerously-auto-approve"]);

    expect(command).toEqual({
      args: [
        "--filter",
        "codex-relay",
        "exec",
        "tsx",
        "watch",
        "src/cli.ts",
        "--dangerously-auto-approve",
      ],
      command: "pnpm",
      persistent: true,
    });
  });

  it("runs the stop command once without a file watcher", () => {
    const command = relayServiceCommand(["stop"]);

    expect(command).toEqual({
      args: ["--filter", "codex-relay", "exec", "tsx", "src/cli.ts", "stop"],
      command: "pnpm",
      persistent: false,
    });
  });

  it("checks the relay version endpoint on the configured host and port", () => {
    expect(relayHealthUrl({ CODEX_RELAY_PORT: "9999", PORT: "8787" })).toBe(
      "http://127.0.0.1:9999/version",
    );
    expect(relayHealthUrl({ PORT: "8788" })).toBe("http://127.0.0.1:8788/version");
    expect(relayHealthUrl({ RELAY_HEALTH_CHECK_HOST: "192.168.0.22", PORT: "8787" })).toBe(
      "http://192.168.0.22:8787/version",
    );
  });

  it("treats failed health requests as unhealthy", async () => {
    await expect(
      isRelayHealthy(
        async () => ({
          json: async () => ({ ok: true, service: "codex-relay-server" }),
          ok: true,
        }),
        "http://127.0.0.1:8787/version",
      ),
    ).resolves.toBe(true);
    await expect(
      isRelayHealthy(
        async () => ({
          json: async () => ({ service: "hot-updater-cloud-update-runtime" }),
          ok: true,
        }),
        "http://127.0.0.1:8787/version",
      ),
    ).resolves.toBe(false);
    await expect(
      isRelayHealthy(async () => {
        throw new Error("connection refused");
      }, "http://127.0.0.1:8787/version"),
    ).resolves.toBe(false);
  });
});
