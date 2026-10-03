import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { WorkspaceSshTerminalTab } from "@/components/chat/workspace-preview/WorkspaceSshTerminalTab";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { Colors, Spacing } from "@/constants/theme";
import { hapticSelection } from "@/lib/haptics";
import { serverStateKeys, serverStateQueryFns } from "@/lib/server-state";

// One terminal session shared by every visit to this screen while the app is alive.
const sshScreenSessionKey = "ssh-screen";

export default function SshScreen() {
  const statusQuery = useQuery({
    queryKey: serverStateKeys.status(),
    queryFn: serverStateQueryFns.status,
    enabled: false,
  });
  const workspacePath = statusQuery.data?.workspacePath;

  function closeScreen() {
    hapticSelection();
    void KeyboardController.dismiss().catch(() => undefined);
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close SSH"
          onPress={closeScreen}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Icon name="back" size={18} tintColor={Colors.dark.text} />
        </Pressable>
        <View style={styles.titleGroup}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            SSH
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {workspacePath ?? "Relay workspace"}
          </ThemedText>
        </View>
      </View>
      <View style={styles.terminal}>
        <WorkspaceSshTerminalTab persistentSessionKey={sshScreenSessionKey} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.dark.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "rgba(132, 145, 165, 0.16)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 58,
    paddingHorizontal: Spacing.three,
  },
  iconButton: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  pressed: {
    opacity: 0.72,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    lineHeight: 19,
  },
  terminal: {
    flex: 1,
    minHeight: 0,
    paddingTop: Spacing.three,
  },
});
