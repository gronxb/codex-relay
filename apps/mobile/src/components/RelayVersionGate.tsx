import { useSelector } from "@legendapp/state/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { type ReactNode, useMemo } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { CopyableCommand } from "@/components/ui/copyable-command";
import { Colors, Spacing } from "@/constants/theme";
import { hasCodexRelaySession, signOutCodexRelaySession } from "@/lib/codex-relay-api";
import { clearServerState, serverStateKeys, serverStateQueryFns } from "@/lib/server-state";
import { evaluateRelayVersion } from "@/lib/version-policy";
import { chatStore$, resetChatSessionState } from "@/state/chat-store";

export function RelayVersionGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const hasPairedSession = useSelector(() => chatStore$.hasPairedSession.get());
  const shouldVerifyRelay = hasPairedSession || hasCodexRelaySession();
  const versionQuery = useQuery({
    queryKey: serverStateKeys.version(),
    queryFn: serverStateQueryFns.version,
    enabled: shouldVerifyRelay,
    retry: false,
    staleTime: 0,
  });
  const compatibility = useMemo(
    () => evaluateRelayVersion(versionQuery.data, versionQuery.error),
    [versionQuery.data, versionQuery.error],
  );

  if (!shouldVerifyRelay || compatibility?.compatible) {
    return children;
  }

  function useAnotherRelay() {
    signOutCodexRelaySession();
    clearServerState(queryClient);
    resetChatSessionState();
    router.replace("/");
  }

  if (!compatibility) {
    return <RelayVersionChecking />;
  }

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View accessibilityRole="alert" style={styles.card}>
          <ThemedText type="subtitle" style={styles.title}>
            Update codex-relay
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {compatibility.reason} Update the relay on your computer, then check again.
          </ThemedText>
          <ThemedText type="code">Current: {compatibility.current}</ThemedText>
          <ThemedText type="code">Required: {compatibility.required}</ThemedText>
          <View style={styles.commandBlock}>
            <ThemedText type="smallBold">Run on your computer</ThemedText>
            <CopyableCommand
              command={compatibility.updateCommand}
              copyAccessibilityLabel="Copy relay update command"
            />
          </View>
          <Button
            accessibilityRole="button"
            accessibilityLabel="Check relay version again"
            className="h-11 rounded-lg"
            disabled={versionQuery.isFetching}
            onPress={() => void versionQuery.refetch()}
          >
            {versionQuery.isFetching ? <ActivityIndicator color="#161616" size="small" /> : null}
            <ThemedText type="smallBold" style={styles.primaryActionText}>
              {versionQuery.isFetching ? "Checking" : "Check again"}
            </ThemedText>
          </Button>
          <Button
            accessibilityRole="button"
            accessibilityLabel="Use another relay"
            className="h-10 rounded-lg"
            onPress={useAnotherRelay}
            variant="ghost"
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              Use another relay
            </ThemedText>
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

function RelayVersionChecking() {
  return (
    <SafeAreaView edges={["top", "bottom", "left", "right"]} style={styles.safeArea}>
      <View accessible accessibilityLabel="Checking codex-relay version" style={styles.checking}>
        <ActivityIndicator color={Colors.dark.text} size="small" />
        <ThemedText type="smallBold">Checking codex-relay</ThemedText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#191919",
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    backgroundColor: "#222323",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: 1,
    gap: Spacing.three,
    maxWidth: 520,
    padding: Spacing.four,
    width: "100%",
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  commandBlock: {
    gap: Spacing.two,
  },
  primaryActionText: {
    color: "#161616",
  },
  checking: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.three,
    justifyContent: "center",
  },
});
