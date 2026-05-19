import { createMMKV } from "react-native-mmkv";

export const pairingTrialDurationMs = 2 * 24 * 60 * 60 * 1000;

const pairingTrialStartedAtStorageKey = "codex-relay.pairing-trial-started-at";
const storage = createMMKV({ id: "codex-relay-pairing-trial" });

export type PairingTrialAccess = {
  hasTrialAccess: boolean;
  remainingMs: number;
  startedAt?: number;
  expiresAt?: number;
};

export async function startPairingTrialIfNeeded(now = Date.now()): Promise<PairingTrialAccess> {
  const currentTrial = await getPairingTrialAccess(now);
  if (currentTrial.startedAt) {
    return currentTrial;
  }

  storage.set(pairingTrialStartedAtStorageKey, String(now));
  return pairingTrialAccessFromStartedAt(now, now);
}

export async function getPairingTrialAccess(now = Date.now()): Promise<PairingTrialAccess> {
  const startedAt = parseStoredTimestamp(storage.getString(pairingTrialStartedAtStorageKey));
  if (startedAt === undefined) {
    return {
      hasTrialAccess: false,
      remainingMs: 0,
    };
  }

  return pairingTrialAccessFromStartedAt(startedAt, now);
}

function pairingTrialAccessFromStartedAt(startedAt: number, now: number): PairingTrialAccess {
  const expiresAt = startedAt + pairingTrialDurationMs;
  const remainingMs = Math.max(0, expiresAt - now);

  return {
    expiresAt,
    hasTrialAccess: remainingMs > 0,
    remainingMs,
    startedAt,
  };
}

function parseStoredTimestamp(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
}
