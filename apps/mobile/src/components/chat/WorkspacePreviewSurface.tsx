import type { WebPreviewTarget, WorkspaceChangesResponse } from "codex-relay/api-schema";
import { useSelector } from "@legendapp/state/react";
import { useEffect, useRef, useState } from "react";
import { InteractionManager, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { AppBottomSheet, SheetActionRow } from "@/components/ui/bottom-sheet";
import type { AppIconName } from "@/components/ui/icon";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { hapticSelection } from "@/lib/haptics";
import {
  addWorkspacePreviewTab,
  DEFAULT_WORKSPACE_PREVIEW_TABS,
  removeWorkspacePreviewTab,
  setActiveWorkspacePreviewTab,
  WORKSPACE_PREVIEW_TABS,
  type WorkspacePreviewTab,
  workspacePreviewStore$,
  workspacePreviewKey,
} from "@/state/workspace-preview-store";

import { FileWorkspacePreviewTab } from "./workspace-preview/FileWorkspacePreviewTab";
import { GitWorkspacePreviewTab } from "./workspace-preview/GitWorkspacePreviewTab";
import type { WorkspaceMarkdownPreviewTarget } from "./workspace-preview/markdown-target";
import { MarkdownWorkspacePreviewTab } from "./workspace-preview/MarkdownWorkspacePreviewTab";
import { WorkspaceSshTerminalTab } from "./workspace-preview/WorkspaceSshTerminalTab";
import { WebWorkspacePreviewTab } from "./workspace-preview/WebWorkspacePreviewTab";

type WorkspacePreviewTabDefinition = {
  icon: AppIconName;
  label: string;
  subtitle: string;
};

const GIT_TAB_AUTO_REFRESH_STALE_TIME_MS = 15_000;
const CLOSED_TAB_UNMOUNT_DELAY_MS = 360;

const WORKSPACE_PREVIEW_TAB_DEFINITIONS: Record<
  WorkspacePreviewTab,
  WorkspacePreviewTabDefinition
> = {
  git: {
    icon: "branch",
    label: "Git",
    subtitle: "Review and publish workspace changes.",
  },
  files: {
    icon: "folder",
    label: "Files",
    subtitle: "Explore files and preview code or Markdown.",
  },
  markdown: {
    icon: "file",
    label: "Markdown",
    subtitle: "Read Markdown documents from chat attachments.",
  },
  web: {
    icon: "web",
    label: "Web",
    subtitle: "Open a local browser preview.",
  },
  ssh: {
    icon: "terminal",
    label: "SSH",
    subtitle: "Open a workspace terminal and connect with ssh.",
  },
};

export function WorkspacePreviewSurface({
  isFocused,
  isRunning,
  isLoadingChanges,
  serverUrl,
  workspaceChanges,
  workspaceChangesError,
  workspacePath,
  markdownPreviewTarget,
  webPreviewTarget,
  onClose,
  showCloseButton = true,
  onCheckoutBranch,
  onCommitPush,
  onCreatePullRequest,
  onRefreshChanges,
}: {
  isFocused: boolean;
  isRunning: boolean;
  isLoadingChanges: boolean;
  serverUrl: string;
  workspaceChanges?: WorkspaceChangesResponse;
  workspaceChangesError?: string;
  workspacePath?: string;
  markdownPreviewTarget?: WorkspaceMarkdownPreviewTarget;
  webPreviewTarget?: WebPreviewTarget;
  onClose: () => void;
  showCloseButton?: boolean;
  onCheckoutBranch: (branch: string) => Promise<void> | void;
  onCommitPush: () => Promise<void> | void;
  onCreatePullRequest: () => Promise<void> | void;
  onRefreshChanges: (options?: { staleTime?: number }) => Promise<void> | void;
}) {
  const workspaceKey = workspacePreviewKey(workspacePath);
  const previewTabs = useSelector(
    () =>
      workspacePreviewStore$.tabsByWorkspacePath[workspaceKey].get() ??
      DEFAULT_WORKSPACE_PREVIEW_TABS,
  );
  const activePreviewTab = useSelector(() =>
    workspacePreviewStore$.activeTabByWorkspacePath[workspaceKey].get(),
  );
  const activeTab =
    activePreviewTab && previewTabs.includes(activePreviewTab) ? activePreviewTab : previewTabs[0];
  const previewTabsRef = useRef(previewTabs);
  const lastAutoAddedPreviewUrlRef = useRef<string | undefined>(undefined);
  const lastGitAutoRefreshRef = useRef({ at: 0, workspaceKey: "" });
  const closedTabCleanupTasksRef = useRef<Array<{ cancel: () => void }>>([]);
  const [isAddTabSheetOpen, setAddTabSheetOpen] = useState(false);
  const [retainedClosedTabs, setRetainedClosedTabs] = useState<WorkspacePreviewTab[]>([]);
  const [mountedTabs, setMountedTabs] = useState<WorkspacePreviewTab[]>(() =>
    activeTab ? [activeTab] : [],
  );

  useEffect(
    () => () => {
      closedTabCleanupTasksRef.current.forEach((task) => task.cancel());
      closedTabCleanupTasksRef.current = [];
    },
    [],
  );

  useEffect(() => {
    previewTabsRef.current = previewTabs;
  }, [previewTabs]);

  useEffect(() => {
    if (!webPreviewTarget?.url || lastAutoAddedPreviewUrlRef.current === webPreviewTarget.url) {
      return;
    }

    lastAutoAddedPreviewUrlRef.current = webPreviewTarget.url;
    addWorkspacePreviewTab(workspacePath, "web", { activate: false });
  }, [webPreviewTarget?.url, workspacePath]);

  useEffect(() => {
    setMountedTabs((current) => {
      const retainedTabs = new Set([...previewTabs, ...retainedClosedTabs]);
      const openMountedTabs = current.filter((tab) => retainedTabs.has(tab));
      if (!activeTab || openMountedTabs.includes(activeTab)) {
        return openMountedTabs.length === current.length ? current : openMountedTabs;
      }
      return [...openMountedTabs, activeTab];
    });
  }, [activeTab, previewTabs, retainedClosedTabs]);

  useEffect(() => {
    if (!isFocused || activeTab !== "git" || isLoadingChanges) {
      return;
    }

    const now = Date.now();
    const lastRefresh = lastGitAutoRefreshRef.current;
    if (
      lastRefresh.workspaceKey === workspaceKey &&
      now - lastRefresh.at < GIT_TAB_AUTO_REFRESH_STALE_TIME_MS
    ) {
      return;
    }

    lastGitAutoRefreshRef.current = { at: now, workspaceKey };
    void onRefreshChanges({ staleTime: GIT_TAB_AUTO_REFRESH_STALE_TIME_MS });
  }, [activeTab, isFocused, isLoadingChanges, onRefreshChanges, workspaceKey]);

  function selectTab(nextTab: WorkspacePreviewTab) {
    setActiveWorkspacePreviewTab(workspacePath, nextTab);
    hapticSelection();
  }

  function addTab(nextTab: WorkspacePreviewTab) {
    hapticSelection();
    addWorkspacePreviewTab(workspacePath, nextTab);
    setAddTabSheetOpen(false);
  }

  function closeTab(tab: WorkspacePreviewTab) {
    hapticSelection();
    setRetainedClosedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    removeWorkspacePreviewTab(workspacePath, tab);
    scheduleClosedTabCleanup(tab);
  }

  function scheduleClosedTabCleanup(tab: WorkspacePreviewTab) {
    const timeout = setTimeout(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (previewTabsRef.current.includes(tab)) {
          return;
        }
        setRetainedClosedTabs((current) => current.filter((candidate) => candidate !== tab));
        setMountedTabs((current) => current.filter((candidate) => candidate !== tab));
      });
      closedTabCleanupTasksRef.current.push(task);
    }, CLOSED_TAB_UNMOUNT_DELAY_MS);

    closedTabCleanupTasksRef.current.push({ cancel: () => clearTimeout(timeout) });
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        {showCloseButton ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back from workspace preview"
            onPress={onClose}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Icon name="back" size={18} tintColor={Colors.dark.text} />
          </Pressable>
        ) : null}
        <View style={styles.titleGroup}>
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            Preview
          </ThemedText>
          <ThemedText
            type="code"
            themeColor="textSecondary"
            style={styles.subtitle}
            numberOfLines={1}
          >
            {workspaceChanges?.workspacePath ?? workspacePath ?? "Workspace"}
          </ThemedText>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.tabStrip}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabStripScroller}
          contentContainerStyle={styles.tabStripContent}
        >
          {previewTabs.map((tab) => (
            <WorkspaceTab
              key={tab}
              active={tab === activeTab}
              tab={tab}
              onClose={() => closeTab(tab)}
              onPress={() => selectTab(tab)}
            />
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add workspace preview tab"
          onPress={() => {
            hapticSelection();
            setAddTabSheetOpen(true);
          }}
          style={({ pressed }) => [styles.addTabButton, pressed && styles.pressed]}
        >
          <Icon name="newThread" size={17} tintColor={Colors.dark.text} />
        </Pressable>
      </View>

      <View style={styles.tabContentViewport}>
        {!activeTab ? (
          <View style={styles.contentPane}>
            <View style={styles.emptyState}>
              <ThemedText type="smallBold">No preview tabs</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add Git, Files, Markdown, Web, or SSH to this workspace preview.
              </ThemedText>
            </View>
          </View>
        ) : (
          mountedTabs.map((tab) => (
            <Animated.View
              key={tab}
              entering={workspacePreviewTabEnterTransition}
              exiting={workspacePreviewTabExitTransition}
              layout={workspacePreviewTabLayoutTransition}
              pointerEvents={tab === activeTab ? "auto" : "none"}
              style={[styles.tabContentPage, tab !== activeTab && styles.tabContentPageInactive]}
            >
              {tab === "git" ? (
                <GitWorkspacePreviewTab
                  isRunning={isRunning}
                  isLoadingChanges={isLoadingChanges}
                  workspaceChanges={workspaceChanges}
                  workspaceChangesError={workspaceChangesError}
                  onCheckoutBranch={onCheckoutBranch}
                  onCommitPush={onCommitPush}
                  onCreatePullRequest={onCreatePullRequest}
                  onRefreshChanges={onRefreshChanges}
                />
              ) : tab === "files" ? (
                <FileWorkspacePreviewTab workspacePath={workspacePath} />
              ) : tab === "markdown" ? (
                <MarkdownWorkspacePreviewTab
                  target={markdownPreviewTarget}
                  workspacePath={workspacePath}
                />
              ) : tab === "web" ? (
                <WebWorkspacePreviewTab
                  serverUrl={serverUrl}
                  workspacePath={workspacePath}
                  webPreviewTarget={webPreviewTarget}
                />
              ) : (
                <WorkspaceSshTerminalTab workspacePath={workspacePath} />
              )}
            </Animated.View>
          ))
        )}
      </View>
      <AppBottomSheet
        title="Add Tab"
        subtitle={workspaceChanges?.workspacePath ?? workspacePath ?? "Workspace"}
        onClose={() => setAddTabSheetOpen(false)}
        visible={isAddTabSheetOpen}
      >
        <View style={styles.addTabSheetContent}>
          {availableTabs(previewTabs).map((tab) => (
            <SheetActionRow
              key={tab}
              accessibilityLabel={`Add ${previewTabLabel(tab)} tab`}
              icon={previewTabIcon(tab)}
              onPress={() => addTab(tab)}
              subtitle={previewTabSubtitle(tab)}
              title={previewTabLabel(tab)}
            />
          ))}
          {availableTabs(previewTabs).length === 0 ? (
            <View style={styles.addTabEmpty}>
              <ThemedText type="small" themeColor="textSecondary">
                All available tabs are already open.
              </ThemedText>
            </View>
          ) : null}
        </View>
      </AppBottomSheet>
    </SafeAreaView>
  );
}

function WorkspaceTab({
  active,
  tab,
  onClose,
  onPress,
}: {
  active: boolean;
  tab: WorkspacePreviewTab;
  onClose: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Show ${previewTabLabel(tab)} tab`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.workspaceTab,
        active && styles.workspaceTabActive,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={previewTabIcon(tab)}
        size={14}
        tintColor={active ? Colors.dark.text : Colors.dark.textSecondary}
      />
      <Text
        numberOfLines={1}
        style={[styles.workspaceTabText, active && styles.workspaceTabTextActive]}
      >
        {previewTabLabel(tab)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${previewTabLabel(tab)} tab`}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={({ pressed }) => [styles.workspaceTabClose, pressed && styles.pressed]}
      >
        <Icon name="x" size={13} tintColor={Colors.dark.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

function availableTabs(openTabs: WorkspacePreviewTab[]) {
  return WORKSPACE_PREVIEW_TABS.filter((tab) => !openTabs.includes(tab));
}

function previewTabIcon(tab: WorkspacePreviewTab): AppIconName {
  return WORKSPACE_PREVIEW_TAB_DEFINITIONS[tab].icon;
}

function previewTabLabel(tab: WorkspacePreviewTab) {
  return WORKSPACE_PREVIEW_TAB_DEFINITIONS[tab].label;
}

function previewTabSubtitle(tab: WorkspacePreviewTab) {
  return WORKSPACE_PREVIEW_TAB_DEFINITIONS[tab].subtitle;
}

const workspacePreviewTabEnterTransition = FadeIn.duration(110);
const workspacePreviewTabExitTransition = FadeOut.duration(80);
const workspacePreviewTabLayoutTransition = LinearTransition.duration(120);

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.dark.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(132, 145, 165, 0.24)",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  headerSpacer: {
    height: 36,
    width: 36,
  },
  titleGroup: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 14,
  },
  tabStrip: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.one,
    marginBottom: Spacing.two,
    marginHorizontal: Spacing.three,
    minHeight: 46,
    padding: 3,
  },
  tabStripScroller: {
    flex: 1,
    minWidth: 0,
  },
  tabStripContent: {
    alignItems: "center",
    gap: Spacing.one,
    minHeight: 38,
  },
  workspaceTab: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.one,
    height: 38,
    maxWidth: 150,
    minWidth: 96,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.one,
  },
  workspaceTabActive: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  workspaceTabText: {
    color: Colors.dark.textSecondary,
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
    minWidth: 0,
  },
  workspaceTabTextActive: {
    color: Colors.dark.text,
  },
  workspaceTabClose: {
    alignItems: "center",
    borderRadius: 12,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  addTabButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  contentPane: {
    flex: 1,
    marginHorizontal: Spacing.three,
  },
  tabContentViewport: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  tabContentPage: {
    flex: 1,
  },
  tabContentPageInactive: {
    display: "none",
  },
  addTabSheetContent: {
    gap: Spacing.one,
  },
  addTabEmpty: {
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
  },
  emptyState: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(132, 145, 165, 0.2)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
});
