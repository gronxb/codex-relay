import { HotUpdater, insights, remoteConfig } from "@hot-updater/react-native";
import Constants from "expo-constants";

export const hotUpdaterBaseUrl = process.env.EXPO_PUBLIC_HOT_UPDATER_BASE_URL?.trim();

const hotUpdaterApiKey =
  process.env.EXPO_PUBLIC_HOT_UPDATER_API_KEY?.trim() ||
  (typeof Constants.expoConfig?.extra?.hotUpdaterApiKey === "string"
    ? Constants.expoConfig.extra.hotUpdaterApiKey.trim()
    : undefined);

/** What the app reads until it activates Remote Config values, and for keys the template leaves to it. */
export const REMOTE_CONFIG_DEFAULTS = {
  /** A note the hidden Hot Updater panel shows when it is not empty. */
  settings_notice: "",
};

/** Hot Updater for the app, or null in a build without an update server. */
export const hotUpdater = hotUpdaterBaseUrl
  ? HotUpdater.init({
      plugins: [insights(), remoteConfig({ defaults: REMOTE_CONFIG_DEFAULTS })],
      baseURL: hotUpdaterBaseUrl,
      requestHeaders: hotUpdaterApiKey ? { "x-api-key": hotUpdaterApiKey } : undefined,
    })
  : null;
