import { describe, expect, it } from "vitest";

import {
  getPairingTrialAccess,
  pairingTrialDurationMs,
  startPairingTrialIfNeeded,
} from "../../../apps/mobile/src/lib/pairing-trial.js";

describe("mobile pairing trial state", () => {
  it("starts and reads pairing trial access without platform secure-store entitlements", async () => {
    const startedAt = 1779080000000;

    await expect(startPairingTrialIfNeeded(startedAt)).resolves.toMatchObject({
      hasTrialAccess: true,
      startedAt,
    });

    await expect(getPairingTrialAccess(startedAt + 1000)).resolves.toMatchObject({
      hasTrialAccess: true,
      remainingMs: pairingTrialDurationMs - 1000,
      startedAt,
    });
  });
});
