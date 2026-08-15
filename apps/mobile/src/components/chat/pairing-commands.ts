export const relayStartCommand = "npx codex-relay@latest";

export function approvalCommand(approvalCode: string, serverUrl?: string) {
  const port = approvalPort(serverUrl);
  return port && port !== "8787"
    ? `PORT=${port} ${relayStartCommand} approve ${approvalCode}`
    : `${relayStartCommand} approve ${approvalCode}`;
}

function approvalPort(serverUrl?: string) {
  if (!serverUrl) {
    return undefined;
  }

  try {
    return new URL(serverUrl).port;
  } catch {
    return undefined;
  }
}
