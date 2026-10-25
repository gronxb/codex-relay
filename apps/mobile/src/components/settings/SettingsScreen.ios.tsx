import {
  Button,
  DisclosureGroup,
  Form,
  Gauge,
  Host,
  HStack,
  Image,
  Label,
  LabeledContent,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  disabled,
  font,
  foregroundStyle,
  gaugeStyle,
  listRowBackground,
  onTapGesture,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  appUpdateStatusSuffix,
  clampPercent,
  compactServer,
  connectionLabel,
  rateLimitProgressColor,
  useRemoteConfigPanel,
  useSettingsScreen,
  type HotUpdaterRemoteConfig,
} from "@/components/settings/use-settings-screen";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import {
  codexRelayRepositoryLabel,
  codexRelayRepositoryUrl,
  codexRelaySponsorLabel,
  codexRelaySponsorUrl,
} from "@/constants/links";
import { Colors, MaxContentWidth } from "@/constants/theme";
import { hotUpdater, hotUpdaterBaseUrl } from "@/lib/hot-updater";
import { clearHotUpdaterLogs, formatHotUpdaterLogTime } from "@/lib/hot-updater-logs";
import { formatRateLimitRemaining } from "@/lib/rate-limits";

const ROW_BACKGROUND = "#202222";
const secondaryText = [foregroundStyle("secondary")];
const footnote = [font({ textStyle: "footnote" }), foregroundStyle("secondary")];
const monospaced = [font({ textStyle: "footnote", design: "monospaced" })];

// Native SwiftUI Form; the hook owns every piece of state and every action.
export function SettingsScreen() {
  const settings = useSettingsScreen();
  const {
    appUpdate,
    appUpdateActionLabel,
    appliedBundleSuffix,
    applyAppUpdate,
    closeSettings,
    computerName,
    connection,
    hasPairedSession,
    isAppUpdateActionDisabled,
    isAppUpdatePending,
    openProjectLink,
    pushNotificationPreferences,
    pushNotificationsLoading,
    pushNotificationsSupported,
    pushNotificationsUpdating,
    rateLimitRows,
    rateLimitsFetching,
    releaseVersionLabel,
    revealHotUpdaterLogs,
    selectServerAddress,
    serverUrl,
    serverUrlCandidates,
    signOut,
    switchingServerUrl,
    updatePushNotificationPreference,
  } = settings;
  const notificationsDisabled = pushNotificationsLoading || pushNotificationsUpdating;
  const updateSuffix = appUpdateStatusSuffix(appUpdate.status);
  const versionLine = [
    `Version ${releaseVersionLabel}`,
    updateSuffix,
    appliedBundleSuffix ? `bundle ${appliedBundleSuffix}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to threads"
            hitSlop={8}
            onPress={closeSettings}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <Icon name="back" size={19} tintColor={Colors.dark.text} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>
            Settings
          </ThemedText>
          <View style={styles.headerButton} />
        </View>
        <Host colorScheme="dark" style={styles.host}>
          <Form modifiers={[scrollContentBackground("hidden")]}>
            <Section title="Project" modifiers={[listRowBackground(ROW_BACKGROUND)]}>
              <Button onPress={() => openProjectLink(codexRelayRepositoryUrl)}>
                <LabeledContent
                  label={
                    <Label title="GitHub" systemImage="chevron.left.forwardslash.chevron.right" />
                  }
                >
                  <Text modifiers={footnote}>{codexRelayRepositoryLabel}</Text>
                </LabeledContent>
              </Button>
              <Button onPress={() => openProjectLink(codexRelaySponsorUrl)}>
                <LabeledContent
                  label={<Label title="Sponsor" systemImage="heart.fill" color="#FF9FC0" />}
                >
                  <Text modifiers={footnote}>{codexRelaySponsorLabel}</Text>
                </LabeledContent>
              </Button>
            </Section>

            <Section title="Usage Limits" modifiers={[listRowBackground(ROW_BACKGROUND)]}>
              {rateLimitRows.length > 0 ? (
                rateLimitRows.map((row) => (
                  <RateLimitGauge
                    key={row.id}
                    label={row.label}
                    remainingPercent={row.window.remainingPercent}
                    remainingText={formatRateLimitRemaining(row.window)}
                    usedPercent={row.window.usedPercent}
                  />
                ))
              ) : (
                <LabeledContent label="Rate limits">
                  <Text modifiers={secondaryText}>
                    {rateLimitsFetching
                      ? "Checking current usage"
                      : "Unavailable from this runtime"}
                  </Text>
                </LabeledContent>
              )}
            </Section>

            <Section
              title="Connected Computer"
              footer={
                hasPairedSession ? undefined : (
                  <Text>Pair this device from the main screen to choose a relay server.</Text>
                )
              }
              modifiers={[listRowBackground(ROW_BACKGROUND)]}
            >
              <LabeledContent label={<Label title={computerName} systemImage="desktopcomputer" />}>
                <HStack spacing={6}>
                  <Image
                    systemName="circle.fill"
                    size={8}
                    color={
                      connection === "connected"
                        ? "#2CA36F"
                        : connection === "offline"
                          ? "#FF9B8D"
                          : "#9A9A9A"
                    }
                  />
                  <Text modifiers={monospaced}>{connectionLabel(connection)}</Text>
                </HStack>
              </LabeledContent>
              {hasPairedSession ? (
                <LabeledContent label="Server">
                  <Text modifiers={[...monospaced, foregroundStyle("secondary")]}>
                    {compactServer(serverUrl)}
                  </Text>
                </LabeledContent>
              ) : null}
              {hasPairedSession
                ? serverUrlCandidates.map((candidate) => {
                    const isSelected = candidate.url === serverUrl;
                    const isSwitching = switchingServerUrl === candidate.url;
                    return (
                      <Button
                        key={candidate.url}
                        onPress={() => void selectServerAddress(candidate)}
                        modifiers={[disabled(isSelected || Boolean(switchingServerUrl))]}
                      >
                        <HStack spacing={10}>
                          <VStack alignment="leading" spacing={2}>
                            <Text modifiers={[foregroundStyle("primary")]}>{candidate.label}</Text>
                            <Text modifiers={[...monospaced, foregroundStyle("secondary")]}>
                              {compactServer(candidate.url)}
                            </Text>
                          </VStack>
                          <Spacer />
                          {isSwitching ? (
                            <Text modifiers={footnote}>Checking</Text>
                          ) : isSelected ? (
                            <Image systemName="checkmark" size={15} color="#93E1B6" />
                          ) : null}
                        </HStack>
                      </Button>
                    );
                  })
                : null}
            </Section>

            {hasPairedSession ? (
              <Section
                title="Notifications"
                footer={
                  <Text>
                    {pushNotificationsSupported
                      ? "Generic alerts only. Chat content stays on your paired computer."
                      : "Push notifications are available in the iOS and Android apps."}
                  </Text>
                }
                modifiers={[listRowBackground(ROW_BACKGROUND)]}
              >
                {pushNotificationsSupported ? (
                  <>
                    <NotificationToggle
                      disabled={notificationsDisabled}
                      isOn={pushNotificationPreferences.turnTerminal}
                      onChange={(value) =>
                        void updatePushNotificationPreference("turnTerminal", value)
                      }
                      subtitle="When Codex completes or fails a turn"
                      title="Turn complete"
                    />
                    <NotificationToggle
                      disabled={notificationsDisabled}
                      isOn={pushNotificationPreferences.includeRemainingUsage}
                      onChange={(value) =>
                        void updatePushNotificationPreference("includeRemainingUsage", value)
                      }
                      subtitle="Show the lowest remaining Codex limit after a turn"
                      title="Remaining usage"
                    />
                    <NotificationToggle
                      disabled={notificationsDisabled}
                      isOn={pushNotificationPreferences.actionRequired}
                      onChange={(value) =>
                        void updatePushNotificationPreference("actionRequired", value)
                      }
                      subtitle="When Codex needs approval or input"
                      title="Action required"
                    />
                  </>
                ) : null}
              </Section>
            ) : null}

            {hasPairedSession ? (
              <Section title="Session" modifiers={[listRowBackground(ROW_BACKGROUND)]}>
                <Button
                  label="Sign out"
                  systemImage="rectangle.portrait.and.arrow.right"
                  // eslint-disable-next-line jsx-a11y/aria-role -- SwiftUI button role, not ARIA
                  role="destructive"
                  onPress={signOut}
                />
              </Section>
            ) : null}

            <Section
              modifiers={[listRowBackground(ROW_BACKGROUND)]}
              footer={
                isAppUpdatePending && appUpdate.updateInfo?.message ? (
                  <Text>{appUpdate.updateInfo.message}</Text>
                ) : undefined
              }
            >
              <HStack spacing={8}>
                <Image
                  systemName={isAppUpdatePending ? "arrow.triangle.2.circlepath" : "checkmark.seal"}
                  size={13}
                  color={isAppUpdatePending ? "#93E1B6" : "#9A9A9A"}
                />
                <Text modifiers={[...monospaced, onTapGesture(revealHotUpdaterLogs)]}>
                  {versionLine}
                </Text>
                <Spacer />
                {isAppUpdatePending ? (
                  <Button
                    label={appUpdateActionLabel}
                    onPress={() => void applyAppUpdate()}
                    modifiers={[disabled(isAppUpdateActionDisabled)]}
                  />
                ) : null}
              </HStack>
              {settings.showHotUpdaterLogs ? (
                <HotUpdaterLogs
                  logs={settings.hotUpdaterLogs}
                  onHide={() => settings.setShowHotUpdaterLogs(false)}
                />
              ) : null}
            </Section>
          </Form>
        </Host>
      </View>
    </SafeAreaView>
  );
}

function RateLimitGauge({
  label,
  remainingPercent,
  remainingText,
  usedPercent,
}: {
  label: string;
  remainingPercent: number;
  remainingText: string;
  usedPercent: number;
}) {
  const used = clampPercent(usedPercent);
  const remaining = clampPercent(remainingPercent);
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack>
        <Text>{label}</Text>
        <Spacer />
        <Text modifiers={[...monospaced, foregroundStyle(rateLimitProgressColor(remaining))]}>
          {remaining}%
        </Text>
      </HStack>
      <Gauge
        value={used / 100}
        modifiers={[gaugeStyle("linearCapacity"), tint(rateLimitProgressColor(remaining))]}
      />
      <HStack>
        <Text modifiers={footnote}>{remainingText} left</Text>
        <Spacer />
        <Text modifiers={footnote}>Used {used}%</Text>
      </HStack>
    </VStack>
  );
}

function NotificationToggle({
  disabled: isDisabled,
  isOn,
  onChange,
  subtitle,
  title,
}: {
  disabled: boolean;
  isOn: boolean;
  onChange: (value: boolean) => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Toggle isOn={isOn} onIsOnChange={onChange} modifiers={[disabled(isDisabled)]}>
      <VStack alignment="leading" spacing={2}>
        <Text>{title}</Text>
        <Text modifiers={footnote}>{subtitle}</Text>
      </VStack>
    </Toggle>
  );
}

// Revealed by five taps on the version line.
function HotUpdaterLogs({
  logs: hotUpdaterLogs,
  onHide,
}: {
  logs: ReturnType<typeof useSettingsScreen>["hotUpdaterLogs"];
  onHide: () => void;
}) {
  return (
    <DisclosureGroup label={`Logs (${hotUpdater?.getCohort() ?? "none"})`} isExpanded>
      <HStack spacing={12}>
        <Button label="Clear" onPress={clearHotUpdaterLogs} />
        <Button label="Hide" onPress={onHide} />
      </HStack>
      <LabeledContent label="Base URL">
        <Text modifiers={[...monospaced, foregroundStyle(hotUpdaterBaseUrl ? "primary" : "red")]}>
          {hotUpdaterBaseUrl ? "configured" : "missing"}
        </Text>
      </LabeledContent>
      {hotUpdater?.remoteConfig ? (
        <RemoteConfigRows remoteConfig={hotUpdater.remoteConfig} />
      ) : null}
      {hotUpdaterLogs.length > 0 ? (
        hotUpdaterLogs.map((entry) => (
          <VStack key={entry.id} alignment="leading" spacing={2}>
            <Text modifiers={[...monospaced, foregroundStyle("secondary")]}>
              {formatHotUpdaterLogTime(entry.timestamp)} · {entry.level.toUpperCase()}
            </Text>
            <Text>{entry.message}</Text>
            {entry.details ? <Text modifiers={footnote}>{entry.details}</Text> : null}
          </VStack>
        ))
      ) : (
        <Text modifiers={footnote}>No OTA download events captured in this session.</Text>
      )}
    </DisclosureGroup>
  );
}

function RemoteConfigRows({ remoteConfig }: { remoteConfig: HotUpdaterRemoteConfig }) {
  const { fetchNow, fetching, fetchedAtMs, notice, values } = useRemoteConfigPanel(remoteConfig);
  return (
    <>
      <HStack>
        <Text>Remote Config v{remoteConfig.activeVersion}</Text>
        <Spacer />
        <Button
          label={fetching ? "Fetching" : "Fetch"}
          onPress={() => void fetchNow()}
          modifiers={[disabled(fetching)]}
        />
      </HStack>
      <Text modifiers={footnote}>
        {remoteConfig.lastFetchStatus}
        {fetchedAtMs === null ? "" : ` · ${formatHotUpdaterLogTime(fetchedAtMs)}`}
      </Text>
      {notice ? <Text>{notice}</Text> : null}
      {Object.entries(values).map(([key, value]) => (
        <LabeledContent key={key} label={key}>
          <Text modifiers={[...monospaced, foregroundStyle("secondary")]}>
            {value.asString() === "" ? '""' : value.asString()} · {value.getSource()}
          </Text>
        </LabeledContent>
      ))}
    </>
  );
}

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
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  title: {
    color: Colors.dark.text,
  },
  pressed: {
    opacity: 0.6,
  },
  host: {
    flex: 1,
  },
});
