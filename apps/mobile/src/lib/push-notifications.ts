import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

let foregroundNotificationHandlerConfigured = false;

export function configurePushNotificationPresentation() {
  if (!supportsPushNotifications() || foregroundNotificationHandlerConfigured) {
    return;
  }
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  foregroundNotificationHandlerConfigured = true;
}

export function supportsPushNotifications() {
  return Platform.OS === "android" || Platform.OS === "ios";
}

export async function getExpoPushToken() {
  const platform = pushNotificationPlatform();
  if (platform === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "Codex Relay",
    });
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  const permissions =
    existingPermissions.status === "granted"
      ? existingPermissions
      : await Notifications.requestPermissionsAsync();
  if (permissions.status !== "granted") {
    throw new Error("Notifications are not allowed for Codex Relay.");
  }

  const projectId = expoProjectId();
  if (!projectId) {
    throw new Error("This app build is missing its Expo project identifier.");
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export function notificationResponseThreadId(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data;
  const threadId = data?.threadId;
  return typeof threadId === "string" && threadId.trim() ? threadId : undefined;
}

export function pushNotificationPlatform(): "android" | "ios" {
  if (Platform.OS === "android" || Platform.OS === "ios") {
    return Platform.OS;
  }
  throw new Error("Push notifications are available only in the iOS and Android apps.");
}

function expoProjectId() {
  const easProjectId = Constants.easConfig?.projectId;
  if (typeof easProjectId === "string" && easProjectId.trim()) {
    return easProjectId;
  }
  const configProjectId = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof configProjectId === "string" && configProjectId.trim()
    ? configProjectId
    : undefined;
}
