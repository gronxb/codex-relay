import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { PairingSessionStore, PendingPairing } from "./pairing-store.js";

type Options = {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
  sessions: Pick<PairingSessionStore, "getPendingPairing" | "approvePendingPairing">;
  onApproved: (pairing: PendingPairing) => void;
};

export function createTerminalPairingApprover(options: Options) {
  const queue: PendingPairing[] = [];
  let active: PendingPairing | undefined;
  let reader: Interface | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let answering = false;
  let closed = false;

  function print(message: string) {
    options.output.write(`${message}\n`);
  }

  function close() {
    closed = true;
    queue.length = 0;
    active = undefined;
    clearTimeout(expiry);
    reader?.close();
  }

  function next() {
    if (closed || active || answering) return;
    clearTimeout(expiry);
    active = queue.shift();
    while (active && active.expiresAt <= Date.now()) {
      active = queue.shift();
    }
    if (!active) return;
    const clientName = (active.clientName ?? "mobile device")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .slice(0, 80);
    print(`\nPairing request from ${clientName}. Code: ${active.approvalCode}`);
    print("Check that this code matches your phone. Approve? [y/N] (then Enter)");
    expiry = setTimeout(
      () => {
        print("Pairing request expired. Open the pairing link again to retry.");
        active = undefined;
        next();
      },
      Math.max(1, active.expiresAt - Date.now()),
    );
  }

  async function answer(line: string) {
    if (!active || answering || closed) return;
    const pairing = active;
    active = undefined;
    answering = true;
    clearTimeout(expiry);
    try {
      if (!/^(y|yes)$/i.test(line.trim())) {
        print("Not approved. You can still use the approve command for this request.");
        return;
      }
      // The store rechecks expiry at the moment of approval, not just at display.
      const approved = await options.sessions.approvePendingPairing(
        pairing.approvalCode,
        Date.now(),
      );
      if (approved) {
        options.onApproved(approved);
      } else {
        print(
          "This pairing request expired or was already completed. Open the pairing link again.",
        );
      }
    } catch {
      print("Could not approve pairing. Try the approve command or open the pairing link again.");
    } finally {
      answering = false;
      next();
    }
  }

  return {
    close,
    async request(approvalCode: string) {
      // Never interpret redirected/piped input as consent.
      if (closed || !options.input.isTTY || !options.output.isTTY) return;
      try {
        const pairing = await options.sessions.getPendingPairing(approvalCode, Date.now());
        if (!pairing || pairing.approved || closed) return;
        if (
          active?.approvalCode === approvalCode ||
          queue.some((item) => item.approvalCode === approvalCode)
        )
          return;
        if (queue.length >= 10) {
          print("More pairing requests are waiting. Use the approve command for this request.");
          return;
        }
        if (!reader) {
          // Keep the terminal's normal line input and Ctrl-C behavior.
          reader = createInterface({ input: options.input, terminal: false });
          reader.on("line", (line) => void answer(line));
          reader.on("close", close);
        }
        queue.push(pairing);
        next();
      } catch {
        print("Could not show pairing approval. Use the approve command instead.");
      }
    },
  };
}
