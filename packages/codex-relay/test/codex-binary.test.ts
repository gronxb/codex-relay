import { describe, expect, it } from "vitest";

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

  it("uses a shell for the default npm command on Windows", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: {},
      platform: "win32",
    });

    expect(spawnConfig).toEqual({
      command: "codex",
      args: ["app-server", "--listen", "stdio://"],
      shell: true,
      windowsHide: true,
    });
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

  it("spawns the command directly on POSIX platforms", () => {
    const spawnConfig = resolveCodexAppServerSpawn({
      env: {},
      platform: "linux",
    });

    expect(spawnConfig).toEqual({
      command: "codex",
      args: ["app-server", "--listen", "stdio://"],
      shell: false,
      windowsHide: false,
    });
  });

  it("listens on the shared Unix socket in shared mode", () => {
    expect(resolveCodexSharedAppServerSpawn({ env: {}, platform: "linux" })).toEqual({
      command: "codex",
      args: ["app-server", "--listen", "unix://"],
      shell: false,
      windowsHide: false,
    });
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
    expect(
      resolveCodexSharedAppServerSpawn({
        env: { CODEX_RELAY_APP_SERVER_MODE: "socket" },
        platform: "win32",
      }),
    ).toEqual({
      command: "codex",
      args: ["app-server", "--listen", "ws://127.0.0.1:8788"],
      shell: true,
      windowsHide: true,
    });
  });
});
