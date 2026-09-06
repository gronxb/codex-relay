import { expect, it, vi } from "vitest";

import { firstReachablePairingUrl } from "./pairing-reachability";

it("uses reachable LAN immediately while the first VPN address is still pending", async () => {
  const probe = vi.fn<(url: string) => Promise<void>>((url) =>
    url === "vpn" ? new Promise<void>(() => {}) : Promise.resolve(),
  );
  await expect(firstReachablePairingUrl(["vpn", "lan"], probe)).resolves.toBe("lan");
  expect(probe.mock.calls).toEqual([["vpn"], ["lan"]]);
});

it("keeps looking after a failed address and reports all failures when none work", async () => {
  await expect(
    firstReachablePairingUrl(["bad", "lan"], async (url) => {
      if (url === "bad") throw new Error("unreachable");
    }),
  ).resolves.toBe("lan");
  await expect(
    firstReachablePairingUrl(["bad"], async () => {
      throw new Error("unreachable");
    }),
  ).rejects.toBeInstanceOf(AggregateError);
});
