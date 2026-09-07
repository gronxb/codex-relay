import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

import type { PendingPairing } from "../src/pairing-store.js";
import { createTerminalPairingApprover } from "../src/terminal-pairing.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.useRealTimers();
});

function harness(interactive = true) {
  let text = "";
  const input = Object.assign(new PassThrough(), { isTTY: interactive });
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        text += chunk.toString();
        callback();
      },
    }),
    { isTTY: interactive },
  );
  const pairings = new Map<string, PendingPairing>();
  const sessions = {
    getPendingPairing: vi.fn<(code: string, now: number) => Promise<PendingPairing | undefined>>(
      async (code, now) => {
        const pairing = pairings.get(code);
        return pairing && pairing.expiresAt > now ? pairing : undefined;
      },
    ),
    approvePendingPairing: vi.fn<
      (code: string, now: number) => Promise<PendingPairing | undefined>
    >(async (code, now) => {
      const pairing = pairings.get(code);
      if (!pairing || pairing.expiresAt <= now) return undefined;
      pairing.approved = true;
      return pairing;
    }),
  };
  const onApproved = vi.fn<(pairing: PendingPairing) => void>();
  const approver = createTerminalPairingApprover({ input, output, sessions, onApproved });
  cleanup.push(() => {
    approver.close();
    input.destroy();
    output.destroy();
  });
  function add(code: string, lifetime = 60_000) {
    pairings.set(code, {
      approvalCode: code,
      approved: false,
      clientName: "My iPhone",
      clientEphemeralPublicKey: "public-key",
      clientNonce: "nonce",
      serverUrl: "http://localhost:8787",
      expiresAt: Date.now() + lifetime,
    });
    return approver.request(code);
  }
  return { add, approver, input, sessions, onApproved, pairings, text: () => text };
}

it("shows the code in the running terminal and approves only after explicit yes", async () => {
  const h = harness();
  await h.add("1234-ABCD");
  expect(h.text()).toContain("My iPhone. Code: 1234-ABCD");
  expect(h.text()).toContain("Approve? [y/N]");
  expect(h.sessions.approvePendingPairing).not.toHaveBeenCalled();
  h.input.write("y\n");
  await vi.waitFor(() => expect(h.onApproved).toHaveBeenCalledOnce());
  expect(h.sessions.approvePendingPairing).toHaveBeenCalledWith("1234-ABCD", expect.any(Number));
});

it.each(["\n", "n\n", "no\n", "npx codex-relay approve 1234-ABCD\n"])(
  "does not approve on other input: %j",
  async (answer) => {
    const h = harness();
    await h.add("1234-ABCD");
    h.input.write(answer);
    expect(h.text()).toContain("Not approved");
    expect(h.sessions.approvePendingPairing).not.toHaveBeenCalled();
  },
);

it("never reads piped input as consent", async () => {
  const h = harness(false);
  await h.add("1234-ABCD");
  h.input.write("yes\n");
  expect(h.sessions.getPendingPairing).not.toHaveBeenCalled();
  expect(h.sessions.approvePendingPairing).not.toHaveBeenCalled();
  expect(h.text()).toBe("");
});

it("queues requests without cancelling the active request's expiry", async () => {
  vi.useFakeTimers();
  const h = harness();
  await h.add("1111-AAAA", 1000);
  await h.add("2222-BBBB", 10_000);
  expect(h.text()).not.toContain("2222-BBBB");
  await vi.advanceTimersByTimeAsync(1001);
  expect(h.text()).toContain("Pairing request expired");
  expect(h.text()).toContain("2222-BBBB");
  expect(h.sessions.approvePendingPairing).not.toHaveBeenCalled();
});

it("does not apply buffered answers to requests that have not been displayed yet", async () => {
  const h = harness();
  await h.add("1111-AAAA");
  await h.add("2222-BBBB");
  h.input.write("y\ny\n");
  await vi.waitFor(() => expect(h.onApproved).toHaveBeenCalledOnce());
  expect(h.sessions.approvePendingPairing).toHaveBeenCalledTimes(1);
  expect(h.text()).toContain("2222-BBBB");
});

it("does not claim approval after a request was consumed or expired elsewhere", async () => {
  const h = harness();
  await h.add("1234-ABCD");
  h.pairings.delete("1234-ABCD");
  h.input.write("y\n");
  await vi.waitFor(() => expect(h.text()).toContain("expired or was already completed"));
  expect(h.onApproved).not.toHaveBeenCalled();
});
