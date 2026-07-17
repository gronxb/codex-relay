import { platform as currentPlatform } from "node:os";
import { extname } from "node:path";

const stdioAppServerArgs = ["app-server", "--listen", "stdio://"] as const;
const sharedWindowsServerUrl = "ws://127.0.0.1:8788";
const windowsShellExtensions = new Set([".bat", ".cmd"]);

type CodexSpawnPlatform = NodeJS.Platform;

export type CodexAppServerSpawn = {
  readonly args: string[];
  readonly command: string;
  readonly shell: boolean;
  readonly windowsHide: boolean;
};

export type CodexAppServerSpawnInput = {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: CodexSpawnPlatform;
};

export type CodexAppServerMode = "stdio" | "socket";

export function resolveCodexAppServerMode(
  env: NodeJS.ProcessEnv = process.env,
): CodexAppServerMode {
  const configuredMode = env.CODEX_RELAY_APP_SERVER_MODE?.trim().toLowerCase();
  if (!configuredMode || configuredMode === "stdio") {
    return "stdio";
  }
  if (configuredMode === "socket") {
    return "socket";
  }
  throw new Error(
    `Unsupported CODEX_RELAY_APP_SERVER_MODE ${JSON.stringify(configuredMode)}. Expected "stdio" or "socket".`,
  );
}

export function resolveCodexAppServerSpawn(
  input: CodexAppServerSpawnInput = {},
): CodexAppServerSpawn {
  const platform = input.platform ?? currentPlatform();
  const env = input.env ?? process.env;
  const command = resolveCodexBinary(env);
  const isWindows = platform === "win32";

  return {
    command,
    args: [...stdioAppServerArgs],
    shell: isWindows && shouldUseWindowsShell(command),
    windowsHide: isWindows,
  };
}

export function resolveCodexSharedAppServerSpawn(
  input: CodexAppServerSpawnInput = {},
): CodexAppServerSpawn {
  const platform = input.platform ?? currentPlatform();
  const command = resolveCodexBinary(input.env ?? process.env);
  const isWindows = platform === "win32";

  return {
    command,
    args: ["app-server", "--listen", resolveCodexSharedAppServerRemoteAddress(platform)],
    shell: isWindows && shouldUseWindowsShell(command),
    windowsHide: isWindows,
  };
}

export function resolveCodexSharedAppServerRemoteAddress(
  platform: CodexSpawnPlatform = currentPlatform(),
) {
  return platform === "win32" ? sharedWindowsServerUrl : "unix://";
}

function resolveCodexBinary(env: NodeJS.ProcessEnv) {
  return env.CODEX_BIN?.trim() || "codex";
}

function shouldUseWindowsShell(command: string) {
  const extension = extname(command).toLowerCase();
  return extension === "" || windowsShellExtensions.has(extension);
}
