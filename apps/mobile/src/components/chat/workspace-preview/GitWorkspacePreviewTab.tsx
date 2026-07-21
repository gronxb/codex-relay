import type { WorkspaceChangesResponse } from "codex-relay/api-schema";
import { memo, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import {
  AppBottomSheet,
  AppBottomSheetTextInput,
  SheetActionRow,
  SheetSelectedDot,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type { AppIconName } from "@/components/ui/icon";
import { Icon } from "@/components/ui/icon";
import { Text as UiText } from "@/components/ui/text";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { hapticSelection } from "@/lib/haptics";
import { workspaceName } from "@/lib/workspace-name";

import { HighlightedCodeBlock } from "../MessageBubble";

type PendingAction = "checkout" | "commit-push" | "pr" | null;
type PublishConfirmation = "commit-push" | "pr" | null;
type WorkspaceChangeFile = WorkspaceChangesResponse["files"][number];

const DIFF_FILE_RENDER_LIMIT = 24;
const DIFF_PATCH_LINE_RENDER_LIMIT = 220;

export const GitWorkspacePreviewTab = memo(function GitWorkspacePreviewTab({
  isRunning,
  isLoadingChanges,
  workspaceChanges,
  workspaceChangesError,
  onCheckoutBranch,
  onCommitPush,
  onCreatePullRequest,
  onRefreshChanges,
}: {
  isRunning: boolean;
  isLoadingChanges: boolean;
  workspaceChanges?: WorkspaceChangesResponse;
  workspaceChangesError?: string;
  onCheckoutBranch: (branch: string) => Promise<void> | void;
  onCommitPush: () => Promise<void> | void;
  onCreatePullRequest: () => Promise<void> | void;
  onRefreshChanges: () => Promise<void> | void;
}) {
  const [isPullRefreshing, setPullRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [publishConfirmation, setPublishConfirmation] = useState<PublishConfirmation>(null);
  const isInitialLoading = !workspaceChanges && isLoadingChanges && !workspaceChangesError;

  async function refreshFromPull() {
    hapticSelection();
    setPullRefreshing(true);
    try {
      await onRefreshChanges();
    } finally {
      setPullRefreshing(false);
    }
  }

  async function runDiffAction(action: NonNullable<PendingAction>, callback: () => Promise<void>) {
    setPendingAction(action);
    try {
      await callback();
    } catch (caught) {
      Alert.alert("Action failed", errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  function confirmPublishAction() {
    const action = publishConfirmation;
    if (!action) {
      return;
    }

    setPublishConfirmation(null);
    void runDiffAction(action, async () => {
      if (action === "commit-push") {
        await onCommitPush();
        return;
      }

      await onCreatePullRequest();
    });
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.diffContent, isInitialLoading && styles.loadingGitContent]}
        refreshControl={
          <RefreshControl
            colors={[Colors.dark.text]}
            progressBackgroundColor={Colors.dark.backgroundElement}
            refreshing={isPullRefreshing}
            tintColor={Colors.dark.text}
            onRefresh={() => void refreshFromPull()}
          />
        }
        showsVerticalScrollIndicator={false}
        style={styles.contentPane}
      >
        {workspaceChangesError ? (
          <Animated.View
            key="changes-error"
            entering={gitPreviewEnterTransition}
            exiting={gitPreviewExitTransition}
            layout={gitPreviewLayoutTransition}
            style={styles.emptyState}
          >
            <ThemedText type="smallBold">Unable to load changes</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {workspaceChangesError}
            </ThemedText>
          </Animated.View>
        ) : workspaceChanges?.hasChanges ? (
          <Animated.View
            key="changes-diff"
            entering={gitPreviewEnterTransition}
            exiting={gitPreviewExitTransition}
            layout={gitPreviewLayoutTransition}
            style={styles.diffStack}
          >
            <DiffActions
              isRunning={isRunning}
              changes={workspaceChanges}
              pendingAction={pendingAction}
              onCheckoutBranch={(branch) =>
                runDiffAction("checkout", async () => {
                  await onCheckoutBranch(branch);
                })
              }
              onCommitPush={() => setPublishConfirmation("commit-push")}
              onCreatePullRequest={() => setPublishConfirmation("pr")}
            />
            <DiffSummary changes={workspaceChanges} />
            {workspaceChanges.files.length > 0 ? (
              <DiffFilesPreview files={workspaceChanges.files} />
            ) : workspaceChanges.diff ? (
              <Animated.View
                key="diff-fallback"
                entering={gitPreviewEnterTransition}
                exiting={gitPreviewExitTransition}
                layout={gitPreviewLayoutTransition}
                style={styles.diffFallback}
              >
                <HighlightedCodeBlock code={workspaceChanges.diff} language="diff" />
              </Animated.View>
            ) : (
              <Animated.View
                key="untracked-only"
                entering={gitPreviewEnterTransition}
                exiting={gitPreviewExitTransition}
                layout={gitPreviewLayoutTransition}
                style={styles.emptyState}
              >
                <ThemedText type="smallBold">Only untracked files changed</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Git diff has no tracked-file patch to show yet.
                </ThemedText>
              </Animated.View>
            )}
          </Animated.View>
        ) : (
          <Animated.View
            key="changes-empty"
            entering={gitPreviewEnterTransition}
            exiting={gitPreviewExitTransition}
            layout={gitPreviewLayoutTransition}
            style={styles.diffStack}
          >
            {workspaceChanges ? (
              <DiffActions
                isRunning={isRunning}
                changes={workspaceChanges}
                pendingAction={pendingAction}
                onCheckoutBranch={(branch) =>
                  runDiffAction("checkout", async () => {
                    await onCheckoutBranch(branch);
                  })
                }
                onCommitPush={() => setPublishConfirmation("commit-push")}
                onCreatePullRequest={() => setPublishConfirmation("pr")}
              />
            ) : null}
            {isInitialLoading ? <LoadingGitIndicator /> : <EmptyChangesCard />}
          </Animated.View>
        )}
      </ScrollView>
      <AppBottomSheet
        title={publishConfirmation ? publishConfirmationTitle(publishConfirmation) : "Publish"}
        subtitle={workspaceChanges ? publishConfirmationSubtitle(workspaceChanges) : undefined}
        onClose={() => setPublishConfirmation(null)}
        visible={publishConfirmation !== null}
      >
        {publishConfirmation ? (
          <View style={styles.publishConfirmationContent}>
            <SheetActionRow
              accessibilityLabel={publishConfirmationTitle(publishConfirmation)}
              icon={publishConfirmationIcon(publishConfirmation)}
              onPress={confirmPublishAction}
              subtitle={publishConfirmationActionSubtitle(publishConfirmation)}
              title={publishConfirmationTitle(publishConfirmation)}
            />
          </View>
        ) : null}
      </AppBottomSheet>
    </>
  );
});

function EmptyChangesCard() {
  return (
    <Animated.View
      entering={gitPreviewEnterTransition}
      exiting={gitPreviewExitTransition}
      layout={gitPreviewLayoutTransition}
      style={styles.emptyState}
    >
      <ThemedText type="smallBold">No workspace changes</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        The current workspace is clean.
      </ThemedText>
    </Animated.View>
  );
}

function LoadingGitIndicator() {
  return (
    <Animated.View
      entering={gitPreviewEnterTransition}
      exiting={gitPreviewExitTransition}
      layout={gitPreviewLayoutTransition}
      style={styles.loadingGit}
    >
      <ActivityIndicator color={Colors.dark.textSecondary} size="small" />
      <ThemedText type="smallBold" style={styles.loadingGitText}>
        Loading Git
      </ThemedText>
    </Animated.View>
  );
}

function publishConfirmationTitle(action: NonNullable<PublishConfirmation>) {
  return action === "commit-push" ? "Commit & Push" : "Create PR";
}

function publishConfirmationIcon(action: NonNullable<PublishConfirmation>): AppIconName {
  return action === "commit-push" ? "upload" : "pullRequest";
}

function publishConfirmationSubtitle(changes: WorkspaceChangesResponse) {
  return `${visibleChangedFileCount(changes)} files, +${changes.stats.additions} -${
    changes.stats.deletions
  }`;
}

function publishConfirmationActionSubtitle(action: NonNullable<PublishConfirmation>) {
  return action === "commit-push"
    ? "Commit current workspace changes and push this branch."
    : "Create a draft pull request from current workspace changes.";
}

function DiffActions({
  changes,
  isRunning,
  pendingAction,
  onCheckoutBranch,
  onCommitPush,
  onCreatePullRequest,
}: {
  changes: WorkspaceChangesResponse;
  isRunning: boolean;
  pendingAction: PendingAction;
  onCheckoutBranch: (branch: string) => void;
  onCommitPush: () => void;
  onCreatePullRequest: () => void;
}) {
  const currentBranch = changes.currentBranch;
  const changedFileCount = visibleChangedFileCount(changes);
  const isActionDisabled = isRunning || pendingAction !== null;

  return (
    <Animated.View layout={gitPreviewLayoutTransition} style={styles.actionsPanel}>
      {changes.branches.length > 0 ? (
        <BranchSwitcher
          branches={changes.branches}
          currentBranch={currentBranch}
          disabled={isActionDisabled}
          workspaceName={workspaceDisplayName(changes.workspacePath)}
          onCheckoutBranch={onCheckoutBranch}
        />
      ) : null}
      <Animated.View layout={gitPreviewFastLayoutTransition} style={styles.actionSection}>
        <Animated.View layout={gitPreviewFastLayoutTransition} style={styles.sectionHeader}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Publish
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" style={styles.sectionMeta}>
            {changedFileCount} files, +{changes.stats.additions} -{changes.stats.deletions}
          </ThemedText>
        </Animated.View>
        <Animated.View layout={gitPreviewFastLayoutTransition} style={styles.publishButtonRow}>
          <DiffActionButton
            disabled={isActionDisabled}
            iconName="upload"
            label={pendingAction === "commit-push" ? "Starting" : "Commit & Push"}
            onPress={onCommitPush}
          />
          <DiffActionButton
            disabled={isActionDisabled}
            iconName="pullRequest"
            label={pendingAction === "pr" ? "Starting PR" : "Create PR"}
            onPress={onCreatePullRequest}
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

type BranchEntry = WorkspaceChangesResponse["branches"][number];

function BranchSwitcher({
  branches,
  currentBranch,
  disabled,
  workspaceName,
  onCheckoutBranch,
}: {
  branches: BranchEntry[];
  currentBranch: string | null;
  disabled: boolean;
  workspaceName: string;
  onCheckoutBranch: (branch: string) => void;
}) {
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchEntry | undefined>(
    () => branches.find((branch) => branch.current) ?? branches[0],
  );
  const [branchDraft, setBranchDraft] = useState("");
  const activeBranch = branches.find((branch) => branch.current);
  const normalizedBranchDraft = branchDraft.trim();
  const draftBranch = normalizedBranchDraft
    ? branches.find((branch) => branch.name === normalizedBranchDraft)
    : undefined;
  const targetBranchName = normalizedBranchDraft || selectedBranch?.name || "";
  const isCurrentTarget =
    targetBranchName.length > 0 && targetBranchName === (activeBranch?.name ?? currentBranch);
  const canCheckout = targetBranchName.length > 0 && !isCurrentTarget;
  const isCreatingBranch = Boolean(normalizedBranchDraft && !draftBranch);

  function openSheet() {
    const initialBranch = activeBranch ?? branches[0];
    setSelectedBranch(initialBranch);
    setBranchDraft(initialBranch?.name ?? "");
    setSheetOpen(true);
  }

  function updateBranchDraft(nextDraft: string) {
    setBranchDraft(nextDraft);
    const matchingBranch = branches.find((branch) => branch.name === nextDraft.trim());
    if (matchingBranch) {
      setSelectedBranch(matchingBranch);
    }
  }

  function confirmCheckout() {
    if (!canCheckout) {
      return;
    }

    setSheetOpen(false);
    onCheckoutBranch(targetBranchName);
  }

  return (
    <Animated.View
      entering={gitPreviewEnterTransition}
      exiting={gitPreviewExitTransition}
      layout={gitPreviewLayoutTransition}
      style={styles.actionSection}
    >
      <Animated.View layout={gitPreviewFastLayoutTransition} style={styles.sectionHeader}>
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Branch
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary" style={styles.sectionMeta}>
          {branches.length} available
        </ThemedText>
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open branch switcher"
        disabled={disabled}
        onPress={openSheet}
        style={({ pressed }) => [
          styles.branchSwitchButton,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <View pointerEvents="none" style={styles.branchSwitchContent}>
          <View style={styles.branchSwitchIcon}>
            <Icon name="branch" size={16} tintColor={Colors.dark.text} />
          </View>
          <View style={styles.branchSwitchCopy}>
            <ThemedText type="smallBold" style={styles.branchSwitchTitle} numberOfLines={1}>
              {currentBranch ?? "detached"}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.branchSwitchSubtitle}
              numberOfLines={1}
            >
              Switch workspace branch
            </ThemedText>
          </View>
          <Icon name="chevronRight" size={16} tintColor={Colors.dark.textSecondary} />
        </View>
      </Pressable>
      <AppBottomSheet
        title="Switch Branch"
        subtitle={workspaceName}
        onClose={() => setSheetOpen(false)}
        scrollable={false}
        visible={isSheetOpen}
      >
        <View style={styles.branchSheetContent}>
          <View style={styles.branchCreateCard}>
            <UiText style={styles.branchCreateLabel}>Branch name</UiText>
            <View style={styles.branchCreateRow}>
              <AppBottomSheetTextInput
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={updateBranchDraft}
                onSubmitEditing={confirmCheckout}
                placeholder="feature/mobile-polish"
                placeholderTextColor={Colors.dark.textSecondary}
                returnKeyType="go"
                selectTextOnFocus
                selectionColor={Colors.dark.text}
                style={styles.branchCreateInput}
                value={branchDraft}
              />
              <Button
                accessibilityRole="button"
                accessibilityLabel={isCreatingBranch ? "Create and switch branch" : "Switch branch"}
                disabled={!canCheckout}
                onPress={confirmCheckout}
                size="default"
                variant="secondary"
                className="h-12 rounded-md border border-border bg-secondary/80"
                style={({ pressed }) => [
                  styles.branchInlineButtonPressable,
                  !canCheckout && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <UiText
                  className="text-foreground"
                  style={styles.branchInlineButtonText}
                  numberOfLines={1}
                >
                  {isCreatingBranch ? "Create" : "Switch"}
                </UiText>
              </Button>
            </View>
            <UiText style={styles.branchCreateHint} numberOfLines={2}>
              {isCreatingBranch
                ? "Creates a new branch from the current checkout, then switches to it."
                : draftBranch?.current
                  ? "This is the current branch."
                  : "Matches an existing branch and switches to it."}
            </UiText>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.branchSheetList}
            contentContainerStyle={styles.branchSheetListContent}
          >
            {branches.map((branch) => {
              const selected = branch.name === selectedBranch?.name;
              return (
                <SheetActionRow
                  key={branch.name}
                  accessibilityLabel={`Select ${branch.name}`}
                  icon="branch"
                  onPress={() => {
                    setSelectedBranch(branch);
                    setBranchDraft(branch.name);
                  }}
                  selected={selected}
                  subtitle={branch.current ? "Current branch" : "Available branch"}
                  title={branch.name}
                  trailing={<SheetSelectedDot selected={selected} />}
                />
              );
            })}
          </ScrollView>
        </View>
      </AppBottomSheet>
    </Animated.View>
  );
}

function DiffActionButton({
  disabled = false,
  iconName,
  label,
  onPress,
}: {
  disabled?: boolean;
  iconName: AppIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <PreviewControlButton
      accessibilityLabel={label}
      active={!disabled}
      disabled={disabled}
      iconName={iconName}
      label={label}
      onPress={onPress}
    />
  );
}

function DiffSummary({ changes }: { changes: WorkspaceChangesResponse }) {
  const changedFileCount = visibleChangedFileCount(changes);

  return (
    <Animated.View
      entering={gitPreviewEnterTransition}
      exiting={gitPreviewExitTransition}
      layout={gitPreviewLayoutTransition}
      style={styles.summaryBar}
    >
      <ThemedText type="smallBold" style={styles.summaryTitle} numberOfLines={1}>
        {changedFileCount} files changed
      </ThemedText>
      <View style={styles.summaryStats}>
        <ThemedText type="code" style={styles.additions}>
          +{changes.stats.additions}
        </ThemedText>
        <ThemedText type="code" style={styles.deletions}>
          -{changes.stats.deletions}
        </ThemedText>
      </View>
    </Animated.View>
  );
}

function visibleChangedFileCount(changes: WorkspaceChangesResponse) {
  return changes.files.length > 0 ? changes.files.length : changes.stats.filesChanged;
}

function DiffFilesPreview({ files }: { files: WorkspaceChangeFile[] }) {
  const visibleFiles = useMemo(() => files.slice(0, DIFF_FILE_RENDER_LIMIT), [files]);
  const hiddenFileCount = files.length - visibleFiles.length;

  return (
    <>
      {visibleFiles.map((file) => (
        <DiffFileCard key={`${file.oldPath ?? ""}:${file.path}`} file={file} />
      ))}
      {hiddenFileCount > 0 ? (
        <View style={styles.noPatch}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.noPatchText}
            numberOfLines={2}
          >
            Showing first {visibleFiles.length} of {files.length} changed files.
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}

function DiffFileCard({ file }: { file: WorkspaceChangeFile }) {
  return (
    <Animated.View
      entering={gitPreviewEnterTransition}
      exiting={gitPreviewExitTransition}
      layout={gitPreviewLayoutTransition}
      style={styles.fileCard}
    >
      <View style={styles.fileHeader}>
        <View style={styles.fileTitleGroup}>
          <View style={styles.fileMetaRow}>
            <View style={styles.statusBadge}>
              <ThemedText type="code" style={styles.statusBadgeText}>
                {shortStatus(file.status)}
              </ThemedText>
            </View>
            <ThemedText type="code" themeColor="textSecondary" style={styles.fileStats}>
              +{file.additions} -{file.deletions}
            </ThemedText>
          </View>
          <ThemedText type="code" style={styles.filePath} numberOfLines={2}>
            {file.oldPath && file.oldPath !== file.path
              ? `${file.oldPath} -> ${file.path}`
              : file.path}
          </ThemedText>
        </View>
      </View>
      {file.patch ? (
        <DiffPatchBlock patch={file.patch} />
      ) : (
        <View style={styles.noPatch}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.noPatchText}
            numberOfLines={2}
          >
            No text patch available for this file.
          </ThemedText>
        </View>
      )}
    </Animated.View>
  );
}

function DiffPatchBlock({ patch }: { patch: string }) {
  const { hiddenLineCount, lines } = useMemo(() => {
    const occurrences = new Map<string, number>();
    const patchLines = patch.split("\n");
    const visiblePatchLines = patchLines.slice(0, DIFF_PATCH_LINE_RENDER_LIMIT);
    const lines = visiblePatchLines.map((text) => {
      const occurrence = (occurrences.get(text) ?? 0) + 1;
      occurrences.set(text, occurrence);
      return { id: `${text}:${occurrence}`, text };
    });
    return { hiddenLineCount: patchLines.length - visiblePatchLines.length, lines };
  }, [patch]);

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={styles.patchScroller}
    >
      <View style={styles.patchLines}>
        {lines.map((line) => (
          <UiText key={line.id} selectable style={[styles.patchLine, patchLineStyle(line.text)]}>
            {line.text || " "}
          </UiText>
        ))}
        {hiddenLineCount > 0 ? (
          <UiText selectable style={[styles.patchLine, styles.patchLineMeta]}>
            ... {hiddenLineCount} more diff lines
          </UiText>
        ) : null}
      </View>
    </ScrollView>
  );
}

function patchLineStyle(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return styles.patchLineAdded;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return styles.patchLineDeleted;
  }
  if (line.startsWith("@@")) {
    return styles.patchLineHunk;
  }
  if (line.startsWith("diff --git") || line.startsWith("---") || line.startsWith("+++")) {
    return styles.patchLineMeta;
  }
  return styles.patchLineContext;
}

function shortStatus(status: string) {
  switch (status) {
    case "Added":
    case "Untracked":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Copied":
      return "C";
    case "Typechange":
      return "T";
    case "Conflicted":
      return "U";
    default:
      return "M";
  }
}

function PreviewControlButton({
  accessibilityLabel,
  active = false,
  disabled = false,
  iconName,
  label,
  onPress,
  selected,
}: {
  accessibilityLabel: string;
  active?: boolean;
  disabled?: boolean;
  iconName: AppIconName;
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <View style={styles.controlButtonSlot}>
      <Button
        accessibilityRole="button"
        accessibilityState={{ disabled, selected }}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onPress={onPress}
        size="default"
        variant="secondary"
        className="h-12 rounded-md border border-border bg-secondary/80 p-0"
        style={({ pressed }) => [
          styles.controlButton,
          active && styles.controlButtonActive,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Icon
          name={iconName}
          size={14}
          tintColor={active ? Colors.dark.text : Colors.dark.textSecondary}
        />
        <UiText
          className="text-foreground"
          numberOfLines={1}
          style={[styles.controlButtonText, active && styles.controlButtonTextActive]}
        >
          {label}
        </UiText>
      </Button>
    </View>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function workspaceDisplayName(workspacePath: string) {
  return workspaceName(workspacePath) ?? workspacePath;
}

const gitPreviewLayoutTransition = LinearTransition.duration(180);
const gitPreviewFastLayoutTransition = LinearTransition.duration(120);
const gitPreviewEnterTransition = FadeIn.duration(120);
const gitPreviewExitTransition = FadeOut.duration(90);

const styles = StyleSheet.create({
  contentPane: {
    flex: 1,
    marginHorizontal: Spacing.three,
  },
  diffContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  loadingGitContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  diffStack: {
    gap: Spacing.two,
  },
  actionsPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.two,
    padding: Spacing.two,
  },
  actionSection: {
    gap: Spacing.two,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    minWidth: 0,
  },
  sectionMeta: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: "right",
  },
  controlButtonSlot: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  controlButton: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    flexDirection: "row",
    gap: Spacing.two,
    height: 48,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: Spacing.two,
    width: "100%",
  },
  controlButtonActive: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderColor: "rgba(255, 255, 255, 0.24)",
  },
  controlButtonText: {
    color: Colors.dark.textSecondary,
    flexShrink: 1,
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  controlButtonTextActive: {
    color: Colors.dark.text,
  },
  branchSwitchButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: Spacing.two,
  },
  branchSwitchContent: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: Spacing.two,
    minWidth: 0,
  },
  branchSwitchIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  branchSwitchCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  branchSwitchTitle: {
    color: Colors.dark.text,
    fontSize: 13,
    lineHeight: 18,
  },
  branchSwitchSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  branchSheetContent: {
    gap: Spacing.two,
  },
  branchCreateCard: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(132, 145, 165, 0.2)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.one,
    padding: Spacing.two,
  },
  branchCreateHint: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  branchCreateInput: {
    backgroundColor: "rgba(0, 0, 0, 0.22)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 8,
    borderWidth: 1,
    color: Colors.dark.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 15,
    height: 48,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: Spacing.two,
    paddingVertical: 0,
  },
  branchCreateLabel: {
    color: Colors.dark.text,
    fontFamily: Fonts.sansBold,
    fontSize: 12,
    lineHeight: 16,
  },
  branchCreateRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: Spacing.one,
    height: 48,
    width: "100%",
  },
  branchSheetList: {
    maxHeight: 280,
  },
  branchSheetListContent: {
    gap: Spacing.one,
    paddingBottom: Spacing.one,
  },
  branchInlineButtonPressable: {
    height: 48,
    minWidth: 92,
    paddingHorizontal: Spacing.two,
  },
  branchInlineButtonText: {
    color: Colors.dark.text,
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    lineHeight: 19,
    textAlign: "center",
  },
  publishButtonRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: Spacing.two,
    width: "100%",
  },
  publishConfirmationContent: {
    gap: Spacing.one,
  },
  summaryBar: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(132, 145, 165, 0.2)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
    paddingHorizontal: Spacing.two,
  },
  summaryTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    minWidth: 0,
  },
  summaryStats: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  additions: {
    color: "#72E09F",
    fontSize: 12,
    lineHeight: 16,
  },
  deletions: {
    color: "#FF8F8F",
    fontSize: 12,
    lineHeight: 16,
  },
  fileCard: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  fileHeader: {
    borderBottomColor: "rgba(132, 145, 165, 0.18)",
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  fileTitleGroup: {
    gap: Spacing.one,
    minWidth: 0,
  },
  fileMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  statusBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(132, 145, 165, 0.24)",
    borderRadius: 5,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 24,
  },
  statusBadgeText: {
    color: Colors.dark.text,
    fontSize: 11,
    lineHeight: 14,
  },
  fileStats: {
    fontSize: 11,
    lineHeight: 16,
  },
  filePath: {
    color: Colors.dark.text,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  diffFallback: {
    minWidth: 0,
  },
  patchScroller: {
    backgroundColor: "rgba(5, 8, 13, 0.72)",
  },
  patchLines: {
    paddingVertical: Spacing.two,
  },
  patchLine: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    minWidth: "100%",
    paddingHorizontal: Spacing.three,
  },
  patchLineAdded: {
    backgroundColor: "rgba(46, 160, 67, 0.16)",
    color: "#A7F3C1",
  },
  patchLineDeleted: {
    backgroundColor: "rgba(248, 81, 73, 0.14)",
    color: "#FFB3B3",
  },
  patchLineHunk: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: Colors.dark.text,
  },
  patchLineMeta: {
    color: "#8B98AA",
  },
  patchLineContext: {
    color: Colors.dark.textSecondary,
  },
  noPatch: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  noPatchText: {
    fontSize: 12,
    lineHeight: 17,
  },
  emptyState: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(132, 145, 165, 0.2)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  loadingGit: {
    alignItems: "center",
    gap: Spacing.two,
    justifyContent: "center",
    minHeight: 180,
  },
  loadingGitText: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.7,
  },
});
