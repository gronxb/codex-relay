import { useSelector } from "@legendapp/state/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Linking } from "react-native";

import {
  getCodexRelayServerUrlCandidates,
  getPushNotificationSettings,
  registerPushNotifications,
  refreshSession,
  setCodexRelayServerUrl,
  signOutCodexRelaySession,
  unregisterPushNotifications,
  type CodexRelayServerUrlCandidate,
} from "@/lib/codex-relay-api";
import { hapticSelection, hapticWarning } from "@/lib/haptics";
import { hotUpdater } from "@/lib/hot-updater";
import {
  addHotUpdaterLog,
  hotUpdaterErrorDetails,
  useHotUpdaterLogs,
} from "@/lib/hot-updater-logs";
import { formatMobileReleaseVersion } from "@/lib/mobile-release-version";
import {
  defaultPushNotificationPreferences,
  getExpoPushToken,
  markInitialPushNotificationRegistrationCompleted,
  pushNotificationPlatform,
  supportsPushNotifications,
} from "@/lib/push-notifications";
import { visibleRateLimitRows } from "@/lib/rate-limits";
import {
  clearServerState,
  fetchRateLimitsState,
  fetchStatusState,
  serverStateKeys,
  serverStateQueryFns,
  setStatusState,
} from "@/lib/server-state";
import { chatStore$, resetChatSessionState, setConnection, setServerUrl } from "@/state/chat-store";

import mobilePackage from "../../../package.json";

export type PushNotificationPreference = keyof typeof defaultPushNotificationPreferences;
export type SettingsConnection = "checking" | "connected" | "offline";

type AppUpdateInfo = Awaited<ReturnType<NonNullable<typeof hotUpdater>["checkForUpdate"]>>;
export type AppUpdateState = {
  status: "checking" | "current" | "downloading" | "ready" | "updating" | "error";
  updateInfo: AppUpdateInfo;
};

const HOT_UPDATER_LOG_REVEAL_TAPS = 5;

// Settings state and actions shared by the SwiftUI and React Native screens.
export function useSettingsScreen() {
  const queryClient = useQueryClient();
  const connection = useSelector(() => chatStore$.connection.get());
  const hasPairedSession = useSelector(() => chatStore$.hasPairedSession.get());
  const serverUrl = useSelector(() => chatStore$.serverUrl.get());
  const statusQuery = useQuery({
    queryKey: serverStateKeys.status(),
    queryFn: serverStateQueryFns.status,
    enabled: false,
  });
  const rateLimitsQuery = useQuery({
    queryKey: serverStateKeys.rateLimits(),
    queryFn: serverStateQueryFns.rateLimits,
    enabled: connection === "connected",
  });
  const machineName = statusQuery.data?.machineName;
  const computerName = hasPairedSession
    ? (machineName ?? connectedComputerName(serverUrl))
    : "No paired computer";
  const [appVersion] = useState(
    () => hotUpdater?.getAppVersion() ?? Constants.expoConfig?.version ?? "1.0.0",
  );
  const releaseVersionLabel = formatMobileReleaseVersion(appVersion, mobilePackage.version);
  const [appliedBundleSuffix] = useState(appliedHotUpdateBundleSuffix);
  const hotUpdaterTapCountRef = useRef(0);
  const [showHotUpdaterLogs, setShowHotUpdaterLogs] = useState(false);
  const hotUpdaterLogs = useHotUpdaterLogs();
  const [serverUrlCandidates, setServerUrlCandidates] = useState(() =>
    getCodexRelayServerUrlCandidates(),
  );
  const [switchingServerUrl, setSwitchingServerUrl] = useState<string | undefined>();
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>({
    status: "checking",
    updateInfo: null,
  });
  const [pushNotificationPreferences, setPushNotificationPreferences] = useState(
    defaultPushNotificationPreferences,
  );
  const [pushNotificationsLoading, setPushNotificationsLoading] = useState(false);
  const [pushNotificationsUpdating, setPushNotificationsUpdating] = useState(false);
  const pushNotificationsSupported = supportsPushNotifications();
  const rateLimitRows = visibleRateLimitRows(rateLimitsQuery.data?.buckets ?? []);
  const isAppUpdatePending =
    appUpdate.status === "downloading" ||
    appUpdate.status === "ready" ||
    appUpdate.status === "updating";
  const isAppUpdateActionDisabled =
    appUpdate.status === "downloading" || appUpdate.status === "updating";
  const appUpdateActionLabel =
    appUpdate.status === "downloading"
      ? "Downloading"
      : appUpdate.status === "updating"
        ? "Restarting"
        : "Restart";

  useEffect(() => {
    let isActive = true;

    async function checkForAppUpdate() {
      try {
        if (hotUpdater === null) {
          setAppUpdate({ status: "current", updateInfo: null });
          return;
        }
        const updateInfo = await hotUpdater.checkForUpdate({
          updateStrategy: "appVersion",
        });

        if (!isActive) {
          return;
        }

        if (!updateInfo) {
          setAppUpdate({
            status: "current",
            updateInfo: null,
          });
          return;
        }

        setAppUpdate({
          status: "downloading",
          updateInfo,
        });

        const didDownload = await updateInfo.updateBundle();

        // A force update runs right away instead of waiting for Restart.
        if (didDownload && updateInfo.shouldForceUpdate) {
          if (isActive) {
            setAppUpdate({ status: "updating", updateInfo });
          }
          await hotUpdater.reload();
          return;
        }

        if (!isActive) {
          return;
        }

        setAppUpdate({
          status: didDownload ? "ready" : "error",
          updateInfo: didDownload ? updateInfo : null,
        });
      } catch {
        if (isActive) {
          setAppUpdate({ status: "error", updateInfo: null });
        }
      }
    }

    void checkForAppUpdate();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    setServerUrlCandidates(getCodexRelayServerUrlCandidates());
  }, [serverUrl]);

  useEffect(() => {
    let isActive = true;
    if (!hasPairedSession || !pushNotificationsSupported) {
      setPushNotificationPreferences(defaultPushNotificationPreferences);
      setPushNotificationsLoading(false);
      return () => {
        isActive = false;
      };
    }

    setPushNotificationsLoading(true);
    void getPushNotificationSettings()
      .then((settings) => {
        if (isActive) {
          setPushNotificationPreferences(settings.preferences);
        }
      })
      .catch(() => {
        if (isActive) {
          setPushNotificationPreferences(defaultPushNotificationPreferences);
        }
      })
      .finally(() => {
        if (isActive) {
          setPushNotificationsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [hasPairedSession, pushNotificationsSupported, serverUrl]);

  function closeSettings() {
    hapticSelection();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }

  function signOut() {
    hapticWarning();
    signOutCodexRelaySession();
    clearServerState(queryClient);
    resetChatSessionState();
    router.replace("/");
  }

  async function updatePushNotificationPreference(
    preference: PushNotificationPreference,
    value: boolean,
  ) {
    if (pushNotificationsUpdating || !pushNotificationsSupported) {
      return;
    }

    const previousPreferences = pushNotificationPreferences;
    const nextPreferences = { ...previousPreferences, [preference]: value };
    hapticSelection();
    markInitialPushNotificationRegistrationCompleted();
    setPushNotificationPreferences(nextPreferences);
    setPushNotificationsUpdating(true);

    try {
      const settings = Object.values(nextPreferences).some(Boolean)
        ? await registerPushNotifications({
            expoPushToken: await getExpoPushToken(),
            platform: pushNotificationPlatform(),
            preferences: nextPreferences,
          })
        : await unregisterPushNotifications();
      setPushNotificationPreferences(settings.preferences);
    } catch (caught) {
      setPushNotificationPreferences(previousPreferences);
      hapticWarning();
      Alert.alert("Notifications unavailable", settingsErrorMessage(caught));
    } finally {
      setPushNotificationsUpdating(false);
    }
  }

  async function selectServerAddress(candidate: CodexRelayServerUrlCandidate) {
    if (candidate.url === serverUrl || switchingServerUrl) {
      return;
    }

    hapticSelection();
    setSwitchingServerUrl(candidate.url);
    const normalizedServerUrl = setCodexRelayServerUrl(candidate.url);
    setServerUrl(normalizedServerUrl);
    setServerUrlCandidates(getCodexRelayServerUrlCandidates());
    clearServerState(queryClient);
    setConnection("checking");

    try {
      await refreshSession().catch(() => false);
      const [status] = await Promise.all([
        fetchStatusState(queryClient),
        fetchRateLimitsState(queryClient).catch(() => undefined),
      ]);
      setStatusState(queryClient, status);
      setConnection("connected");
    } catch (caught) {
      const message = settingsErrorMessage(caught);
      setConnection("offline", message);
      Alert.alert("Server unavailable", message);
    } finally {
      setSwitchingServerUrl(undefined);
    }
  }

  async function applyAppUpdate() {
    if (!appUpdate.updateInfo || appUpdate.status !== "ready") {
      return;
    }

    hapticSelection();
    setAppUpdate((current) => ({ ...current, status: "updating" }));

    try {
      await hotUpdater?.reload();
    } catch {
      setAppUpdate((current) => ({ ...current, status: "error" }));
      hapticWarning();
    }
  }

  // Five taps on the version line reveal the OTA logs.
  function revealHotUpdaterLogs() {
    if (showHotUpdaterLogs) {
      hotUpdaterTapCountRef.current = 0;
      return;
    }

    hotUpdaterTapCountRef.current += 1;

    if (hotUpdaterTapCountRef.current < HOT_UPDATER_LOG_REVEAL_TAPS) {
      return;
    }

    hotUpdaterTapCountRef.current = 0;
    setShowHotUpdaterLogs(true);
  }

  function openProjectLink(url: string) {
    hapticSelection();
    void Linking.openURL(url);
  }

  return {
    appUpdate,
    appUpdateActionLabel,
    appliedBundleSuffix,
    applyAppUpdate,
    closeSettings,
    computerName,
    connection,
    hasPairedSession,
    hotUpdaterLogs,
    isAppUpdateActionDisabled,
    isAppUpdatePending,
    openProjectLink,
    pushNotificationPreferences,
    pushNotificationsLoading,
    pushNotificationsSupported,
    pushNotificationsUpdating,
    rateLimitRows,
    rateLimitsFetching: rateLimitsQuery.isFetching,
    releaseVersionLabel,
    revealHotUpdaterLogs,
    selectServerAddress,
    serverUrl,
    serverUrlCandidates,
    setShowHotUpdaterLogs,
    showHotUpdaterLogs,
    signOut,
    switchingServerUrl,
    updatePushNotificationPreference,
  };
}

export type HotUpdaterRemoteConfig = NonNullable<typeof hotUpdater>["remoteConfig"];

/** The Remote Config the app has active, and a forced fetch to apply new values now. */
export function useRemoteConfigPanel(remoteConfig: HotUpdaterRemoteConfig) {
  const values = useSyncExternalStore(remoteConfig.subscribe, remoteConfig.getAll);
  const [fetching, setFetching] = useState(false);

  async function fetchNow() {
    setFetching(true);
    try {
      const activated = await remoteConfig.fetchAndActivate({ force: true });
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
      hapticWarning();
    } finally {
      setFetching(false);
    }
  }

  return {
    fetchNow,
    fetching,
    fetchedAtMs: remoteConfig.fetchedAtMs,
    notice: remoteConfig.getString("settings_notice"),
    values,
  };
}

export function compactServer(serverUrl: string) {
  return serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "Not paired";
}

export function connectionLabel(connection: SettingsConnection) {
  switch (connection) {
    case "connected":
      return "ONLINE";
    case "checking":
      return "CHECKING";
    case "offline":
      return "OFFLINE";
  }
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function rateLimitProgressColor(remainingPercent: number) {
  if (remainingPercent <= 10) {
    return "#FF9B8D";
  }
  if (remainingPercent <= 30) {
    return "#F2B84B";
  }
  return "#93E1B6";
}

export function appUpdateStatusSuffix(status: AppUpdateState["status"]) {
  switch (status) {
    case "checking":
      return "checking";
    case "current":
      return "current";
    case "downloading":
      return "downloading";
    case "ready":
      return "restart ready";
    case "error":
      return "check failed";
    case "updating":
      return undefined;
  }
}

function connectedComputerName(serverUrl: string) {
  if (!serverUrl) {
    return "No computer paired";
  }
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return compactServer(serverUrl);
  }
}

function settingsErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not reach the selected server address.";
}

function appliedHotUpdateBundleSuffix() {
  try {
    const bundleId = hotUpdater?.getBundleId();
    if (!bundleId || bundleId === hotUpdater?.getMinBundleId()) {
      return undefined;
    }
    return bundleId.slice(-8);
  } catch {
    return undefined;
  }
}
