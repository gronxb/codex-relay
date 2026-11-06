import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hotUpdater } from "@/lib/hot-updater";

/**
 * Hot Updater 1.2 sandbox QA only: says which bundle runs. The sandbox build's
 * built-in bundle shows its own channel (sandbox-sandbox); a pull request's
 * bundle opened from the sandbox screen shows pr-<number> and this revision.
 */
export const HOT_UPDATER_QA_REVISION = "PR bundle rev 1";

export function HotUpdaterQaBadge() {
  const insets = useSafeAreaInsets();
  if (hotUpdater === null) {
    return null;
  }
  const bundleId = hotUpdater.getBundleId();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: insets.bottom + 8,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          backgroundColor: "#f59e0b",
          borderRadius: 8,
          color: "#111111",
          fontSize: 12,
          fontWeight: "700",
          overflow: "hidden",
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        {`HU QA · ${HOT_UPDATER_QA_REVISION} · ${hotUpdater.getChannel()} · ${bundleId.slice(-8)}`}
      </Text>
    </View>
  );
}
