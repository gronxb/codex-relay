import { createRequire } from "node:module";
import { platform as currentPlatform } from "node:os";
import { dirname, extname, join } from "node:path";

const stdioAppServerArgs = ["app-server", "--listen", "stdio://"] as const;
const sharedWindowsServerUrl = "ws://127.0.0.1:8788";
const windowsShellExtensions = new Set([".bat", ".cmd"]);
const require = createRequire(import.meta.url);

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

export type CodexAppServerModeResolution = {
  readonly fallbackToStdio: boolean;
  readonly mode: CodexAppServerMode;
};

export function resolveCodexAppServerMode(
  input: CodexAppServerSpawnInput = {},
): CodexAppServerModeResolution {
  const env = input.env ?? process.env;
  const platform = input.platform ?? currentPlatform();
  const configuredMode = env.CODEX_RELAY_APP_SERVER_MODE?.trim().toLowerCase();
  if (!configuredMode) {
    return platform === "darwin"
      ? { fallbackToStdio: true, mode: "socket" }
      : { fallbackToStdio: false, mode: "stdio" };
  }
  if (configuredMode === "stdio") {
    return { fallbackToStdio: false, mode: "stdio" };
  }
  if (configuredMode === "socket") {
    return { fallbackToStdio: false, mode: "socket" };
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
  const executable = resolveCodexExecutable(env);
  const isWindows = platform === "win32";

  return {
    command: executable.command,
    args: [...executable.args, ...stdioAppServerArgs],
    shell: isWindows && executable.explicit && shouldUseWindowsShell(executable.command),
    windowsHide: isWindows,
  };
}

export function resolveCodexSharedAppServerSpawn(
  input: CodexAppServerSpawnInput = {},
): CodexAppServerSpawn {
  const platform = input.platform ?? currentPlatform();
  const executable = resolveCodexExecutable(input.env ?? process.env);
  const isWindows = platform === "win32";

  return {
    command: executable.command,
    args: [
      ...executable.args,
      "app-server",
      "--listen",
      resolveCodexSharedAppServerRemoteAddress(platform),
    ],
    shell: isWindows && executable.explicit && shouldUseWindowsShell(executable.command),
    windowsHide: isWindows,
  };
}

export function resolveCodexSharedAppServerRemoteAddress(
  platform: CodexSpawnPlatform = currentPlatform(),
) {
  return platform === "win32" ? sharedWindowsServerUrl : "unix://";
}

function resolveCodexExecutable(env: NodeJS.ProcessEnv) {
  const configuredBinary = env.CODEX_BIN?.trim();
  if (configuredBinary) {
    return { args: [] as string[], command: configuredBinary, explicit: true };
  }
  const packagePath = require.resolve("@openai/codex/package.json");
  return {
    args: [join(dirname(packagePath), "bin", "codex.js")],
    command: process.execPath,
    explicit: false,
  };
}

function shouldUseWindowsShell(command: string) {
  const extension = extname(command).toLowerCase();
  return extension === "" || windowsShellExtensions.has(extension);
}
