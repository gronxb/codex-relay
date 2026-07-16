import type { PairingSessionStore } from "./pairing-store.js";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";
const expoPushChunkSize = 100;

export type PushNotificationIntent = "turn_terminal" | "action_required";

export type RelayPushNotification = {
  body: string;
  data: {
    intent: PushNotificationIntent;
    threadId: string;
    turnId?: string;
  };
  title: "Codex Relay";
  to: string;
};

export type PushNotificationEvent = {
  intent: PushNotificationIntent;
  threadId: string;
  turnId?: string;
};

export type PushNotificationDelivery = {
  invalidExpoPushTokens: readonly string[];
};

export type PushNotificationSender = {
  send(notifications: readonly RelayPushNotification[]): Promise<PushNotificationDelivery>;
};

export type PushNotificationDispatcher = {
  dispatch(event: PushNotificationEvent): Promise<void>;
};

export function createExpoPushNotificationSender(
  fetchImpl: typeof fetch = fetch,
): PushNotificationSender {
  return {
    async send(notifications) {
      const invalidExpoPushTokens = new Set<string>();
      for (const chunk of chunks(notifications, expoPushChunkSize)) {
        const response = await fetchImpl(expoPushEndpoint, {
          body: JSON.stringify(
            chunk.map((notification) => ({
              body: notification.body,
              channelId: "default",
              data: notification.data,
              priority: "high",
              sound: "default",
              title: notification.title,
              to: notification.to,
            })),
          ),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          method: "POST",
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          throw new Error(`Expo push service returned ${response.status}.`);
        }

        const tickets = expoPushTickets(body);
        for (const [index, ticket] of tickets.entries()) {
          const notification = chunk[index];
          if (notification && isDeviceNotRegistered(ticket)) {
            invalidExpoPushTokens.add(notification.to);
          }
        }
      }

      return { invalidExpoPushTokens: [...invalidExpoPushTokens] };
    },
  };
}

export function createPushNotificationDispatcher(input: {
  sender: PushNotificationSender;
  sessions: PairingSessionStore;
}): PushNotificationDispatcher {
  return {
    async dispatch(event) {
      const subscriptions = await input.sessions.listActivePushNotificationSubscriptions(
        Date.now(),
      );
      const selectedTokens = new Set(
        subscriptions
          .filter((subscription) => notificationEnabled(subscription, event.intent))
          .map((subscription) => subscription.expoPushToken),
      );
      if (selectedTokens.size === 0) {
        return;
      }

      const delivery = await input.sender.send(
        [...selectedTokens].map((expoPushToken) => notificationForEvent(expoPushToken, event)),
      );
      await Promise.all(
        delivery.invalidExpoPushTokens.map((expoPushToken) =>
          input.sessions.deletePushNotificationSubscriptionsByExpoPushToken(expoPushToken),
        ),
      );
    },
  };
}

function notificationEnabled(
  subscription: { actionRequired: boolean; turnTerminal: boolean },
  intent: PushNotificationIntent,
) {
  return intent === "action_required" ? subscription.actionRequired : subscription.turnTerminal;
}

function notificationForEvent(
  expoPushToken: string,
  event: PushNotificationEvent,
): RelayPushNotification {
  return {
    body:
      event.intent === "action_required"
        ? "Codex needs your attention."
        : "A Codex turn has finished.",
    data: {
      intent: event.intent,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
    },
    title: "Codex Relay",
    to: expoPushToken,
  };
}

function expoPushTickets(value: unknown) {
  if (!value || typeof value !== "object") {
    return [];
  }
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) ? data : [];
}

function isDeviceNotRegistered(ticket: unknown) {
  if (!ticket || typeof ticket !== "object") {
    return false;
  }
  const record = ticket as { details?: unknown; status?: unknown };
  if (record.status !== "error" || !record.details || typeof record.details !== "object") {
    return false;
  }
  return (record.details as { error?: unknown }).error === "DeviceNotRegistered";
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
