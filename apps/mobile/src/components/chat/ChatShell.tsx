import type {
  ChatMessage,
  AgentSkill,
  ContextWindowUsage,
  PendingInputRequest,
  RateLimitBucket,
  ThreadCollaborationMode,
  ThreadGoal,
} from "codex-relay/api-schema";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Keyboard, View } from "react-native";
import {
  KeyboardController,
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import type { QueuedComposerPrompt } from "@/state/chat-store";

import { ChatComposer } from "./ChatComposer";
import { ChatShellHeader, type ChatShellAction } from "./ChatShellHeader";
import { chatShellStyles as styles } from "./chat-shell-styles";
import { implementablePlanId, MessageTimeline } from "./MessageTimeline";
import { PlanProgressBanner } from "./PlanProgressBanner";
import { splitTimelinePlanProgress } from "./plan-progress";
import type { WorkspaceMarkdownPreviewTarget } from "./workspace-preview/markdown-target";

export function ChatShell({
  banner,
  composerDisabled,
  composerDisabledPlaceholder,
  composerFooter,
  composerFocusRequestKey,
  composerFocusRecoveryKey,
  composerInputEditable,
  contextWindowUsage,
  collaborationMode,
  goal,
  inputNativeID,
  isAttachingImage,
  isLoadingMessages,
  isRunning,
  leadingAction,
  messages,
  onAttachImage,
  onCancel,
  onCollaborationModeChange,
  onAddPlanContext,
  onImplementPlan,
  onIgnoreInputRequest,
  onOpenMarkdownAttachment,
  onMessageCopied,
  onMessageRewind,
  onRefreshUsageStatus,
  onSubmitInputRequest,
  onRemoveQueuedPrompt,
  onRestoreQueuedPrompt,
  onSend,
  onSteerQueuedPrompt,
  onClearGoal,
  onSaveGoal,
  onToggleGoalPause,
  queuedPrompts,
  rateLimitBuckets,
  pendingInputRequest,
  skills,
  skillsLoadState,
  subtitle,
  threadId,
  title,
  trailingActions,
  workspacePath,
}: {
  banner?: ReactNode;
  composerDisabled: boolean;
  composerDisabledPlaceholder?: string;
  composerFooter?: ReactNode;
  composerFocusRequestKey?: number;
  composerFocusRecoveryKey?: number | string;
  composerInputEditable?: boolean;
  contextWindowUsage?: ContextWindowUsage;
  collaborationMode: ThreadCollaborationMode;
  goal?: ThreadGoal | null;
  inputNativeID: string;
  isAttachingImage: boolean;
  isLoadingMessages?: boolean;
  isRunning: boolean;
  leadingAction: ChatShellAction;
  messages: ChatMessage[];
  onAttachImage: () => Promise<void> | void;
  onCancel: () => void;
  onCollaborationModeChange: (mode: ThreadCollaborationMode) => void;
  onAddPlanContext?: (context: string) => void;
  onImplementPlan?: () => void;
  onIgnoreInputRequest?: (request: PendingInputRequest) => void;
  onMessageCopied?: () => void;
  onMessageRewind?: (message: ChatMessage) => void;
  onOpenMarkdownAttachment?: (target: WorkspaceMarkdownPreviewTarget) => void;
  onRefreshUsageStatus?: () => Promise<void> | void;
  onSubmitInputRequest?: (request: PendingInputRequest, answers: string[]) => void;
  onRemoveQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onRestoreQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onSend: () => void;
  onSteerQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onClearGoal?: () => void;
  onSaveGoal?: (objective: string) => void;
  onToggleGoalPause?: () => void;
  queuedPrompts: QueuedComposerPrompt[];
  rateLimitBuckets: RateLimitBucket[];
  pendingInputRequest?: PendingInputRequest;
  skills: AgentSkill[];
  skillsLoadState: "idle" | "loading" | "loaded" | "failed";
  subtitle: string;
  threadId?: string;
  title: string;
  trailingActions: ChatShellAction[];
  workspacePath?: string;
}) {
  const insets = useSafeAreaInsets();
  const [isKeyboardLayoutFrozen, setKeyboardLayoutFrozen] = useState(false);
  const [queuedPromptPanelHeight, setQueuedPromptPanelHeight] = useState(0);
  const {
    progress: planProgress,
    subagents: planSubagents,
    visibleMessages,
  } = useMemo(() => splitTimelinePlanProgress(messages, isRunning), [isRunning, messages]);
  const implementablePlanMessageId = useMemo(
    () => (!isRunning ? implementablePlanId(messages) : undefined),
    [isRunning, messages],
  );
  const handleQueuedPromptPanelHeightChange = useCallback((height: number) => {
    setQueuedPromptPanelHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }, []);
  const handleTimelineKeyboardDismissRequest = useCallback(() => {
    setKeyboardLayoutFrozen(false);
    Keyboard.dismiss();
    void KeyboardController.dismiss().catch(() => undefined);
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={[
          styles.safeArea,
          { paddingBottom: Math.max(Spacing.one, insets.bottom - Spacing.four) },
        ]}
      >
        <View style={styles.shell}>
          <ChatShellHeader
            leadingAction={leadingAction}
            subtitle={subtitle}
            title={title}
            trailingActions={trailingActions}
          />

          <PlanProgressBanner progress={planProgress} subagents={planSubagents} />

          {banner}

          <KeyboardGestureArea
            interpolator="ios"
            style={styles.chatBody}
            textInputNativeID={inputNativeID}
          >
            <View style={styles.timeline}>
              <MessageTimeline
                isLoading={isLoadingMessages}
                isRunning={isRunning}
                keyboardLayoutFrozen={isKeyboardLayoutFrozen}
                messages={visibleMessages}
                onMessageCopied={onMessageCopied}
                onMessageRewind={onMessageRewind}
                onOpenMarkdownAttachment={onOpenMarkdownAttachment}
                onKeyboardDismissRequest={handleTimelineKeyboardDismissRequest}
                bottomAccessoryHeight={queuedPromptPanelHeight}
                threadId={threadId}
              />
            </View>

            <KeyboardStickyView style={styles.composerDock}>
              <ChatComposer
                collaborationMode={collaborationMode}
                composerThreadId={threadId}
                contextWindowUsage={contextWindowUsage}
                goal={goal}
                disabled={composerDisabled}
                disabledPlaceholder={composerDisabledPlaceholder}
                inputEditable={composerInputEditable}
                focusRequestKey={composerFocusRequestKey}
                focusRecoveryKey={composerFocusRecoveryKey}
                isAttachingImage={isAttachingImage}
                isRunning={isRunning}
                nativeID={inputNativeID}
                onAttachImage={onAttachImage}
                onCancel={onCancel}
                onCollaborationModeChange={onCollaborationModeChange}
                onAddPlanContext={onAddPlanContext}
                onImplementPlan={onImplementPlan}
                onIgnoreInputRequest={onIgnoreInputRequest}
                onRefreshUsageStatus={onRefreshUsageStatus}
                onSubmitInputRequest={onSubmitInputRequest}
                onKeyboardLayoutFrozenChange={setKeyboardLayoutFrozen}
                onRemoveQueuedPrompt={onRemoveQueuedPrompt}
                onRestoreQueuedPrompt={onRestoreQueuedPrompt}
                onSend={onSend}
                onSteerQueuedPrompt={onSteerQueuedPrompt}
                onClearGoal={onClearGoal}
                onSaveGoal={onSaveGoal}
                onToggleGoalPause={onToggleGoalPause}
                onQueuedPromptPanelHeightChange={handleQueuedPromptPanelHeightChange}
                planConfirmationId={implementablePlanMessageId}
                pendingInputRequest={pendingInputRequest}
                queuedPrompts={queuedPrompts}
                rateLimitBuckets={rateLimitBuckets}
                skills={skills}
                skillsLoadState={skillsLoadState}
                footer={composerFooter}
                workspacePath={workspacePath}
              />
            </KeyboardStickyView>
          </KeyboardGestureArea>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
