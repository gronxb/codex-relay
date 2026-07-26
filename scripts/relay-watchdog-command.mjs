export function relayServiceCommand(cliArgs) {
  const persistent = !cliArgs.includes("stop");
  return {
    command: "pnpm",
    args: [
      "--filter",
      "codex-relay",
      "exec",
      "tsx",
      ...(persistent ? ["watch"] : []),
      "src/cli.ts",
      ...cliArgs,
    ],
    persistent,
  };
}

export function relayHealthUrl(env = process.env) {
  const host = env.RELAY_HEALTH_CHECK_HOST ?? "127.0.0.1";
  const port = env.CODEX_RELAY_PORT ?? env.PORT ?? "8787";
  return `http://${host}:${port}/version`;
}

export async function isRelayHealthy(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      return false;
    }
    const body = await response.json();
    return isRelayVersionResponse(body);
  } catch {
    return false;
  }
}

function isRelayVersionResponse(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "service" in value &&
    value.service === "codex-relay-server"
  );
}
