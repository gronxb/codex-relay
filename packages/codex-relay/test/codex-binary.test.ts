import { describe, expect, it } from "vitest";
import { sep } from "node:path";

import {
  resolveCodexAppServerMode,
  resolveCodexAppServerSpawn,
  resolveCodexSharedAppServerSpawn,
} from "../src/codex-binary.js";

describe("Codex app-server spawn resolution", () => {
  it("defaults to a shared socket with startup fallback on macOS", () => {
    // Given: macOS with no explicit app-server mode.
    // When: the relay resolves its startup mode.
    const mode = resolveCodexAppServerMode({ env: {}, platform: "darwin" });

    // Then: shared mode is preferred, but private stdio remains the startup fallback.
    expect(mode).toEqual({ fallbackToStdio: true, mode: "socket" });
  });

  it.each(["linux", "win32"] as const)("keeps private stdio as the default on %s", (platform) => {
    // Given: a non-macOS platform with no explicit app-server mode.
    // When: the relay resolves its startup mode.
    const mode = resolveCodexAppServerMode({ env: {}, platform });

    // Then: existing private stdio behavior remains unchanged.
    expect(mode).toEqual({ fallbackToStdio: false, mode: "stdio" });
  });

  it("forces shared mode without fallback when explicitly configured on macOS", () => {
    // Given: shared mode explicitly configured on macOS.
    // When: the relay resolves its startup mode.
    const mode = resolveCodexAppServerMode({
      env: { CODEX_RELAY_APP_SERVER_MODE: "socket" },
      platform: "darwin",
    });

    // Then: startup failure remains visible to the caller.
    expect(mode).toEqual({ fallbackToStdio: false, mode: "socket" });
  });

  it("allows private stdio to be explicitly configured on macOS", () => {
    // Given: private mode explicitly configured on macOS.
    // When: the relay resolves its startup mode.
    const mode = resolveCodexAppServerMode({
      env: { CODEX_RELAY_APP_SERVER_MODE: "stdio" },
      platform: "darwin",
    });

    // Then: shared startup is skipped.
    expect(mode).toEqual({ fallbackToStdio: false, mode: "stdio" });
  });

  it("uses the packaged Codex CLI by default on Windows", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: {},
      platform: "win32",
    });

    expect(spawnConfig.command).toBe(process.execPath);
    expect(spawnConfig.args.slice(1)).toEqual(["app-server", "--listen", "stdio://"]);
    expect(spawnConfig.args[0]).toContain(
      ["node_modules", "@openai", "codex", "bin", "codex.js"].join(sep),
    );
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.windowsHide).toBe(true);
  });

  it("uses a shell for Windows command shims", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: { CODEX_BIN: "C:\\Users\\leore\\AppData\\Roaming\\npm\\codex.cmd" },
      platform: "win32",
    });

    expect(spawnConfig).toEqual({
      command: "C:\\Users\\leore\\AppData\\Roaming\\npm\\codex.cmd",
      args: ["app-server", "--listen", "stdio://"],
      shell: true,
      windowsHide: true,
    });
  });

  it("spawns executables directly on Windows", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: { CODEX_BIN: "C:\\Program Files\\Codex\\codex.exe" },
      platform: "win32",
    });

    expect(spawnConfig).toEqual({
      command: "C:\\Program Files\\Codex\\codex.exe",
      args: ["app-server", "--listen", "stdio://"],
      shell: false,
      windowsHide: true,
    });
  });

  it("uses the packaged Codex CLI by default on POSIX platforms", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: {},
      platform: "linux",
    });

    expect(spawnConfig.command).toBe(process.execPath);
    expect(spawnConfig.args.slice(1)).toEqual(["app-server", "--listen", "stdio://"]);
    expect(spawnConfig.args[0]).toContain(
      ["node_modules", "@openai", "codex", "bin", "codex.js"].join(sep),
    );
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.windowsHide).toBe(false);
  });

  it("listens on the shared Unix socket in shared mode", () => {
    const spawnConfig = resolveCodexSharedAppServerSpawn({ env: {}, platform: "linux" });

    expect(spawnConfig.command).toBe(process.execPath);
    expect(spawnConfig.args.slice(1)).toEqual(["app-server", "--listen", "unix://"]);
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.windowsHide).toBe(false);
  });

  it("rejects unknown app-server modes", () => {
    expect(() =>
      resolveCodexAppServerMode({
        env: { CODEX_RELAY_APP_SERVER_MODE: "shared" },
        platform: "darwin",
      }),
    ).toThrow('Expected "stdio" or "socket"');
  });

  it("listens on a loopback WebSocket in shared mode on native Windows", () => {
    const spawnConfig = resolveCodexSharedAppServerSpawn({
      env: { CODEX_RELAY_APP_SERVER_MODE: "socket" },
      platform: "win32",
    });

    expect(spawnConfig.command).toBe(process.execPath);
    expect(spawnConfig.args.slice(1)).toEqual(["app-server", "--listen", "ws://127.0.0.1:8788"]);
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.windowsHide).toBe(true);
  });
});
