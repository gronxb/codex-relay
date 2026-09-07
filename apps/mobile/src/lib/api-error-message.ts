export function errorMessage(payload: unknown, fallback: string) {
  if (payload instanceof Error && payload.message) {
    return payload.message;
  }
  return payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error
    ? String(payload.error.message)
    : fallback;
}
