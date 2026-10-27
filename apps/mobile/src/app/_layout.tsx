import "@/global.css";
import "expo-dev-client";
import "react-native-gesture-handler";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { DarkTheme, ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Text, TextInput } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { useInitialPushNotificationRegistration } from "@/hooks/use-initial-push-notification-registration";
import { hotUpdater } from "@/lib/hot-updater";
import {
  addHotUpdaterLog,
  formatHotUpdaterProgress,
  hotUpdaterErrorDetails,
} from "@/lib/hot-updater-logs";
import {
  configurePushNotificationPresentation,
  notificationResponseThreadId,
  supportsPushNotifications,
} from "@/lib/push-notifications";
import {
  persistedQueryMaxAgeMs,
  queryClientPersister,
  shouldPersistQuery,
} from "@/lib/query-persistence";
import { restoreChatStoreFromQueryCache } from "@/lib/server-state-hydration";
import { setActiveThread } from "@/state/chat-store";

void SplashScreen.preventAutoHideAsync();
configurePushNotificationPresentation();

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#191919",
    border: "rgba(255, 255, 255, 0.08)",
    card: "#202222",
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      retry: 1,
      staleTime: 0,
    },
  },
});

const TextWithDefaults = Text as typeof Text & {
  defaultProps?: Partial<React.ComponentProps<typeof Text>>;
};
const TextInputWithDefaults = TextInput as typeof TextInput & {
  defaultProps?: Partial<React.ComponentProps<typeof TextInput>>;
};

TextWithDefaults.defaultProps = {
  ...TextWithDefaults.defaultProps,
  allowFontScaling: false,
  maxFontSizeMultiplier: 1,
};

TextInputWithDefaults.defaultProps = {
  ...TextInputWithDefaults.defaultProps,
  allowFontScaling: false,
  maxFontSizeMultiplier: 1,
};

async function checkForLaunchUpdate() {
  if (hotUpdater === null) {
    addHotUpdaterLog("warning", "OTA launch check skipped", "No update server is configured.");
    return;
  }
  addHotUpdaterLog(
    "info",
    "OTA launch check started",
    [
      `App version: ${hotUpdater.getAppVersion()}`,
      `Channel: ${hotUpdater.getChannel()}`,
      `Default channel: ${hotUpdater.getDefaultChannel()}`,
      `Cohort: ${hotUpdater.getCohort()}`,
      `Bundle: ${hotUpdater.getBundleId()}`,
      `Min bundle: ${hotUpdater.getMinBundleId()}`,
    ].join("\n"),
  );

  const updateInfo = await hotUpdater.checkForUpdate({
    updateStrategy: "appVersion",
    onError: (error) => {
      addHotUpdaterLog(
        "warning",
        "OTA launch check reported error",
        [`Name: ${error.name}`, `Message: ${error.message}`].join("\n"),
      );
    },
  });

  if (!updateInfo) {
    addHotUpdaterLog("info", "OTA launch check found no update");
    return;
  }

  addHotUpdaterLog(
    "info",
    "OTA launch check found update",
    [
      `ID: ${updateInfo.id}`,
      `Status: ${updateInfo.status}`,
      `Force update: ${updateInfo.shouldForceUpdate ? "yes" : "no"}`,
      `Message: ${updateInfo.message}`,
    ].join("\n"),
  );

  const didDownload = await updateInfo.updateBundle();
  addHotUpdaterLog(
    didDownload ? "info" : "warning",
    "OTA launch update bundle finished",
    `Downloaded: ${didDownload ? "yes" : "no"}`,
  );

  // A force update runs right away instead of waiting for the next launch.
  if (didDownload && updateInfo.shouldForceUpdate) {
    addHotUpdaterLog("info", "OTA force update reloading", `ID: ${updateInfo.id}`);
    await hotUpdater.reload();
  }
}

function TabLayout() {
  useInitialPushNotificationRegistration();
  const [fontsLoaded] = useFonts({
    GeistMono: require("../../assets/fonts/GeistMono-Regular.ttf"),
    "GeistMono-Medium": require("../../assets/fonts/GeistMono-Medium.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    const unsubscribeProgress = hotUpdater?.addListener("onProgress", (event) => {
      addHotUpdaterLog("info", "OTA download progress", formatHotUpdaterProgress(event));
    });

    void checkForLaunchUpdate().catch(() => undefined);
    void refreshRemoteConfig();

    return () => unsubscribeProgress?.();
  }, []);

  useEffect(() => {
    if (!supportsPushNotifications()) {
      return;
    }
    const openNotificationThread = (response: Notifications.NotificationResponse) => {
      const threadId = notificationResponseThreadId(response);
      if (!threadId) {
        return;
      }
      setActiveThread(threadId);
      router.replace("/");
      Notifications.clearLastNotificationResponse();
    };

    const mostRecentResponse = Notifications.getLastNotificationResponse();
    if (mostRecentResponse) {
      openNotificationThread(mostRecentResponse);
    }
    const subscription =
      Notifications.addNotificationResponseReceivedListener(openNotificationThread);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      onSuccess={() => restoreChatStoreFromQueryCache(queryClient)}
      persistOptions={{
        buster: "codex-relay-server-state-v2",
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
        maxAge: persistedQueryMaxAgeMs,
        persister: queryClientPersister,
      }}
    >
      <ThemeProvider value={appTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <BottomSheetModalProvider>
              <AnimatedSplashOverlay />
              <Stack
                screenOptions={{
                  contentStyle: {
                    backgroundColor: "#191919",
                  },
                  headerShown: false,
                }}
              >
                <Stack.Screen name="(drawer)" />
                <Stack.Screen name="pair" />
                <Stack.Screen
                  name="image-viewer"
                  options={{
                    contentStyle: {
                      backgroundColor: "#050505",
                    },
                    gestureEnabled: true,
                    presentation: "modal",
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    animation: "slide_from_right",
                    title: "Settings",
                  }}
                />
                <Stack.Screen
                  name="ssh"
                  options={{
                    animation: "slide_from_right",
                    title: "SSH",
                  }}
                />
                <Stack.Screen
                  name="workspace-file-editor"
                  options={{
                    animation: "slide_from_right",
                    title: "File Editor",
                  }}
                />
              </Stack>
              <PortalHost />
            </BottomSheetModalProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}

/** Applies the Remote Config values the server picks, at most every 12 hours. */
async function refreshRemoteConfig() {
  // Absent when the plugin could not set up, such as on a binary without its storage.
  const remoteConfig = hotUpdater?.remoteConfig;
  if (!remoteConfig) {
    return;
  }
  try {
    const activated = await remoteConfig.fetchAndActivate();
    addHotUpdaterLog(
      "info",
      "Remote Config fetched",
      [
        `Activated: ${activated ? "new values" : "no change"}`,
        `Version: ${remoteConfig.activeVersion}`,
      ].join("\n"),
    );
  } catch (error) {
    addHotUpdaterLog("warning", "Remote Config fetch failed", hotUpdaterErrorDetails(error));
  }
}

export default TabLayout;
