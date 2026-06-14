import { Drawer } from "expo-router/drawer";
import { Pressable, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { ThreadDrawerContent } from "@/components/chat/ThreadDrawerContent";
import {
  EXPANDED_DRAWER_BREAKPOINT,
  IpadSplitLayoutProvider,
  useIpadSplitLayout,
} from "@/components/chat/ipad-split-layout";
import { Icon, type AppIconName } from "@/components/ui/icon";
import { Colors } from "@/constants/theme";
import { hapticMediumImpact } from "@/lib/haptics";

const COMPACT_DRAWER_WIDTH = 320;
const COLLAPSED_DRAWER_WIDTH = 52;

export default function DrawerLayout() {
  return (
    <IpadSplitLayoutProvider>
      <DrawerLayoutContent />
    </IpadSplitLayoutProvider>
  );
}

function DrawerLayoutContent() {
  const { width } = useWindowDimensions();
  const { beginSidebarResize, isSidebarVisible, resizeSidebar, setSidebarVisible, sidebarWidth } =
    useIpadSplitLayout();
  const usesExpandedDrawer = width >= EXPANDED_DRAWER_BREAKPOINT;
  const showsExpandedDrawer = usesExpandedDrawer && isSidebarVisible;
  const showsCollapsedRail = usesExpandedDrawer && !isSidebarVisible;

  function expandSidebar() {
    setSidebarVisible(true);
    hapticMediumImpact();
  }

  return (
    <Drawer
      drawerContent={(props) =>
        showsExpandedDrawer || !usesExpandedDrawer ? (
          <ThreadDrawerContent
            isPermanent={showsExpandedDrawer}
            showResizeHandle={showsExpandedDrawer}
            onSidebarResize={resizeSidebar}
            onSidebarResizeStart={beginSidebarResize}
            {...props}
          />
        ) : showsCollapsedRail ? (
          <CollapsedThreadSidebarRail onExpand={expandSidebar} />
        ) : null
      }
      screenOptions={{
        drawerType: usesExpandedDrawer ? "permanent" : "front",
        headerShown: false,
        swipeEnabled: false,
        sceneStyle: {
          backgroundColor: "#191919",
        },
        drawerStyle: {
          backgroundColor: "#202222",
          borderRightColor: "rgba(255, 255, 255, 0.08)",
          borderRightWidth: usesExpandedDrawer ? 1 : 0,
          overflow: showsExpandedDrawer ? "visible" : "hidden",
          width: usesExpandedDrawer
            ? showsExpandedDrawer
              ? sidebarWidth
              : COLLAPSED_DRAWER_WIDTH
            : COMPACT_DRAWER_WIDTH,
        },
        overlayColor: usesExpandedDrawer ? "transparent" : "rgba(0, 0, 0, 0.28)",
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          drawerLabel: "Threads",
          title: "Codex Relay",
        }}
      />
      {__DEV__ ? (
        <Drawer.Screen
          name="preview"
          options={{
            drawerItemStyle: { display: "none" },
            title: "Chat Preview",
          }}
        />
      ) : null}
    </Drawer>
  );
}

function CollapsedThreadSidebarRail({ onExpand }: { onExpand: () => void }) {
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.collapsedRail}>
      <View style={styles.collapsedRailTop}>
        <CollapsedRailButton icon="sidebarShow" label="Show threads" onPress={onExpand} />
        <CollapsedRailButton icon="search" label="Open thread search" onPress={onExpand} />
        <CollapsedRailButton icon="newChat" label="Open new chat" onPress={onExpand} />
      </View>
      <CollapsedRailButton icon="settings" label="Open settings" onPress={onExpand} />
    </SafeAreaView>
  );
}

function CollapsedRailButton({
  icon,
  label,
  onPress,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.collapsedRailButton, pressed && styles.pressed]}
    >
      <Icon name={icon} size={17} tintColor={Colors.dark.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collapsedRail: {
    alignItems: "center",
    backgroundColor: "#202222",
    flex: 1,
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingTop: 10,
    width: COLLAPSED_DRAWER_WIDTH,
  },
  collapsedRailButton: {
    alignItems: "center",
    borderRadius: 9,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  collapsedRailTop: {
    gap: 8,
  },
  pressed: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    opacity: 0.72,
  },
});
