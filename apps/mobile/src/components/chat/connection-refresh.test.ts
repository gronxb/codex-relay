import { describe, expect, it, vi } from "vitest";

import { runConnectionRefresh } from "./connection-refresh";

describe("runConnectionRefresh", () => {
  it("marks the relay connected when status resolves while data refresh is still pending", async () => {
    const status = { reachable: true };
    const dataRequest = new Promise<never>(() => undefined);
    const onStatus = vi.fn<(resolvedStatus: typeof status) => void>();

    void runConnectionRefresh(Promise.resolve(status), dataRequest, onStatus);
    await Promise.resolve();

    expect(onStatus).toHaveBeenCalledWith(status);
  });
});
