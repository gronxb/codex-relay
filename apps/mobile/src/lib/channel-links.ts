import { Linking } from "react-native";

import { hotUpdater } from "@/lib/hot-updater";

/** v1.2 QA: the QA preview build's default channel, the only build that opens channel links. */
const QA_PREVIEW_CHANNEL = "qa-v12-preview";

/** v1.2 QA: marks the JavaScript of the QA OTA bundles, so they differ from the built-in bundle. */
export const QA_OTA_MARK = "qa-v12-ota-1";

const openLink = async (url: string | null | undefined, initial: boolean) => {
  if (!url || hotUpdater === null) return;
  try {
    const result = await hotUpdater.openChannelLink(url, {
      updateStrategy: "appVersion",
      defaultChannels: [QA_PREVIEW_CHANNEL],
      initial,
    });
    console.log("[hot-updater-qa] openChannelLink", QA_OTA_MARK, url, result.status);
  } catch (error) {
    console.warn("[hot-updater-qa] Couldn't open the channel", error);
  }
};

/** Passes every URL the app opens to openChannelLink. */
export const listenForChannelLinks = () => {
  void Linking.getInitialURL().then((url) => openLink(url, true));
  const subscription = Linking.addEventListener("url", ({ url }) => void openLink(url, false));
  return () => subscription.remove();
};
