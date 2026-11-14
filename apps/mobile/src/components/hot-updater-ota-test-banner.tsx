import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hotUpdater } from "@/lib/hot-updater";

/**
 * Hot Updater 1.2 preview QA only: an unmistakable marker of an OTA bundle.
 * It shows only while a downloaded bundle runs, never on the build's built-in
 * bundle, so seeing the magenta frame and banner proves the pull request's
 * OTA bundle is the one running.
 */
const OTA_TEST_COLOR = "#d946ef";

export function HotUpdaterOtaTestBanner() {
  const insets = useSafeAreaInsets();
  if (hotUpdater === null) {
    return null;
  }
  const bundleId = hotUpdater.getBundleId();
  // The built-in bundle reports the build's minimum bundle ID.
  if (bundleId === hotUpdater.getMinBundleId()) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        borderColor: OTA_TEST_COLOR,
        borderWidth: 6,
      }}
    >
      <View
        style={{
          backgroundColor: OTA_TEST_COLOR,
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "800" }}>
          OTA TEST · PR PREVIEW · LANES
        </Text>
        <Text
          style={{
            color: "#ffffff",
            fontSize: 13,
            fontWeight: "600",
            marginTop: 2,
          }}
        >
          {`${hotUpdater.getChannel()} · bundle ${bundleId.slice(-8)}`}
        </Text>
        <Text style={{ color: "#fdf4ff", fontSize: 12, marginTop: 2 }}>
          You see this only when the pull request's OTA bundle runs.
        </Text>
      </View>
    </View>
  );
}
