import { describe, expect, it } from "vitest";

import { createTursoPairingSessionStore } from "../src/pairing-store.js";
import {
  createExpoPushNotificationSender,
  createPushNotificationDispatcher,
  type PushNotificationSender,
  type RelayPushNotification,
} from "../src/push-notifications.js";

describe("Expo push notification sender", () => {
  it("sends generic relay payloads and identifies invalid device tokens", async () => {
    const requests: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, input });
      return new Response(
        JSON.stringify({
          data: [
            { id: "ticket-ok", status: "ok" },
            {
              details: { error: "DeviceNotRegistered" },
              message: "The device is not registered for push notifications.",
              status: "error",
            },
          ],
        }),
        { status: 200 },
      );
    };
    const sender = createExpoPushNotificationSender(fetchImpl as typeof fetch);

    const delivery = await sender.send([
      {
        body: "Finished working.",
        data: { intent: "turn_terminal", threadId: "thread-1", turnId: "turn-1" },
        title: "Push notification improvements",
        to: "ExponentPushToken[active]",
      },
      {
        body: "Codex needs your attention.",
        data: { intent: "action_required", threadId: "thread-2" },
        title: "Codex Relay",
        to: "ExponentPushToken[stale]",
      },
    ]);

    expect(delivery.invalidExpoPushTokens).toEqual(["ExponentPushToken[stale]"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://exp.host/--/api/v2/push/send");
    expect(requests[0]?.init).toMatchObject({ method: "POST" });
    const payload = JSON.parse(String(requests[0]?.init?.body));
    expect(payload).toEqual([
      expect.objectContaining({
        body: "Finished working.",
        data: { intent: "turn_terminal", threadId: "thread-1", turnId: "turn-1" },
        title: "Push notification improvements",
      }),
      expect.objectContaining({
        body: "Codex needs your attention.",
        data: { intent: "action_required", threadId: "thread-2" },
        title: "Codex Relay",
      }),
    ]);
  });
});

describe("push notification dispatcher", () => {
  it("routes only opted-in intents and removes device-not-registered subscriptions", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("turn-token", {
      clientSessionId: "turn-device",
      expiresAt,
    });
    await sessions.createSession("action-token", {
      clientSessionId: "action-device",
      expiresAt,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: false,
      clientSessionId: "turn-device",
      expoPushToken: "ExponentPushToken[turn-device]",
      includeRemainingUsage: true,
      platform: "ios",
      turnTerminal: true,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: true,
      clientSessionId: "action-device",
      expoPushToken: "ExponentPushToken[action-device]",
      includeRemainingUsage: false,
      platform: "android",
      turnTerminal: false,
    });

    const sent: RelayPushNotification[][] = [];
    const sender: PushNotificationSender = {
      async send(notifications) {
        sent.push([...notifications]);
        return {
          invalidExpoPushTokens: notifications
            .filter((notification) => notification.to === "ExponentPushToken[turn-device]")
            .map((notification) => notification.to),
        };
      },
    };
    const dispatcher = createPushNotificationDispatcher({
      readRemainingUsagePercent: async () => 37,
      sender,
      sessions,
    });

    await dispatcher.dispatch({
      intent: "turn_terminal",
      threadId: "thread-1",
      threadTitle: "Push notification improvements",
      turnId: "turn-1",
    });
    await dispatcher.dispatch({
      intent: "action_required",
      threadId: "thread-2",
      threadTitle: "Approval handling",
      turnId: "turn-2",
    });

    expect(sent).toEqual([
      [
        expect.objectContaining({
          body: "Finished working. Remaining usage: 37%",
          data: { intent: "turn_terminal", threadId: "thread-1", turnId: "turn-1" },
          title: "Push notification improvements",
          to: "ExponentPushToken[turn-device]",
        }),
      ],
      [
        expect.objectContaining({
          body: "Codex needs your attention.",
          data: { intent: "action_required", threadId: "thread-2", turnId: "turn-2" },
          title: "Approval handling",
          to: "ExponentPushToken[action-device]",
        }),
      ],
    ]);
    expect(await sessions.getPushNotificationSubscription("turn-device")).toBeUndefined();
    expect(await sessions.getPushNotificationSubscription("action-device")).toEqual(
      expect.objectContaining({ expoPushToken: "ExponentPushToken[action-device]" }),
    );
  });
});
