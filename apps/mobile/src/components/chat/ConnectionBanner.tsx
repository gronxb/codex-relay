import { Linking, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Fonts } from "@/constants/theme";
import { workspaceName } from "@/lib/workspace-name";

const tailscaleAppStoreUrl = "https://apps.apple.com/us/app/tailscale/id1470499037";

export function ConnectionBanner({
  connection,
  error,
  hasPairedSession,
  onRefresh,
  onScanConnect,
  serverUrl,
  workspacePath,
}: {
  connection: "checking" | "connected" | "offline";
  error?: string;
  hasPairedSession: boolean;
  onRefresh: () => void;
  onScanConnect: () => void;
  serverUrl: string;
  workspacePath?: string;
}) {
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
                {hasPairedSession ? statusText : "No paired computer yet"}
              </ThemedText>
            </View>
          </View>
          <View style={styles.onboardingIntro}>
            <ThemedText type="smallBold" style={styles.onboardingTitle}>
              Pair this phone once
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.onboardingCopy}>
              Run one command on your computer, scan the QR code, then approve the phone in that
              same terminal.
            </ThemedText>
          </View>
          <View style={styles.stepList}>
            <PairingStep
              icon="terminal"
              label="1"
              title="Start the relay"
              body="Open Terminal on your computer and run:"
              command="npx codex-relay@latest"
            />
            <PairingStep
              icon="workspace"
              label="2"
              title="Choose Wi-Fi or Tailscale"
              body="Same Wi-Fi is enough nearby. To use Codex Relay away from this Wi-Fi, install Tailscale on your computer and phone, sign in to the same account, and make sure both say Connected before scanning."
              actionLabel="Open Tailscale on App Store"
              actionAccessibilityLabel="Open Tailscale on the App Store"
              onAction={() => void Linking.openURL(tailscaleAppStoreUrl)}
            />
            <PairingStep
              icon="check"
              label="3"
              title="Scan and approve"
              body="Scan the QR shown in Terminal. When a code appears, approve it on your computer."
            />
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
              <Icon name="workspace" size={16} tintColor="#141414" />
              <ThemedText type="smallBold" style={styles.primaryActionText}>
                Scan QR
              </ThemedText>
            </Button>
            {hasPairedSession ? (
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
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    );
  }

  return null;
}

function PairingStep({
  body,
  command,
  icon,
  label,
  actionAccessibilityLabel,
  actionLabel,
  onAction,
  title,
}: {
  actionAccessibilityLabel?: string;
  actionLabel?: string;
  body: string;
  command?: string;
  icon: "check" | "terminal" | "workspace";
  label: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepMarker}>
        <Icon name={icon} size={15} tintColor="#F2F2F2" />
      </View>
      <View style={styles.stepCopy}>
        <View style={styles.stepTitleRow}>
          <ThemedText type="smallBold" style={styles.stepNumber}>
            {label}
          </ThemedText>
          <ThemedText type="smallBold" style={styles.stepTitle}>
            {title}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.stepBody}>
          {body}
        </ThemedText>
        {command ? (
          <View style={styles.commandBox}>
            <ThemedText type="smallBold" style={styles.commandText}>
              {command}
            </ThemedText>
          </View>
        ) : null}
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
            onPress={onAction}
            style={({ pressed }) => [styles.stepAction, pressed && styles.pressed]}
          >
            <ThemedText type="smallBold" style={styles.stepActionText}>
              {actionLabel}
            </ThemedText>
            <Icon name="externalLink" size={13} tintColor="#F2F2F2" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
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
  onboardingIntro: {
    gap: 4,
  },
  onboardingTitle: {
    fontSize: 18,
    lineHeight: 23,
  },
  onboardingCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepList: {
    gap: 10,
  },
  stepRow: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  stepMarker: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  stepCopy: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  stepTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  stepNumber: {
    color: "#B8C7FF",
    fontSize: 11,
    lineHeight: 14,
  },
  stepTitle: {
    fontSize: 13,
    lineHeight: 17,
  },
  stepBody: {
    fontSize: 12,
    lineHeight: 16,
  },
  commandBox: {
    backgroundColor: "rgba(0, 0, 0, 0.24)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  commandText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  stepAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  stepActionText: {
    color: "#F2F2F2",
    fontSize: 12,
    lineHeight: 16,
  },
  pairActions: {
    gap: 8,
  },
  pairButton: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  primaryActionText: {
    color: "#141414",
    fontSize: 13,
    lineHeight: 17,
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
  pressed: {
    opacity: 0.7,
  },
});
