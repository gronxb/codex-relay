import { HotUpdater } from "@hot-updater/react-native";
import { useSelector } from "@legendapp/state/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Heart } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Switch, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { FaGithub } from "@/assets/icons/fa";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import {
  codexRelayRepositoryLabel,
  codexRelayRepositoryUrl,
  codexRelaySponsorLabel,
  codexRelaySponsorUrl,
} from "@/constants/links";
import { Colors, Fonts, MaxContentWidth, Spacing } from "@/constants/theme";
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
import {
  clearHotUpdaterLogs,
  formatHotUpdaterLogTime,
  useHotUpdaterLogs,
} from "@/lib/hot-updater-logs";
import {
  getExpoPushToken,
  pushNotificationPlatform,
  supportsPushNotifications,
} from "@/lib/push-notifications";
import { formatRateLimitRemaining, visibleRateLimitRows } from "@/lib/rate-limits";
import {
  clearServerState,
  fetchRateLimitsState,
  fetchStatusState,
  serverStateKeys,
  serverStateQueryFns,
  setStatusState,
} from "@/lib/server-state";
import { chatStore$, resetChatSessionState, setConnection, setServerUrl } from "@/state/chat-store";

const hotUpdaterBaseUrl = process.env.EXPO_PUBLIC_HOT_UPDATER_BASE_URL?.trim();
const hotUpdaterBaseUrlStatus = hotUpdaterBaseUrl ? "configured" : "missing";
const defaultPushNotificationPreferences = {
  actionRequired: false,
  turnTerminal: false,
};
const pushNotificationTrackColor = {
  false: "rgba(255, 255, 255, 0.16)",
  true: "#2CA36F",
};

type PushNotificationPreference = keyof typeof defaultPushNotificationPreferences;

export default function SettingsScreen() {
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
  const [appVersion] = useState(() => HotUpdater.getAppVersion() ?? "1.0.0");
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
        const updateInfo = await HotUpdater.checkForUpdate({
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
    setPushNotificationPreferences(nextPreferences);
    setPushNotificationsUpdating(true);

    try {
      const settings =
        nextPreferences.actionRequired || nextPreferences.turnTerminal
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
      await HotUpdater.reload();
    } catch {
      setAppUpdate((current) => ({ ...current, status: "error" }));
      hapticWarning();
    }
  }

  function revealHotUpdaterLogs() {
    if (showHotUpdaterLogs) {
      hotUpdaterTapCountRef.current = 0;
      return;
    }

    hotUpdaterTapCountRef.current += 1;

    if (hotUpdaterTapCountRef.current < 5) {
      return;
    }

    hotUpdaterTapCountRef.current = 0;
    setShowHotUpdaterLogs(true);
  }

  function openProjectLink(url: string) {
    hapticSelection();
    void Linking.openURL(url);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to threads"
            onPress={closeSettings}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <Icon name="back" size={19} tintColor={Colors.dark.text} />
          </Pressable>
          <View style={styles.titleGroup}>
            <ThemedText type="smallBold" style={styles.title}>
              Settings
            </ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={styles.subtitle}>
              Account
            </ThemedText>
          </View>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <Animated.View layout={settingsLayoutTransition} style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              Project
            </ThemedText>
            <Animated.View layout={settingsLayoutTransition} style={styles.projectLinkList}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open Codex Relay GitHub repository"
                onPress={() => openProjectLink(codexRelayRepositoryUrl)}
                style={({ pressed }) => [styles.projectLinkRow, pressed && styles.pressed]}
              >
                <View style={styles.projectLinkIcon}>
                  <FaGithub size={17} color={Colors.dark.text} />
                </View>
                <View style={styles.projectLinkCopy}>
                  <ThemedText type="smallBold" style={styles.projectLinkTitle}>
                    GitHub
                  </ThemedText>
                  <ThemedText
                    type="code"
                    themeColor="textSecondary"
                    style={styles.projectLinkSubtitle}
                    numberOfLines={1}
                  >
                    {codexRelayRepositoryLabel}
                  </ThemedText>
                </View>
                <Icon name="externalLink" size={15} tintColor={Colors.dark.textSecondary} />
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open gronxb GitHub Sponsors"
                onPress={() => openProjectLink(codexRelaySponsorUrl)}
                style={({ pressed }) => [styles.projectLinkRow, pressed && styles.pressed]}
              >
                <View style={[styles.projectLinkIcon, styles.projectLinkIconSponsor]}>
                  <Heart size={16} color="#FF9FC0" fill="#FF9FC0" />
                </View>
                <View style={styles.projectLinkCopy}>
                  <ThemedText type="smallBold" style={styles.projectLinkTitle}>
                    Sponsor
                  </ThemedText>
                  <ThemedText
                    type="code"
                    themeColor="textSecondary"
                    style={styles.projectLinkSubtitle}
                    numberOfLines={1}
                  >
                    {codexRelaySponsorLabel}
                  </ThemedText>
                </View>
                <Icon name="externalLink" size={15} tintColor={Colors.dark.textSecondary} />
              </Pressable>
            </Animated.View>
          </Animated.View>

          <Animated.View layout={settingsLayoutTransition} style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              Usage Limits
            </ThemedText>
            <Animated.View layout={settingsLayoutTransition} style={styles.usageCard}>
              {rateLimitRows.length > 0 ? (
                rateLimitRows.map((row, index) => (
                  <RateLimitProgressRow
                    key={row.id}
                    label={row.label}
                    remainingText={formatRateLimitRemaining(row.window)}
                    remainingPercent={row.window.remainingPercent}
                    usedPercent={row.window.usedPercent}
                    showDivider={index < rateLimitRows.length - 1}
                  />
                ))
              ) : (
                <Animated.View
                  key="usage-empty"
                  entering={settingsEnterTransition}
                  exiting={settingsExitTransition}
                  layout={settingsLayoutTransition}
                  style={styles.usageRow}
                >
                  <View style={styles.usageCopy}>
                    <ThemedText type="smallBold" style={styles.usageTitle}>
                      Rate limits
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.usageSubtitle}
                    >
                      {rateLimitsQuery.isFetching
                        ? "Checking current usage"
                        : "Unavailable from this runtime"}
                    </ThemedText>
                  </View>
                </Animated.View>
              )}
            </Animated.View>
          </Animated.View>

          <Animated.View layout={settingsLayoutTransition} style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              Connected Computer
            </ThemedText>
            <Animated.View layout={settingsLayoutTransition} style={styles.connectionPanel}>
              <Animated.View layout={settingsFastLayoutTransition} style={styles.connectionHeader}>
                <View
                  style={[
                    styles.connectionDot,
                    connection === "connected" && styles.connectionDotConnected,
                    connection === "offline" && styles.connectionDotOffline,
                  ]}
                />
                <ThemedText type="smallBold" style={styles.connectionTitle} numberOfLines={1}>
                  {computerName}
                </ThemedText>
                <View style={styles.connectionBadge}>
                  <ThemedText type="code" style={styles.connectionBadgeText}>
                    {connectionLabel(connection)}
                  </ThemedText>
                </View>
              </Animated.View>
              {hasPairedSession ? (
                <>
                  <InfoLine label="Server" value={compactServer(serverUrl)} />
                  <View style={styles.serverAddressList}>
                    {serverUrlCandidates.map((candidate) => {
                      const isSelected = candidate.url === serverUrl;
                      const isSwitching = switchingServerUrl === candidate.url;
                      return (
                        <Pressable
                          key={candidate.url}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${compactServer(candidate.url)}`}
                          disabled={isSelected || Boolean(switchingServerUrl)}
                          onPress={() => void selectServerAddress(candidate)}
                          style={({ pressed }) => [
                            styles.serverAddressRow,
                            isSelected && styles.serverAddressRowSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.serverAddressCopy}>
                            <ThemedText type="smallBold" style={styles.serverAddressLabel}>
                              {candidate.label}
                            </ThemedText>
                            <ThemedText
                              type="code"
                              themeColor="textSecondary"
                              style={styles.serverAddressValue}
                              numberOfLines={1}
                            >
                              {compactServer(candidate.url)}
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.serverAddressStatus,
                              isSelected && styles.serverAddressStatusSelected,
                            ]}
                          >
                            <ThemedText
                              type="code"
                              style={[
                                styles.serverAddressStatusText,
                                isSelected && styles.serverAddressStatusTextSelected,
                              ]}
                            >
                              {isSwitching ? "CHECKING" : isSelected ? "ACTIVE" : "USE"}
                            </ThemedText>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.unpairedCopy}>
                  Pair this device from the main screen to choose a relay server.
                </ThemedText>
              )}
            </Animated.View>
          </Animated.View>

          {hasPairedSession ? (
            <Animated.View layout={settingsLayoutTransition} style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                Notifications
              </ThemedText>
              <Animated.View layout={settingsLayoutTransition} style={styles.notificationPanel}>
                {pushNotificationsSupported ? (
                  <>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.notificationIntro}
                    >
                      Generic alerts only. Chat content stays on your paired computer.
                    </ThemedText>
                    <PushNotificationToggle
                      accessibilityLabel="Notify when a Codex turn ends"
                      disabled={pushNotificationsLoading || pushNotificationsUpdating}
                      onValueChange={(value) =>
                        void updatePushNotificationPreference("turnTerminal", value)
                      }
                      subtitle="When Codex completes or fails a turn"
                      title="Turn complete"
                      value={pushNotificationPreferences.turnTerminal}
                    />
                    <PushNotificationToggle
                      accessibilityLabel="Notify when Codex needs action"
                      disabled={pushNotificationsLoading || pushNotificationsUpdating}
                      onValueChange={(value) =>
                        void updatePushNotificationPreference("actionRequired", value)
                      }
                      showDivider={false}
                      subtitle="When Codex needs approval or input"
                      title="Action required"
                      value={pushNotificationPreferences.actionRequired}
                    />
                  </>
                ) : (
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.notificationIntro}
                  >
                    Push notifications are available in the iOS and Android apps.
                  </ThemedText>
                )}
              </Animated.View>
            </Animated.View>
          ) : null}

          {hasPairedSession ? (
            <Animated.View layout={settingsLayoutTransition} style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                Session
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                onPress={signOut}
                style={({ pressed }) => [styles.signOutRow, pressed && styles.pressed]}
              >
                <View style={styles.signOutContent}>
                  <View style={styles.signOutIconSlot}>
                    <Icon name="signOut" size={17} tintColor="#FFB4A8" />
                  </View>
                  <View style={styles.signOutCopy}>
                    <ThemedText type="smallBold" style={styles.signOutTitle}>
                      Sign out
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.signOutSubtitle}
                    >
                      Pair again on this device
                    </ThemedText>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          ) : null}

          <Animated.View layout={settingsLayoutTransition} style={styles.versionFooter}>
            <Animated.View layout={settingsLayoutTransition} style={styles.versionRow}>
              <Pressable
                accessible={false}
                hitSlop={12}
                onPress={revealHotUpdaterLogs}
                style={styles.versionTapTarget}
              >
                <View style={styles.versionIcon}>
                  <Icon
                    name={isAppUpdatePending ? "refresh" : "permissionsAuto"}
                    size={12}
                    tintColor={isAppUpdatePending ? "#93E1B6" : Colors.dark.textSecondary}
                  />
                </View>
                <ThemedText type="code" themeColor="textSecondary" style={styles.versionText}>
                  Version {appVersion}
                  {appUpdate.status === "checking" ? " · checking" : null}
                  {appUpdate.status === "current" ? " · current" : null}
                  {appUpdate.status === "downloading" ? " · downloading" : null}
                  {appUpdate.status === "ready" ? " · restart ready" : null}
                  {appUpdate.status === "error" ? " · check failed" : null}
                  {appliedBundleSuffix ? ` · bundle ${appliedBundleSuffix}` : null}
                </ThemedText>
              </Pressable>
              {isAppUpdatePending ? (
                <Animated.View
                  key="app-update-action"
                  entering={settingsEnterTransition}
                  exiting={settingsExitTransition}
                  layout={settingsLayoutTransition}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      appUpdate.status === "ready" ? "Restart app" : "Preparing app update"
                    }
                    disabled={isAppUpdateActionDisabled}
                    onPress={() => void applyAppUpdate()}
                    style={({ pressed }) => [
                      styles.versionButton,
                      isAppUpdateActionDisabled && styles.versionButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText type="code" style={styles.versionButtonText}>
                      {appUpdateActionLabel}
                    </ThemedText>
                  </Pressable>
                </Animated.View>
              ) : null}
            </Animated.View>
            {isAppUpdatePending && appUpdate.updateInfo?.message ? (
              <Animated.View
                key="app-update-message"
                entering={settingsEnterTransition}
                exiting={settingsExitTransition}
                layout={settingsLayoutTransition}
              >
                <ThemedText type="small" themeColor="textSecondary" style={styles.versionMessage}>
                  {appUpdate.updateInfo.message}
                </ThemedText>
              </Animated.View>
            ) : null}
            {showHotUpdaterLogs ? (
              <Animated.View
                key="hot-updater-logs"
                entering={settingsEnterTransition}
                exiting={settingsExitTransition}
                layout={settingsLayoutTransition}
                style={styles.hotUpdaterLogPanel}
              >
                <View style={styles.hotUpdaterLogHeader}>
                  <ThemedText type="smallBold" style={styles.hotUpdaterLogTitle}>
                    Logs ({HotUpdater.getCohort()})
                  </ThemedText>
                  <View style={styles.hotUpdaterLogActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear HotUpdater logs"
                      onPress={clearHotUpdaterLogs}
                      style={({ pressed }) => [
                        styles.hotUpdaterLogButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <ThemedText type="code" style={styles.hotUpdaterLogButtonText}>
                        Clear
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Hide HotUpdater logs"
                      onPress={() => setShowHotUpdaterLogs(false)}
                      style={({ pressed }) => [
                        styles.hotUpdaterLogButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <ThemedText type="code" style={styles.hotUpdaterLogButtonText}>
                        Hide
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.hotUpdaterConfigRow}>
                  <ThemedText type="code" style={styles.hotUpdaterConfigLabel}>
                    Base URL
                  </ThemedText>
                  <ThemedText
                    type="code"
                    style={[
                      styles.hotUpdaterConfigValue,
                      !hotUpdaterBaseUrl && styles.hotUpdaterConfigValueMissing,
                    ]}
                  >
                    {hotUpdaterBaseUrlStatus}
                  </ThemedText>
                </View>
                {hotUpdaterLogs.length > 0 ? (
                  hotUpdaterLogs.map((entry) => (
                    <View key={entry.id} style={styles.hotUpdaterLogRow}>
                      <ThemedText type="code" style={styles.hotUpdaterLogMeta}>
                        {formatHotUpdaterLogTime(entry.timestamp)} · {entry.level.toUpperCase()}
                      </ThemedText>
                      <ThemedText type="small" style={styles.hotUpdaterLogMessage}>
                        {entry.message}
                      </ThemedText>
                      {entry.details ? (
                        <ThemedText
                          type="code"
                          themeColor="textSecondary"
                          style={styles.hotUpdaterLogDetails}
                        >
                          {entry.details}
                        </ThemedText>
                      ) : null}
                    </View>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.versionMessage}>
                    No OTA download events captured in this session.
                  </ThemedText>
                )}
              </Animated.View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function PushNotificationToggle({
  accessibilityLabel,
  disabled,
  onValueChange,
  showDivider = true,
  subtitle,
  title,
  value,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
  showDivider?: boolean;
  subtitle: string;
  title: string;
  value: boolean;
}) {
  return (
    <Animated.View
      entering={settingsEnterTransition}
      exiting={settingsExitTransition}
      layout={settingsLayoutTransition}
      style={[styles.notificationRow, showDivider && styles.notificationRowDivider]}
    >
      <View style={styles.notificationCopy}>
        <ThemedText type="smallBold" style={styles.notificationTitle}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.notificationSubtitle}>
          {subtitle}
        </ThemedText>
      </View>
      <Switch
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={value ? "#DDF7E7" : "#BEC5C3"}
        trackColor={pushNotificationTrackColor}
        value={value}
      />
    </Animated.View>
  );
}

function RateLimitProgressRow({
  label,
  remainingPercent,
  remainingText,
  showDivider,
  usedPercent,
}: {
  label: string;
  remainingPercent: number;
  remainingText: string;
  showDivider: boolean;
  usedPercent: number;
}) {
  const clampedUsedPercent = clampPercent(usedPercent);
  const clampedRemainingPercent = clampPercent(remainingPercent);
  const progressColor = rateLimitProgressColor(clampedRemainingPercent);

  return (
    <Animated.View
      entering={settingsEnterTransition}
      exiting={settingsExitTransition}
      layout={settingsLayoutTransition}
      style={[styles.usageRow, showDivider && styles.usageRowDivider]}
    >
      <View style={styles.usageHeader}>
        <View style={styles.usageCopy}>
          <ThemedText type="smallBold" style={styles.usageTitle} numberOfLines={1}>
            {label}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.usageSubtitle}
            numberOfLines={1}
          >
            {remainingText} left
          </ThemedText>
        </View>
        <View style={[styles.usagePercentBadge, { borderColor: progressColor }]}>
          <ThemedText type="code" style={[styles.usagePercentText, { color: progressColor }]}>
            {clampedRemainingPercent}%
          </ThemedText>
        </View>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{
          max: 100,
          min: 0,
          now: clampedUsedPercent,
          text: `${clampedUsedPercent}% used`,
        }}
        style={styles.usageProgressTrack}
      >
        <View
          style={[
            styles.usageProgressFill,
            { backgroundColor: progressColor, width: `${clampedUsedPercent}%` },
          ]}
        />
      </View>
      <View style={styles.usageMetaRow}>
        <ThemedText type="code" themeColor="textSecondary" style={styles.usageMetaText}>
          Used {clampedUsedPercent}%
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary" style={styles.usageMetaText}>
          Remaining {clampedRemainingPercent}%
        </ThemedText>
      </View>
    </Animated.View>
  );
}

function InfoLine({
  label,
  numberOfLines = 1,
  value,
}: {
  label: string;
  numberOfLines?: number;
  value: string;
}) {
  return (
    <Animated.View
      entering={settingsEnterTransition}
      exiting={settingsExitTransition}
      layout={settingsLayoutTransition}
      style={styles.infoLine}
    >
      <ThemedText type="small" themeColor="textSecondary" style={styles.infoLineLabel}>
        {label}
      </ThemedText>
      <ThemedText type="code" style={styles.infoLineValue} numberOfLines={numberOfLines}>
        {value}
      </ThemedText>
    </Animated.View>
  );
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

function compactServer(serverUrl: string) {
  return serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "Not paired";
}

function connectionLabel(connection: "checking" | "connected" | "offline") {
  switch (connection) {
    case "connected":
      return "ONLINE";
    case "checking":
      return "CHECKING";
    case "offline":
      return "OFFLINE";
  }
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rateLimitProgressColor(remainingPercent: number) {
  if (remainingPercent <= 10) {
    return "#FF9B8D";
  }
  if (remainingPercent <= 30) {
    return "#F2B84B";
  }
  return "#93E1B6";
}

function settingsErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not reach the selected server address.";
}

function appliedHotUpdateBundleSuffix() {
  try {
    const bundleId = HotUpdater.getBundleId();
    if (!bundleId || bundleId === HotUpdater.getMinBundleId()) {
      return undefined;
    }
    return bundleId.slice(-8);
  } catch {
    return undefined;
  }
}

type AppUpdateInfo = Awaited<ReturnType<typeof HotUpdater.checkForUpdate>>;

type AppUpdateState = {
  status: "checking" | "current" | "downloading" | "ready" | "updating" | "error";
  updateInfo: AppUpdateInfo;
};

const settingsLayoutTransition = LinearTransition.duration(180);
const settingsFastLayoutTransition = LinearTransition.duration(120);
const settingsEnterTransition = FadeIn.duration(120);
const settingsExitTransition = FadeOut.duration(90);

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: Colors.dark.background,
    flex: 1,
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 8,
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  headerButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  headerButtonPlaceholder: {
    height: 40,
    width: 40,
  },
  titleGroup: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.84,
    textAlign: "center",
  },
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.five,
    paddingHorizontal: 18,
    paddingTop: Spacing.three,
  },
  scroll: {
    flex: 1,
  },
  section: {
    gap: Spacing.two,
  },
  sectionLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.68,
  },
  projectLinkList: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 7,
    padding: Spacing.two,
  },
  projectLinkRow: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectLinkIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 15,
    borderWidth: 1,
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  projectLinkIconSponsor: {
    backgroundColor: "rgba(255, 159, 192, 0.12)",
    borderColor: "rgba(255, 159, 192, 0.22)",
  },
  projectLinkCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  projectLinkTitle: {
    fontSize: 13,
    lineHeight: 17,
  },
  projectLinkSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  versionFooter: {
    gap: 3,
    paddingTop: Spacing.two,
  },
  versionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minHeight: 26,
  },
  versionIcon: {
    alignItems: "center",
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  versionTapTarget: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 26,
    minWidth: 0,
  },
  versionText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    minWidth: 0,
  },
  versionButton: {
    alignItems: "center",
    backgroundColor: "rgba(44, 163, 111, 0.13)",
    borderColor: "rgba(44, 163, 111, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 26,
    paddingHorizontal: 9,
  },
  versionButtonDisabled: {
    opacity: 0.62,
  },
  versionButtonText: {
    color: "#93E1B6",
    fontFamily: Fonts.monoMedium,
    fontSize: 10,
    lineHeight: 13,
  },
  versionMessage: {
    fontSize: 11,
    lineHeight: 15,
  },
  hotUpdaterLogPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
  },
  hotUpdaterLogHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  hotUpdaterLogTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  hotUpdaterLogActions: {
    flexDirection: "row",
    gap: Spacing.one,
  },
  hotUpdaterLogButton: {
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  hotUpdaterLogButtonText: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    lineHeight: 12,
  },
  hotUpdaterConfigRow: {
    backgroundColor: "rgba(140, 199, 255, 0.07)",
    borderColor: "rgba(140, 199, 255, 0.14)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  hotUpdaterConfigLabel: {
    color: "#8CC7FF",
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    lineHeight: 12,
  },
  hotUpdaterConfigValue: {
    color: Colors.dark.text,
    fontFamily: Fonts.monoMedium,
    fontSize: 10,
    lineHeight: 14,
  },
  hotUpdaterConfigValueMissing: {
    color: "#FFB4A8",
  },
  hotUpdaterLogRow: {
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: 1,
    gap: 2,
    paddingTop: Spacing.two,
  },
  hotUpdaterLogMeta: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    lineHeight: 12,
  },
  hotUpdaterLogMessage: {
    color: Colors.dark.text,
    fontSize: 12,
    lineHeight: 16,
  },
  hotUpdaterLogDetails: {
    fontSize: 10,
    lineHeight: 14,
  },
  connectionPanel: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  notificationPanel: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  notificationIntro: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  notificationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 70,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  notificationRowDivider: {
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderBottomWidth: 1,
  },
  notificationCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  notificationTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  notificationSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  usageCard: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  usageRow: {
    gap: Spacing.two,
    minHeight: 84,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  usageRowDivider: {
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderBottomWidth: 1,
  },
  usageHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  usageCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  usageTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  usageSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  usagePercentBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  usagePercentText: {
    fontFamily: Fonts.monoMedium,
    fontSize: 12,
    lineHeight: 15,
  },
  usageProgressTrack: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 999,
    height: 8,
    overflow: "hidden",
    width: "100%",
  },
  usageProgressFill: {
    borderRadius: 999,
    height: "100%",
  },
  usageMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 14,
  },
  usageMetaText: {
    fontFamily: Fonts.monoMedium,
    fontSize: 10,
    lineHeight: 13,
  },
  connectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 24,
  },
  connectionDot: {
    backgroundColor: "#f2b84b",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  connectionDotConnected: {
    backgroundColor: "#2ca36f",
  },
  connectionDotOffline: {
    backgroundColor: "#d84f4f",
  },
  connectionTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    minWidth: 0,
  },
  unpairedCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
  connectionBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  connectionBadgeText: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    lineHeight: 12,
  },
  infoLine: {
    gap: 2,
    minHeight: 20,
  },
  infoLineLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  infoLineValue: {
    color: Colors.dark.text,
    fontSize: 12,
    lineHeight: 16,
  },
  serverAddressList: {
    gap: 7,
    paddingTop: 2,
  },
  serverAddressRow: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  serverAddressRowSelected: {
    backgroundColor: "rgba(44, 163, 111, 0.12)",
    borderColor: "rgba(147, 225, 182, 0.24)",
  },
  serverAddressCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  serverAddressLabel: {
    fontSize: 13,
    lineHeight: 17,
  },
  serverAddressValue: {
    fontSize: 11,
    lineHeight: 15,
  },
  serverAddressStatus: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    minWidth: 62,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  serverAddressStatusSelected: {
    backgroundColor: "rgba(44, 163, 111, 0.16)",
    borderColor: "rgba(147, 225, 182, 0.28)",
  },
  serverAddressStatusText: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    lineHeight: 12,
  },
  serverAddressStatusTextSelected: {
    color: "#93E1B6",
  },
  signOutRow: {
    backgroundColor: "rgba(216, 79, 79, 0.08)",
    borderColor: "rgba(255, 180, 168, 0.14)",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: Spacing.three,
  },
  signOutContent: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 62,
    width: "100%",
  },
  signOutIconSlot: {
    alignItems: "center",
    backgroundColor: "rgba(216, 79, 79, 0.16)",
    borderRadius: 15,
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    marginRight: 12,
    width: 30,
  },
  signOutCopy: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  signOutTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  signOutSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
