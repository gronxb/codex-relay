// Probe without creating pairing attempts: only the winning address gets an
// approval request. A dead VPN address must not delay a reachable LAN address.
export async function firstReachablePairingUrl(
  urls: string[],
  probe: (url: string) => Promise<void>,
) {
  return Promise.any(
    urls.map(async (url) => {
      await probe(url);
      return url;
    }),
  );
}
