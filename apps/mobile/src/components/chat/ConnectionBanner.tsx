import { Star } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { FaGithub } from "@/assets/icons/fa";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { codexRelayRepositoryUrl } from "@/constants/links";
import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function ConnectionBanner({
  connection,
  error,
  hasPairedSession,
  onPastePayload,
  onRefresh,
  onScanConnect,
  serverUrl,
  workspacePath,
}: {
  connection: "checking" | "connected" | "offline";
  error?: string;
  hasPairedSession: boolean;
  onPastePayload: () => void;
  onRefresh: () => void;
  onScanConnect: () => void;
  serverUrl: string;
  workspacePath?: string;
}) {
  const theme = useTheme();
  const isConnected = connection === "connected";
  const statusText = isConnected
    ? `Connected · ${workspaceName(workspacePath) ?? compactServer(serverUrl)}`
    : connection === "checking"
      ? `Checking · ${compactServer(serverUrl)}`
      : (error ?? `Offline · ${compactServer(serverUrl)}`);

  if (hasPairedSession && !isConnected) {
    return (
      <Animated.View
        entering={connectionBannerEnterTransition}
        exiting={connectionBannerExitTransition}
        layout={connectionBannerLayoutTransition}
        style={styles.container}
      >
        <Animated.View layout={connectionBannerLayoutTransition} style={styles.pairPanel}>
          <View style={styles.pairHeader}>
            <View
              style={[
                styles.pairStatusDot,
                connection === "checking" && styles.pairStatusDotChecking,
              ]}
            />
            <View style={styles.pairCopy}>
              <ThemedText type="smallBold" style={styles.pairTitle}>
                {connection === "checking"
                  ? "Connecting to your computer"
                  : "Reconnecting to your computer"}
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.pairSubtitle}
                numberOfLines={2}
              >
                {connection === "checking"
                  ? `Checking · ${compactServer(serverUrl)}`
                  : (error ?? `Waiting for ${compactServer(serverUrl)}`)}
              </ThemedText>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    );
  }

  if (connection === "offline") {
    return (
      <Animated.View
        entering={connectionBannerEnterTransition}
        exiting={connectionBannerExitTransition}
        layout={connectionBannerLayoutTransition}
        style={styles.container}
      >
        <Animated.View layout={connectionBannerLayoutTransition} style={styles.pairPanel}>
          <View style={styles.pairHeader}>
            <View style={styles.pairStatusDot} />
            <View style={styles.pairCopy}>
              <ThemedText type="smallBold" style={styles.pairTitle}>
                Connect to your computer
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.pairSubtitle}
                numberOfLines={2}
              >
                {statusText}
              </ThemedText>
            </View>
          </View>
          <View style={styles.commandBox}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.commandLabel}>
              Run on your computer
            </ThemedText>
            <ThemedText type="smallBold" style={styles.commandText}>
              npx codex-relay@latest
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.commandHint}>
              Keep this phone and computer on the same Wi-Fi. If not, connect both with Tailscale
              first.
            </ThemedText>
          </View>
          <View style={styles.pairActions}>
            <Button
              accessibilityRole="button"
              accessibilityLabel="Scan connection QR"
              onPress={onScanConnect}
              size="lg"
              variant="default"
              className="h-11 rounded-lg"
              style={styles.pairButton}
            >
              <ThemedText type="smallBold" style={styles.primaryActionText}>
                Scan QR
              </ThemedText>
            </Button>
            <Button
              accessibilityRole="button"
              accessibilityLabel="Paste connection QR payload"
              onPress={onPastePayload}
              size="lg"
              variant="outline"
              className="h-11 rounded-lg border-border bg-background"
              style={styles.pairButton}
            >
              <ThemedText type="smallBold" style={styles.secondaryActionText}>
                Paste QR
              </ThemedText>
            </Button>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh connection"
              onPress={onRefresh}
              style={({ pressed }) => [styles.refreshAction, pressed && styles.pressed]}
            >
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.refreshText}>
                Refresh connection
              </ThemedText>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open Codex Relay GitHub repository"
            onPress={() => void Linking.openURL(codexRelayRepositoryUrl)}
            style={({ pressed }) => [
              styles.repositoryLink,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.repositoryIcon,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            >
              <FaGithub size={16} color={theme.text} />
            </View>
            <View style={styles.repositoryCopy}>
              <ThemedText type="smallBold" style={[styles.repositoryTitle, { color: theme.text }]}>
                Codex Relay on GitHub
              </ThemedText>
            </View>
            <View style={[styles.repositoryStar, { backgroundColor: theme.backgroundElement }]}>
              <Star size={12} color={theme.text} fill={theme.text} />
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    );
  }

  return null;
}

function workspaceName(workspacePath: string | undefined) {
  if (!workspacePath) {
    return undefined;
  }
  const parts = workspacePath.split("/").filter(Boolean);
  return parts.at(-1);
}

function compactServer(serverUrl: string) {
  return serverUrl.replace(/^https?:\/\//, "");
}

const connectionBannerLayoutTransition = LinearTransition.duration(180);
const connectionBannerEnterTransition = FadeIn.duration(150);
const connectionBannerExitTransition = FadeOut.duration(120);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingVertical: 2,
  },
  statusLine: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(42, 42, 42, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusLineConnected: {
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: {
    backgroundColor: "#f2b84b",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  connected: {
    backgroundColor: "#2ca36f",
  },
  offline: {
    backgroundColor: "#d84f4f",
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 15,
  },
  pairPanel: {
    backgroundColor: "rgba(42, 42, 42, 0.92)",
    borderColor: "rgba(255, 255, 255, 0.11)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
    position: "relative",
  },
  pairHeader: {
    minHeight: 37,
    paddingLeft: 17,
  },
  pairStatusDot: {
    backgroundColor: "#d84f4f",
    borderRadius: 4,
    height: 8,
    left: 0,
    position: "absolute",
    top: 6,
    width: 8,
  },
  pairStatusDotChecking: {
    backgroundColor: "#f2b84b",
  },
  pairCopy: {
    gap: 2,
    minWidth: 0,
  },
  pairTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  pairSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  commandBox: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commandLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  commandText: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 17,
  },
  commandHint: {
    fontSize: 12,
    lineHeight: 16,
    paddingTop: 3,
  },
  pairActions: {
    gap: 8,
  },
  pairButton: {
    width: "100%",
  },
  primaryActionText: {
    color: "#141414",
    fontSize: 13,
    lineHeight: 17,
  },
  secondaryActionText: {
    fontSize: 12,
    lineHeight: 16,
  },
  refreshAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
  },
  refreshText: {
    fontSize: 12,
    lineHeight: 16,
  },
  repositoryLink: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  repositoryIcon: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  repositoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  repositoryTitle: {
    fontSize: 12,
    lineHeight: 15,
  },
  repositoryStar: {
    alignItems: "center",
    borderRadius: 12,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  pressed: {
    opacity: 0.7,
  },
});
