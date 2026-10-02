import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useSelector } from "@legendapp/state/react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgentSkill,
  ContextWindowUsage,
  ListWorkspaceFilesResponse,
  PendingInputRequest,
  RateLimitBucket,
  ThreadCollaborationMode,
  ThreadGoal,
} from "codex-relay/api-schema";
import { promptSkillMentionLabel, promptSkillMentionTextCandidates } from "codex-relay/api-schema";
import { Image } from "expo-image";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Pressable,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputInstance,
} from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type MarkdownStyle,
  type MarkdownTextInputStyle,
} from "react-native-enriched-markdown";
import { KeyboardController, useKeyboardState } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";

import {
  AppBottomSheet,
  AppBottomSheetTextInput,
  SheetActionRow,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Icon, type AppIconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { listWorkspaceFiles } from "@/lib/codex-relay-api";
import { hapticMediumImpact, hapticSelection, hapticWarning } from "@/lib/haptics";
import { formatRateLimitRemaining, visibleRateLimitRows } from "@/lib/rate-limits";
import {
  chatStore$,
  composerThreadKey,
  removeComposerAttachment,
  setComposerDraft,
  setComposerSkills,
  type ComposerAttachment,
  type QueuedComposerPrompt,
} from "@/state/chat-store";

import { PromptMarkdownText } from "./PromptMarkdownText";

const ATTACH_SHEET_DISMISS_DELAY_MS = 260;
const ADD_SHEET_KEYBOARD_DISMISS_FALLBACK_MS = 360;
const FILE_MENTION_INDICATOR = "@";
const SKILL_MENTION_INDICATOR = "$";
const DEFAULT_COMPOSER_PLACEHOLDER = "Ask Codex anything. Try $skills or @files.";
const PLAN_COMPOSER_PLACEHOLDER = "Ask Codex for a plan. Try $skills or @files.";
const SUGGESTION_ROW_ESTIMATED_SIZE = 44;
const SUGGESTION_LIST_GAP = 2;
const SUGGESTION_LIST_MAX_HEIGHT = 270;
const QUEUE_LEADING_SLOT_SIZE = 28;
const QUEUE_CONTENT_GAP = 8;
const QUEUE_STEER_BUTTON_WIDTH = 80;
const QUEUE_ICON_BUTTON_SIZE = 28;
const QUEUE_ACTION_GAP = 6;
const QUEUE_ACTIONS_WIDTH =
  QUEUE_STEER_BUTTON_WIDTH + QUEUE_ICON_BUTTON_SIZE * 2 + QUEUE_ACTION_GAP * 2;
const MENTION_INPUT_MARKDOWN_STYLE = {
  link: {
    color: "#7CC7FF",
    underline: false,
  },
} satisfies MarkdownTextInputStyle;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type PlanDecision = "context" | "implement";

type PanelDraftState = {
  inputRequest: {
    answerDraft: string;
    answers: string[];
    freeformSelected: boolean;
    questionIndex: number;
    requestId?: string;
    selectedOption?: string;
  };
  plan: {
    confirmationId?: string;
    contextDraft: string;
    decision: PlanDecision;
  };
};

type PanelDraftAction =
  | { type: "reset-plan"; confirmationId?: string }
  | { type: "set-plan-context"; confirmationId?: string; value: string }
  | { type: "set-plan-decision"; confirmationId?: string; value: PlanDecision }
  | { type: "reset-input-request"; requestId?: string }
  | { type: "set-input-answer"; requestId?: string; value: string }
  | { type: "select-input-freeform"; requestId?: string }
  | { type: "select-input-option"; requestId?: string; option: string }
  | { type: "advance-input-question"; requestId?: string; answers: string[] };

const initialPanelDraftState: PanelDraftState = {
  inputRequest: {
    answerDraft: "",
    answers: [],
    freeformSelected: false,
    questionIndex: 0,
  },
  plan: {
    contextDraft: "",
    decision: "implement",
  },
};

function panelDraftReducer(state: PanelDraftState, action: PanelDraftAction): PanelDraftState {
  switch (action.type) {
    case "reset-plan":
      return {
        ...state,
        plan: { confirmationId: action.confirmationId, contextDraft: "", decision: "implement" },
      };
    case "set-plan-context":
      return {
        ...state,
        plan: {
          ...activePlanDraft(state, action.confirmationId),
          contextDraft: action.value,
        },
      };
    case "set-plan-decision":
      return {
        ...state,
        plan: {
          ...activePlanDraft(state, action.confirmationId),
          decision: action.value,
        },
      };
    case "reset-input-request":
      return { ...state, inputRequest: initialInputRequestDraft(action.requestId) };
    case "set-input-answer":
      return {
        ...state,
        inputRequest: {
          ...activeInputRequestDraft(state, action.requestId),
          answerDraft: action.value,
          freeformSelected: true,
          selectedOption: undefined,
        },
      };
    case "select-input-freeform":
      return {
        ...state,
        inputRequest: {
          ...activeInputRequestDraft(state, action.requestId),
          freeformSelected: true,
          selectedOption: undefined,
        },
      };
    case "select-input-option":
      return {
        ...state,
        inputRequest: {
          ...activeInputRequestDraft(state, action.requestId),
          answerDraft: "",
          freeformSelected: false,
          selectedOption: action.option,
        },
      };
    case "advance-input-question":
      return {
        ...state,
        inputRequest: {
          ...initialInputRequestDraft(action.requestId),
          answers: action.answers,
          questionIndex: activeInputRequestDraft(state, action.requestId).questionIndex + 1,
        },
      };
  }
}

function activePlanDraft(state: PanelDraftState, confirmationId: string | undefined) {
  return state.plan.confirmationId === confirmationId
    ? state.plan
    : { confirmationId, contextDraft: "", decision: "implement" as const };
}

function activeInputRequestDraft(state: PanelDraftState, requestId: string | undefined) {
  return state.inputRequest.requestId === requestId
    ? state.inputRequest
    : initialInputRequestDraft(requestId);
}

function initialInputRequestDraft(requestId: string | undefined) {
  return {
    answerDraft: "",
    answers: [],
    freeformSelected: false,
    questionIndex: 0,
    requestId,
    selectedOption: undefined,
  };
}

export const ChatComposer = memo(function ChatComposer({
  contextWindowUsage,
  disabled,
  disabledPlaceholder,
  footer,
  focusRequestKey,
  focusRecoveryKey,
  inputEditable,
  isAttachingImage,
  isRunning,
  goal,
  nativeID,
  pendingInputRequest,
  planConfirmationId,
  composerThreadId,
  collaborationMode,
  queuedPrompts,
  onAddPlanContext,
  onAttachImage,
  onCancel,
  onCollaborationModeChange,
  onImplementPlan,
  onIgnoreInputRequest,
  onKeyboardLayoutFrozenChange,
  onRefreshUsageStatus,
  onSubmitInputRequest,
  onQueuedPromptPanelHeightChange,
  onRemoveQueuedPrompt,
  onRestoreQueuedPrompt,
  onSend,
  onSteerQueuedPrompt,
  onClearGoal,
  onSaveGoal,
  onToggleGoalPause,
  rateLimitBuckets,
  skills,
  skillsLoadState,
  workspacePath,
}: {
  contextWindowUsage?: ContextWindowUsage;
  disabled: boolean;
  disabledPlaceholder?: string;
  footer?: ReactNode;
  focusRequestKey?: number;
  focusRecoveryKey?: number | string;
  inputEditable?: boolean;
  isAttachingImage: boolean;
  isRunning: boolean;
  goal?: ThreadGoal | null;
  nativeID?: string;
  pendingInputRequest?: PendingInputRequest;
  planConfirmationId?: string;
  composerThreadId?: string;
  collaborationMode: ThreadCollaborationMode;
  queuedPrompts: QueuedComposerPrompt[];
  onAddPlanContext?: (context: string) => void;
  onAttachImage: () => Promise<void> | void;
  onCancel: () => void;
  onCollaborationModeChange: (mode: ThreadCollaborationMode) => void;
  onImplementPlan?: () => void;
  onIgnoreInputRequest?: (request: PendingInputRequest) => void;
  onKeyboardLayoutFrozenChange?: (frozen: boolean) => void;
  onRefreshUsageStatus?: () => Promise<void> | void;
  onSubmitInputRequest?: (request: PendingInputRequest, answers: string[]) => void;
  onQueuedPromptPanelHeightChange?: (height: number) => void;
  onRemoveQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onRestoreQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onSend: () => void;
  onSteerQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onClearGoal?: () => void;
  onSaveGoal?: (objective: string) => void;
  onToggleGoalPause?: () => void;
  rateLimitBuckets: RateLimitBucket[];
  skills: AgentSkill[];
  skillsLoadState: "idle" | "loading" | "loaded" | "failed";
  workspacePath?: string;
}) {
  const theme = useTheme();
  const composerKey = composerThreadKey(composerThreadId);
  const attachments = useSelector(
    () => chatStore$.composerAttachmentsByThreadId[composerKey].get() ?? [],
  );
  const selectedSkills = useSelector(
    () => chatStore$.composerSkillsByThreadId[composerKey].get() ?? [],
  );
  const value = useSelector(() => chatStore$.composerDraftByThreadId[composerKey].get() ?? "");
  const [isAddSheetOpen, setAddSheetOpen] = useState(false);
  const [isAttachLaunchPending, setAttachLaunchPending] = useState(false);
  const [dismissedPlanConfirmationId, setDismissedPlanConfirmationId] = useState<
    string | undefined
  >();
  const [panelDraftState, dispatchPanelDraft] = useReducer(
    panelDraftReducer,
    initialPanelDraftState,
  );
  const [inputSelection, setInputSelection] = useState({ end: 0, start: 0 });
  const [fileMentionQuery, setFileMentionQuery] = useState<string | undefined>();
  const [skillMentionQuery, setSkillMentionQuery] = useState<string | undefined>();
  const planDraft = activePlanDraft(panelDraftState, planConfirmationId);
  const inputRequestDraft = activeInputRequestDraft(panelDraftState, pendingInputRequest?.id);
  const planDecision = planDraft.decision;
  const planContextDraft = planDraft.contextDraft;
  const inputRequestAnswerDraft = inputRequestDraft.answerDraft;
  const inputRequestAnswers = inputRequestDraft.answers;
  const inputRequestQuestionIndex = inputRequestDraft.questionIndex;
  const isInputRequestFreeformSelected = inputRequestDraft.freeformSelected;
  const selectedInputOption = inputRequestDraft.selectedOption;
  const inputRef = useRef<EnrichedMarkdownTextInputInstance | null>(null);
  const isInputFocusedRef = useRef(false);
  const lastInputFocusAtRef = useRef(0);
  const previousFocusRecoveryKeyRef = useRef(focusRecoveryKey);
  const fileMentionRangesRef = useRef<FileMentionRange[]>([]);
  const skillMentionRangesRef = useRef<SkillMentionRange[]>([]);
  const nativeDraftRef = useRef(value);
  const nativeMarkdownRef = useRef(value);
  const ignoredMarkdownChangeRef = useRef<string | undefined>(undefined);
  const ignoredMarkdownChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const attachLaunchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible);
  const isInputEditable = inputEditable ?? !disabled;
  const hasMessageContent =
    Boolean(value.trim()) || attachments.length > 0 || selectedSkills.length > 0;
  const isAttachBusy = isAttachingImage || isAttachLaunchPending;
  const canSend = hasMessageContent && !disabled && !isAttachBusy;
  const canStop = isRunning && !hasMessageContent;
  const showSendButton = !isRunning || hasMessageContent;
  const actionLabel = isRunning ? "Send running input" : "Send";
  const rateLimitRows = visibleRateLimitRows(rateLimitBuckets);
  const isPlanMode = collaborationMode === "plan";
  const shouldShowSkillSuggestions = Boolean(
    skillMentionQuery !== undefined &&
    !disabled &&
    skillsLoadState !== "idle" &&
    skillsLoadState !== "loading",
  );
  const shouldFetchFileSuggestions = Boolean(fileMentionQuery !== undefined && !disabled);
  const fileSuggestionsQuery = useQuery({
    enabled: shouldFetchFileSuggestions,
    queryFn: () => listWorkspaceFiles({ query: fileMentionQuery, workspacePath }),
    queryKey: ["codex-relay-workspace-files", workspacePath ?? null, fileMentionQuery ?? ""],
    staleTime: 10_000,
  });
  const visibleFiles = fileSuggestionsQuery.data?.files ?? [];
  const shouldShowFileSuggestions = Boolean(fileMentionQuery !== undefined && !disabled);
  const visibleSkills = useMemo(() => {
    if (skillMentionQuery === undefined) {
      return [];
    }
    return filterSkills(skills, skillMentionQuery);
  }, [skillMentionQuery, skills]);
  const inputStyle = useMemo(
    () => ({
      ...styles.input,
      ...(isPlanMode ? styles.inputWithModeChip : undefined),
      color: theme.text,
    }),
    [isPlanMode, theme.text],
  );
  const inputMarkdownStyle = MENTION_INPUT_MARKDOWN_STYLE;
  const shouldShowPlanConfirmation = Boolean(
    planConfirmationId &&
    planConfirmationId !== dismissedPlanConfirmationId &&
    !disabled &&
    !isRunning &&
    !hasMessageContent,
  );

  useEffect(() => {
    return () => {
      if (attachLaunchTimeoutRef.current) {
        clearTimeout(attachLaunchTimeoutRef.current);
      }
      if (ignoredMarkdownChangeTimeoutRef.current) {
        clearTimeout(ignoredMarkdownChangeTimeoutRef.current);
      }
      if (focusRecoveryTimeoutRef.current) {
        clearTimeout(focusRecoveryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusRequestKey || !isInputEditable) {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [focusRequestKey, isInputEditable]);

  useEffect(() => {
    if (previousFocusRecoveryKeyRef.current === focusRecoveryKey) {
      return;
    }
    previousFocusRecoveryKeyRef.current = focusRecoveryKey;
    if (focusRecoveryKey === undefined || !isInputEditable) {
      return;
    }

    const focusedRecently = Date.now() - lastInputFocusAtRef.current < 1500;
    if (!isInputFocusedRef.current && !focusedRecently && !isKeyboardVisible) {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    if (focusRecoveryTimeoutRef.current) {
      clearTimeout(focusRecoveryTimeoutRef.current);
    }
    focusRecoveryTimeoutRef.current = setTimeout(() => {
      focusRecoveryTimeoutRef.current = undefined;
      inputRef.current?.focus();
    }, 220);
  }, [focusRecoveryKey, isInputEditable, isKeyboardVisible]);

  useEffect(() => {
    const shouldRestoreSkillMentions =
      selectedSkills.length > 0 && skillMentionRangesRef.current.length === 0;
    if (nativeMarkdownRef.current === value && !shouldRestoreSkillMentions) {
      return;
    }
    const markdownMentions = skillMentionsFromMarkdown(value, [...selectedSkills, ...skills]);
    const restoredRanges =
      markdownMentions.ranges.length > 0
        ? markdownMentions.ranges
        : skillMentionRangesFromDraft(value, selectedSkills);
    const plainValue = markdownMentions.ranges.length > 0 ? markdownToPlainText(value) : value;
    nativeDraftRef.current = plainValue;
    nativeMarkdownRef.current = value;
    skillMentionRangesRef.current = restoredRanges;
    const inputMarkdown =
      markdownMentions.ranges.length > 0
        ? value
        : restoredRanges.length > 0
          ? markdownFromDraftWithMentions(plainValue, restoredRanges, fileMentionRangesRef.current)
          : value;
    ignoreNextProgrammaticMarkdownChange(inputMarkdown);
    inputRef.current?.setValue(inputMarkdown);
    if (!value) {
      setFileMentionQuery(undefined);
      setSkillMentionQuery(undefined);
    }
  }, [selectedSkills, skills, value]);

  function attachFromSheet() {
    if (isAttachBusy) {
      return;
    }

    hapticSelection();
    setAttachLaunchPending(true);
    closeAddSheet();
    attachLaunchTimeoutRef.current = setTimeout(() => {
      Promise.resolve(onAttachImage()).finally(() => setAttachLaunchPending(false));
    }, ATTACH_SHEET_DISMISS_DELAY_MS);
  }

  function togglePlanMode() {
    onCollaborationModeChange(isPlanMode ? "default" : "plan");
    closeAddSheet();
  }

  function closeAddSheet() {
    setAddSheetOpen(false);
    onKeyboardLayoutFrozenChange?.(false);
  }

  function dismissComposerKeyboard() {
    inputRef.current?.blur();
    onKeyboardLayoutFrozenChange?.(false);
    void KeyboardController.dismiss().catch(() => undefined);
  }

  function handleSendPress() {
    dismissComposerKeyboard();
    onSend();
  }

  async function openAddSheet() {
    hapticSelection();
    onKeyboardLayoutFrozenChange?.(true);
    inputRef.current?.blur();
    await dismissKeyboardForSheet();
    setAddSheetOpen(true);
  }

  function submitPlanDecision() {
    hapticSelection();
    if (planDecision === "implement") {
      onImplementPlan?.();
      return;
    }
    const context = planContextDraft.trim();
    if (!context) {
      hapticWarning();
      return;
    }
    if (planConfirmationId) {
      setDismissedPlanConfirmationId(planConfirmationId);
    }
    dispatchPanelDraft({ type: "reset-plan", confirmationId: planConfirmationId });
    onAddPlanContext?.(context);
  }

  function submitInputRequestAnswer() {
    if (!pendingInputRequest) {
      return;
    }
    const answer = selectedInputOption ?? inputRequestAnswerDraft.trim();
    const questions = pendingInputRequest.questions;
    const currentQuestion = questions[inputRequestQuestionIndex];
    if (currentQuestion && !answer) {
      hapticWarning();
      return;
    }
    hapticSelection();
    const nextAnswers = [...inputRequestAnswers, answer];
    if (inputRequestQuestionIndex < questions.length - 1) {
      dispatchPanelDraft({
        type: "advance-input-question",
        answers: nextAnswers,
        requestId: pendingInputRequest.id,
      });
      return;
    }
    onSubmitInputRequest?.(pendingInputRequest, nextAnswers);
  }

  async function selectSkill(skill: AgentSkill) {
    hapticSelection();
    const currentMarkdown = await currentInputMarkdown();
    hydrateMentionRefsFromMarkdown(currentMarkdown, [skill]);
    const draft = nativeDraftRef.current;
    const mentionRange = activeSkillMentionRange(
      draft,
      inputSelection,
      skillMentionQuery,
      skillMentionRangesRef.current,
    );
    const replacementRange = mentionRange ?? inputSelection;
    const replacementDisplayText = skillMentionDisplayText(skill);
    const replacementText = `${replacementDisplayText} `;
    const nextDraft = `${draft.slice(0, replacementRange.start)}${replacementText}${draft.slice(
      replacementRange.end,
    )}`;
    const newMentionRange = {
      end: replacementRange.start + replacementDisplayText.length,
      skill,
      start: replacementRange.start,
    };
    const nextRanges = nextSkillMentionRanges(
      skillMentionRangesRef.current,
      replacementRange,
      replacementText.length,
      newMentionRange,
    );
    const nextSkills = uniqueSkills(nextRanges.map((range) => range.skill));
    const cursor = replacementRange.start + replacementText.length;
    const skillMarkdown = markdownFromDraftWithMentions(
      nextDraft,
      nextRanges,
      fileMentionRangesRef.current,
    );

    nativeDraftRef.current = nextDraft;
    nativeMarkdownRef.current = skillMarkdown;
    skillMentionRangesRef.current = nextRanges;
    setComposerDraft(skillMarkdown, composerThreadId);
    setComposerSkills(nextSkills, composerThreadId);
    setSkillMentionQuery(undefined);
    ignoreNextProgrammaticMarkdownChange(skillMarkdown);
    inputRef.current?.setValue(skillMarkdown);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      setInputSelection({ end: cursor, start: cursor });
      inputRef.current?.setSelection(cursor, cursor);
    });
  }

  function selectFileMention(file: WorkspaceFileMention) {
    hapticSelection();
    const draft = nativeDraftRef.current;
    const mentionRange = activeFileMentionRange(draft, inputSelection, fileMentionQuery);
    const replacementRange = mentionRange ?? inputSelection;
    const replacementDisplayText = file.path;
    const replacementText = `${replacementDisplayText} `;
    const nextDraft = `${draft.slice(0, replacementRange.start)}${replacementText}${draft.slice(
      replacementRange.end,
    )}`;
    const newMentionRange = {
      end: replacementRange.start + replacementDisplayText.length,
      file,
      start: replacementRange.start,
    };
    const nextRanges = nextFileMentionRanges(
      fileMentionRangesRef.current,
      replacementRange,
      replacementText.length,
      newMentionRange,
    );
    const cursor = replacementRange.start + replacementText.length;
    const markdown = markdownFromDraftWithMentions(
      nextDraft,
      skillMentionRangesRef.current,
      nextRanges,
    );

    nativeDraftRef.current = nextDraft;
    nativeMarkdownRef.current = markdown;
    fileMentionRangesRef.current = nextRanges;
    setComposerDraft(markdown, composerThreadId);
    setFileMentionQuery(undefined);
    ignoreNextProgrammaticMarkdownChange(markdown);
    inputRef.current?.setValue(markdown);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      setInputSelection({ end: cursor, start: cursor });
      inputRef.current?.setSelection(cursor, cursor);
    });
  }

  function handleInputTextChange(draft: string) {
    if (removeSkillMentionFromTextChange(nativeDraftRef.current, draft)) {
      return;
    }
    if (removeFileMentionFromTextChange(nativeDraftRef.current, draft)) {
      return;
    }
    const nextRanges = nextSkillMentionRangesForTextChange(
      nativeDraftRef.current,
      draft,
      skillMentionRangesRef.current,
    );
    const nextFileRanges = nextFileMentionRangesForTextChange(
      nativeDraftRef.current,
      draft,
      fileMentionRangesRef.current,
    );
    nativeDraftRef.current = draft;
    skillMentionRangesRef.current = nextRanges;
    fileMentionRangesRef.current = nextFileRanges;
    setComposerSkills(
      uniqueSkills(nextRanges.map((candidate) => candidate.skill)),
      composerThreadId,
    );
    setFileMentionQuery(activeFileMentionQuery(draft, inputSelection));
    setSkillMentionQuery(activeSkillMentionQuery(draft, inputSelection, nextRanges));
  }

  function handleInputMarkdownChange(markdown: string) {
    if (ignoredMarkdownChangeRef.current) {
      if (markdown === ignoredMarkdownChangeRef.current) {
        ignoredMarkdownChangeRef.current = undefined;
        if (ignoredMarkdownChangeTimeoutRef.current) {
          clearTimeout(ignoredMarkdownChangeTimeoutRef.current);
          ignoredMarkdownChangeTimeoutRef.current = undefined;
        }
        return;
      }
      ignoredMarkdownChangeRef.current = undefined;
    }
    nativeMarkdownRef.current = markdown;
    syncFileMentionsFromMarkdown(markdown);
    syncSkillMentionsFromMarkdown(markdown);
    setComposerDraft(markdown, composerThreadId);
  }

  function handleInputSelectionChange(selection: { end: number; start: number }) {
    setInputSelection(selection);
    setFileMentionQuery(activeFileMentionQuery(nativeDraftRef.current, selection));
    setSkillMentionQuery(
      activeSkillMentionQuery(nativeDraftRef.current, selection, skillMentionRangesRef.current),
    );
  }

  function removeSkillMentionFromTextChange(previousDraft: string, nextDraft: string) {
    if (nextDraft.length >= previousDraft.length || skillMentionRangesRef.current.length === 0) {
      return false;
    }

    const edit = changedTextRange(previousDraft, nextDraft);

    const range = skillMentionRangesRef.current.find((candidate) => {
      const candidateRemoveEnd =
        previousDraft[candidate.end] === " " ? candidate.end + 1 : candidate.end;
      return edit.previousStart <= candidateRemoveEnd && edit.previousEnd >= candidate.start;
    });
    if (!range) {
      return false;
    }

    removeSkillMentionRange(range);
    return true;
  }

  function removeFileMentionFromTextChange(previousDraft: string, nextDraft: string) {
    if (nextDraft.length >= previousDraft.length || fileMentionRangesRef.current.length === 0) {
      return false;
    }

    const edit = changedTextRange(previousDraft, nextDraft);
    const range = fileMentionRangesRef.current.find((candidate) => {
      const candidateRemoveEnd =
        previousDraft[candidate.end] === " " ? candidate.end + 1 : candidate.end;
      return edit.previousStart <= candidateRemoveEnd && edit.previousEnd >= candidate.start;
    });
    if (!range) {
      return false;
    }

    removeFileMentionRange(range);
    return true;
  }

  function removeSkillMentionRange(range: SkillMentionRange) {
    hapticSelection();
    const draft = nativeDraftRef.current;
    const removeEnd = draft[range.end] === " " ? range.end + 1 : range.end;
    const nextDraft = `${draft.slice(0, range.start)}${draft.slice(removeEnd)}`;
    const removedLength = removeEnd - range.start;
    const nextRanges = skillMentionRangesRef.current.reduce<SkillMentionRange[]>(
      (ranges, candidate) => {
        if (candidate.skill.id === range.skill.id) {
          return ranges;
        }
        if (candidate.start < removeEnd) {
          ranges.push(candidate);
          return ranges;
        }
        ranges.push({
          ...candidate,
          end: candidate.end - removedLength,
          start: candidate.start - removedLength,
        });
        return ranges;
      },
      [],
    );
    nativeDraftRef.current = nextDraft;
    nativeMarkdownRef.current = markdownFromDraftWithMentions(
      nextDraft,
      nextRanges,
      fileMentionRangesRef.current,
    );
    skillMentionRangesRef.current = nextRanges;
    setComposerDraft(nativeMarkdownRef.current, composerThreadId);
    setComposerSkills(
      uniqueSkills(nextRanges.map((candidate) => candidate.skill)),
      composerThreadId,
    );
    ignoreNextProgrammaticMarkdownChange(nativeMarkdownRef.current);
    inputRef.current?.setValue(nativeMarkdownRef.current);
    requestAnimationFrame(() => {
      setInputSelection({ end: range.start, start: range.start });
      inputRef.current?.setSelection(range.start, range.start);
    });
  }

  function removeFileMentionRange(range: FileMentionRange) {
    hapticSelection();
    const draft = nativeDraftRef.current;
    const removeEnd = draft[range.end] === " " ? range.end + 1 : range.end;
    const nextDraft = `${draft.slice(0, range.start)}${draft.slice(removeEnd)}`;
    const removedLength = removeEnd - range.start;
    const nextRanges = fileMentionRangesRef.current.reduce<FileMentionRange[]>(
      (ranges, candidate) => {
        const shouldRemove =
          candidate.start === range.start &&
          candidate.end === range.end &&
          candidate.file.path === range.file.path;
        if (shouldRemove) {
          return ranges;
        }
        if (candidate.start < removeEnd) {
          ranges.push(candidate);
          return ranges;
        }
        ranges.push({
          ...candidate,
          end: candidate.end - removedLength,
          start: candidate.start - removedLength,
        });
        return ranges;
      },
      [],
    );
    nativeDraftRef.current = nextDraft;
    nativeMarkdownRef.current = markdownFromDraftWithMentions(
      nextDraft,
      skillMentionRangesRef.current,
      nextRanges,
    );
    fileMentionRangesRef.current = nextRanges;
    setComposerDraft(nativeMarkdownRef.current, composerThreadId);
    ignoreNextProgrammaticMarkdownChange(nativeMarkdownRef.current);
    inputRef.current?.setValue(nativeMarkdownRef.current);
    requestAnimationFrame(() => {
      setInputSelection({ end: range.start, start: range.start });
      inputRef.current?.setSelection(range.start, range.start);
    });
  }

  function syncFileMentionsFromMarkdown(markdown: string) {
    const ranges = fileMentionsFromMarkdown(markdown);
    if (ranges.length < fileMentionRangesRef.current.length) {
      return;
    }
    fileMentionRangesRef.current = ranges;
  }

  function syncSkillMentionsFromMarkdown(markdown: string, extraSkills: AgentSkill[] = []) {
    const mentions = skillMentionsFromMarkdown(markdown, [
      ...selectedSkills,
      ...skills,
      ...extraSkills,
    ]);
    if (mentions.ranges.length < skillMentionRangesRef.current.length) {
      return;
    }
    skillMentionRangesRef.current = mentions.ranges;
    const nextSkills = mentions.skills;
    if (sameSkillSelection(selectedSkills, nextSkills)) {
      return;
    }
    setComposerSkills(nextSkills, composerThreadId);
  }

  function ignoreNextProgrammaticMarkdownChange(markdown: string) {
    ignoredMarkdownChangeRef.current = markdown;
    if (ignoredMarkdownChangeTimeoutRef.current) {
      clearTimeout(ignoredMarkdownChangeTimeoutRef.current);
    }
    ignoredMarkdownChangeTimeoutRef.current = setTimeout(() => {
      if (ignoredMarkdownChangeRef.current === markdown) {
        ignoredMarkdownChangeRef.current = undefined;
      }
      ignoredMarkdownChangeTimeoutRef.current = undefined;
    }, 250);
  }

  async function currentInputMarkdown() {
    const fallbackMarkdown = nativeMarkdownRef.current || value;
    try {
      const markdown = await inputRef.current?.getMarkdown();
      if (!markdown) {
        return fallbackMarkdown;
      }
      return richerSkillMarkdown(markdown, fallbackMarkdown, [...skills, ...selectedSkills]);
    } catch {
      return fallbackMarkdown;
    }
  }

  function hydrateMentionRefsFromMarkdown(markdown: string, extraSkills: AgentSkill[] = []) {
    const availableSkills = [...selectedSkills, ...skills, ...extraSkills];
    const mentions = skillMentionsFromMarkdown(markdown, availableSkills);
    nativeMarkdownRef.current = markdown;
    nativeDraftRef.current = markdownToPlainText(markdown);
    skillMentionRangesRef.current = mentions.ranges;
    if (!sameSkillSelection(selectedSkills, mentions.skills) && mentions.skills.length > 0) {
      setComposerSkills(mentions.skills, composerThreadId);
    }
  }

  if (pendingInputRequest) {
    return (
      <View style={styles.composerStack}>
        <InputRequestPanel
          answerDraft={inputRequestAnswerDraft}
          questionIndex={inputRequestQuestionIndex}
          request={pendingInputRequest}
          freeformSelected={isInputRequestFreeformSelected}
          selectedOption={selectedInputOption}
          onAnswerDraftChange={(draft) => {
            dispatchPanelDraft({
              type: "set-input-answer",
              requestId: pendingInputRequest.id,
              value: draft,
            });
          }}
          onFreeformSelect={() => {
            dispatchPanelDraft({
              type: "select-input-freeform",
              requestId: pendingInputRequest.id,
            });
          }}
          onIgnore={() => {
            hapticSelection();
            onIgnoreInputRequest?.(pendingInputRequest);
          }}
          onOptionSelect={(option) => {
            hapticSelection();
            dispatchPanelDraft({
              type: "select-input-option",
              option,
              requestId: pendingInputRequest.id,
            });
          }}
          onSubmit={submitInputRequestAnswer}
        />
      </View>
    );
  }

  if (shouldShowPlanConfirmation) {
    return (
      <View style={styles.composerStack}>
        <PlanDecisionPanel
          contextDraft={planContextDraft}
          selectedDecision={planDecision}
          onDismiss={() => {
            hapticSelection();
            setDismissedPlanConfirmationId(planConfirmationId);
          }}
          onContextDraftChange={(value) =>
            dispatchPanelDraft({
              type: "set-plan-context",
              confirmationId: planConfirmationId,
              value,
            })
          }
          onSelectDecision={(value) =>
            dispatchPanelDraft({
              type: "set-plan-decision",
              confirmationId: planConfirmationId,
              value,
            })
          }
          onSubmit={submitPlanDecision}
        />
      </View>
    );
  }

  return (
    <View style={styles.composerStack}>
      {shouldShowFileSuggestions ? (
        <FileSuggestionPanel
          files={visibleFiles}
          isLoading={fileSuggestionsQuery.isLoading || fileSuggestionsQuery.isFetching}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
          onSelectFile={selectFileMention}
        />
      ) : shouldShowSkillSuggestions ? (
        <SkillSuggestionPanel
          loadState={skillsLoadState}
          skills={visibleSkills}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
          onSelectSkill={selectSkill}
        />
      ) : (
        <ComposerTopAccessoryPanel
          goal={goal}
          queuedPrompts={queuedPrompts}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
          onHeightChange={onQueuedPromptPanelHeightChange}
          onClearGoal={onClearGoal}
          onSaveGoal={onSaveGoal}
          onToggleGoalPause={onToggleGoalPause}
          onRemoveQueuedPrompt={onRemoveQueuedPrompt}
          onRestoreQueuedPrompt={onRestoreQueuedPrompt}
          onSteerQueuedPrompt={onSteerQueuedPrompt}
        />
      )}
      <Animated.View
        entering={FadeInDown.duration(180)}
        nativeID={nativeID}
        style={[
          styles.container,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: "rgba(255, 255, 255, 0.1)",
          },
        ]}
      >
        <EnrichedMarkdownTextInput
          autoCapitalize="sentences"
          cursorColor={theme.text}
          defaultValue={value}
          editable={isInputEditable}
          markdownStyle={inputMarkdownStyle}
          onBlur={() => {
            isInputFocusedRef.current = false;
          }}
          onChangeMarkdown={handleInputMarkdownChange}
          onChangeSelection={handleInputSelectionChange}
          onChangeText={handleInputTextChange}
          onFocus={() => {
            isInputFocusedRef.current = true;
            lastInputFocusAtRef.current = Date.now();
          }}
          ref={inputRef}
          placeholder={
            !isInputEditable
              ? (disabledPlaceholder ?? "Connect to the Codex Relay server first")
              : isPlanMode
                ? PLAN_COMPOSER_PLACEHOLDER
                : DEFAULT_COMPOSER_PLACEHOLDER
          }
          placeholderTextColor={theme.textSecondary}
          scrollEnabled
          selectionColor="rgba(142, 199, 255, 0.34)"
          style={inputStyle}
        />
        {isPlanMode ? (
          <Pressable
            accessibilityLabel="Plan mode is on"
            accessibilityRole="button"
            accessibilityHint="Turns off Plan mode"
            hitSlop={6}
            onPress={togglePlanMode}
            style={({ pressed }) => [styles.planModeChip, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.planModeChipText}>
              Plan mode
            </Text>
          </Pressable>
        ) : null}
        <AttachmentRail
          attachments={attachments}
          composerThreadId={composerThreadId}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
        />
        <View style={styles.actionRow}>
          <View style={styles.leadingActions}>
            <Button
              accessibilityLabel="Open add menu"
              onPress={openAddSheet}
              disabled={disabled || isAttachBusy}
              size="icon"
              variant="ghost"
              className="rounded-full size-8"
              style={styles.iconButton}
            >
              <Icon name="newThread" size={20} tintColor={theme.text} />
            </Button>
            {footer ? <View style={styles.footerRow}>{footer}</View> : null}
          </View>
          <ContextUsageRing usage={contextWindowUsage} onPress={onRefreshUsageStatus} />
          {showSendButton ? (
            <Button
              accessibilityLabel={actionLabel}
              onPress={handleSendPress}
              disabled={!canSend}
              size="icon"
              variant="default"
              className="rounded-full size-9"
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.sendButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Icon name="send" size={20} tintColor={canSend ? "#0D0F13" : theme.textSecondary} />
            </Button>
          ) : null}

          {canStop ? (
            <Button
              accessibilityLabel="Stop"
              onPress={onCancel}
              disabled={disabled}
              size="icon"
              variant="default"
              className="rounded-full size-9"
              style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
            >
              <Icon name="stop" size={14} tintColor="#0D0F13" fill="#0D0F13" />
            </Button>
          ) : null}
        </View>
      </Animated.View>
      <AppBottomSheet title="Add context" onClose={closeAddSheet} visible={isAddSheetOpen}>
        <SheetActionRow
          accessibilityLabel="Add photos from library"
          icon="attach"
          title="Photos"
          subtitle={isAttachBusy ? "Opening photo library" : "Choose images from your library"}
          disabled={isAttachBusy}
          onPress={attachFromSheet}
        />
        <SheetActionRow
          accessibilityLabel={isPlanMode ? "Turn off Plan mode" : "Turn on Plan mode"}
          icon="controls"
          title="Plan mode"
          subtitle={isPlanMode ? "Plan first, then wait" : "Ask Codex to plan before editing"}
          selected={isPlanMode}
          onPress={togglePlanMode}
        />
        <View style={styles.sheetSection}>
          <Text style={[styles.sheetSectionTitle, { color: theme.textSecondary }]}>
            Usage limits
          </Text>
          {rateLimitRows.length > 0 ? (
            rateLimitRows.map((row) => (
              <View key={row.id} style={styles.limitRow}>
                <View style={styles.limitCopy}>
                  <Text numberOfLines={1} style={[styles.limitTitle, { color: theme.text }]}>
                    {row.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.limitSubtitle, { color: theme.textSecondary }]}
                  >
                    {formatRateLimitRemaining(row.window)} left
                  </Text>
                </View>
                <Text style={[styles.limitValue, { color: theme.text }]}>
                  {row.window.remainingPercent}%
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.limitRow}>
              <View style={styles.limitCopy}>
                <Text style={[styles.limitTitle, { color: theme.text }]}>Rate limits</Text>
                <Text style={[styles.limitSubtitle, { color: theme.textSecondary }]}>
                  Unavailable from this runtime
                </Text>
              </View>
            </View>
          )}
        </View>
      </AppBottomSheet>
    </View>
  );
});

async function dismissKeyboardForSheet() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      KeyboardController.dismiss().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, ADD_SHEET_KEYBOARD_DISMISS_FALLBACK_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

const SkillSuggestionPanel = memo(function SkillSuggestionPanel({
  loadState,
  onSelectSkill,
  skills,
  textColor,
  textSecondaryColor,
}: {
  loadState: "idle" | "loading" | "loaded" | "failed";
  onSelectSkill: (skill: AgentSkill) => void;
  skills: AgentSkill[];
  textColor: string;
  textSecondaryColor: string;
}) {
  const renderSkill = useCallback(
    ({ item }: LegendListRenderItemProps<AgentSkill>) => (
      <SkillSuggestionRow
        onSelectSkill={onSelectSkill}
        skill={item}
        textColor={textColor}
        textSecondaryColor={textSecondaryColor}
      />
    ),
    [onSelectSkill, textColor, textSecondaryColor],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      layout={LinearTransition.duration(140)}
      style={[
        styles.skillPanel,
        {
          backgroundColor: "rgba(28, 28, 30, 0.98)",
          borderColor: "rgba(255, 255, 255, 0.14)",
        },
      ]}
    >
      {skills.length > 0 ? (
        <LegendList
          contentContainerStyle={styles.skillListContent}
          data={skills}
          estimatedItemSize={SUGGESTION_ROW_ESTIMATED_SIZE}
          getFixedItemSize={getSuggestionRowSize}
          keyExtractor={skillSuggestionKeyExtractor}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          recycleItems={false}
          renderItem={renderSkill}
          showsVerticalScrollIndicator
          style={[styles.skillList, { height: suggestionListHeight(skills.length) }]}
        />
      ) : (
        <View style={styles.skillEmptyRow}>
          <Icon
            name={loadState === "failed" ? "warning" : "model"}
            size={14}
            tintColor={textSecondaryColor}
          />
          <Text style={[styles.skillEmptyText, { color: textSecondaryColor }]}>
            {loadState === "failed" ? "Skills unavailable" : "No matching skills"}
          </Text>
        </View>
      )}
    </Animated.View>
  );
});

const SkillSuggestionRow = memo(function SkillSuggestionRow({
  onSelectSkill,
  skill,
  textColor,
  textSecondaryColor,
}: {
  onSelectSkill: (skill: AgentSkill) => void;
  skill: AgentSkill;
  textColor: string;
  textSecondaryColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Insert ${skill.displayName} skill`}
      onPress={() => onSelectSkill(skill)}
      style={({ pressed }) => [styles.skillRow, pressed && styles.skillRowPressed]}
    >
      <View style={styles.skillIcon}>
        <Icon name="model" size={14} tintColor={textSecondaryColor} />
      </View>
      <View style={styles.skillCopy}>
        <View style={styles.skillTitleRow}>
          <Text numberOfLines={1} style={[styles.skillTitle, { color: textColor }]}>
            {skill.displayName}
          </Text>
          <Text numberOfLines={1} style={[styles.skillSource, { color: textSecondaryColor }]}>
            {skill.sourceLabel}
          </Text>
        </View>
        {skill.description ? (
          <Text numberOfLines={1} style={[styles.skillDescription, { color: textSecondaryColor }]}>
            {skill.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const FileSuggestionPanel = memo(function FileSuggestionPanel({
  files,
  isLoading,
  onSelectFile,
  textColor,
  textSecondaryColor,
}: {
  files: WorkspaceFileMention[];
  isLoading: boolean;
  onSelectFile: (file: WorkspaceFileMention) => void;
  textColor: string;
  textSecondaryColor: string;
}) {
  const renderFile = useCallback(
    ({ item }: LegendListRenderItemProps<WorkspaceFileMention>) => (
      <FileSuggestionRow
        file={item}
        onSelectFile={onSelectFile}
        textColor={textColor}
        textSecondaryColor={textSecondaryColor}
      />
    ),
    [onSelectFile, textColor, textSecondaryColor],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      layout={LinearTransition.duration(140)}
      style={[
        styles.skillPanel,
        {
          backgroundColor: "rgba(28, 28, 30, 0.98)",
          borderColor: "rgba(255, 255, 255, 0.14)",
        },
      ]}
    >
      {files.length > 0 ? (
        <LegendList
          contentContainerStyle={styles.skillListContent}
          data={files}
          estimatedItemSize={SUGGESTION_ROW_ESTIMATED_SIZE}
          getFixedItemSize={getSuggestionRowSize}
          keyExtractor={fileSuggestionKeyExtractor}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          recycleItems={false}
          renderItem={renderFile}
          showsVerticalScrollIndicator
          style={[styles.skillList, { height: suggestionListHeight(files.length) }]}
        />
      ) : (
        <View style={styles.skillEmptyRow}>
          <Icon name={isLoading ? "running" : "search"} size={14} tintColor={textSecondaryColor} />
          <Text style={[styles.skillEmptyText, { color: textSecondaryColor }]}>
            {isLoading ? "Searching files" : "No matching files"}
          </Text>
        </View>
      )}
    </Animated.View>
  );
});

const FileSuggestionRow = memo(function FileSuggestionRow({
  file,
  onSelectFile,
  textColor,
  textSecondaryColor,
}: {
  file: WorkspaceFileMention;
  onSelectFile: (file: WorkspaceFileMention) => void;
  textColor: string;
  textSecondaryColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Insert ${file.path}`}
      onPress={() => onSelectFile(file)}
      style={({ pressed }) => [styles.skillRow, pressed && styles.skillRowPressed]}
    >
      <View style={styles.skillIcon}>
        <Icon
          name={file.kind === "directory" ? "folder" : "fileDiff"}
          size={14}
          tintColor={textSecondaryColor}
        />
      </View>
      <View style={styles.skillCopy}>
        <View style={styles.skillTitleRow}>
          <Text numberOfLines={1} style={[styles.skillTitle, { color: textColor }]}>
            {file.name}
          </Text>
          <Text numberOfLines={1} style={[styles.skillSource, { color: textSecondaryColor }]}>
            {file.directory}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

function getSuggestionRowSize() {
  return SUGGESTION_ROW_ESTIMATED_SIZE;
}

function suggestionListHeight(count: number) {
  const rowHeight = count * SUGGESTION_ROW_ESTIMATED_SIZE;
  const gapHeight = Math.max(0, count - 1) * SUGGESTION_LIST_GAP;
  return Math.min(SUGGESTION_LIST_MAX_HEIGHT, rowHeight + gapHeight);
}

function skillSuggestionKeyExtractor(skill: AgentSkill) {
  return skill.id;
}

function fileSuggestionKeyExtractor(file: WorkspaceFileMention) {
  return `${file.kind}:${file.path}`;
}

const ComposerTopAccessoryPanel = memo(function ComposerTopAccessoryPanel({
  goal,
  onHeightChange,
  onClearGoal,
  onSaveGoal,
  onToggleGoalPause,
  onRemoveQueuedPrompt,
  onRestoreQueuedPrompt,
  onSteerQueuedPrompt,
  queuedPrompts,
  textColor,
  textSecondaryColor,
}: {
  goal?: ThreadGoal | null;
  onHeightChange?: (height: number) => void;
  onClearGoal?: () => void;
  onSaveGoal?: (objective: string) => void;
  onToggleGoalPause?: () => void;
  onRemoveQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onRestoreQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  onSteerQueuedPrompt?: (item: QueuedComposerPrompt) => void;
  queuedPrompts: QueuedComposerPrompt[];
  textColor: string;
  textSecondaryColor: string;
}) {
  const [isEditingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goal?.objective ?? "");
  const trimmedGoalDraft = goalDraft.trim();
  const canSaveGoalDraft = Boolean(trimmedGoalDraft && trimmedGoalDraft !== goal?.objective);
  const canToggleGoalPause = goal ? isGoalPauseToggleVisible(goal.status) : false;

  useEffect(() => {
    if (!isEditingGoal) {
      setGoalDraft(goal?.objective ?? "");
    }
  }, [goal?.objective, isEditingGoal]);

  useEffect(() => {
    if (!goal) {
      setEditingGoal(false);
    }
  }, [goal]);

  useEffect(() => {
    if (!goal && queuedPrompts.length === 0) {
      onHeightChange?.(0);
    }
  }, [goal, onHeightChange, queuedPrompts.length]);

  function handleLayout(event: LayoutChangeEvent) {
    onHeightChange?.(event.nativeEvent.layout.height);
  }

  if (!goal && queuedPrompts.length === 0) {
    return null;
  }

  function saveGoalDraft() {
    if (!trimmedGoalDraft || trimmedGoalDraft === goal?.objective) {
      closeGoalEditor();
      return;
    }
    onSaveGoal?.(trimmedGoalDraft);
    setEditingGoal(false);
  }

  function closeGoalEditor() {
    setEditingGoal(false);
    setGoalDraft(goal?.objective ?? "");
  }

  return (
    <>
      <Animated.View
        entering={FadeIn.duration(120)}
        layout={LinearTransition.duration(140)}
        onLayout={handleLayout}
        style={[
          styles.queuePanel,
          {
            backgroundColor: "rgba(28, 28, 30, 0.98)",
            borderColor: "rgba(255, 255, 255, 0.14)",
          },
        ]}
      >
        {queuedPrompts.map((item, index) => {
          const itemSkills = item.skills ?? [];
          return (
            <View key={item.id} style={styles.queueRow}>
              <View style={styles.queuePromptGroup}>
                <View style={styles.queuePromptIconSlot}>
                  <Icon name="chevronRight" size={12} tintColor={textSecondaryColor} />
                </View>
                <View style={styles.queuePromptBody}>
                  <View style={styles.queuePromptMarkdown}>
                    <PromptMarkdownText
                      color={textColor}
                      fontSize={12}
                      lineHeight={16}
                      markdownStyle={queuePromptMarkdownStyle}
                      prompt={item.prompt}
                      skills={itemSkills}
                    />
                  </View>
                </View>
              </View>
              <View style={styles.queueActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Steer queued prompt ${index + 1}`}
                  hitSlop={6}
                  onPress={() => {
                    hapticMediumImpact();
                    onSteerQueuedPrompt?.(item);
                  }}
                  style={styles.queueSteerButton}
                >
                  {({ pressed }) => (
                    <View style={[styles.queueSteerPill, pressed && styles.queueSteerPillPressed]}>
                      <Icon name="sendToLine" size={12} tintColor={textColor} />
                      <Text
                        numberOfLines={1}
                        style={[styles.queueActionText, { color: textColor }]}
                      >
                        Steering
                      </Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Restore queued prompt ${index + 1} to composer`}
                  hitSlop={6}
                  onPress={() => {
                    hapticSelection();
                    onRestoreQueuedPrompt?.(item);
                  }}
                  style={styles.queueIconButton}
                >
                  {({ pressed }) => (
                    <View
                      style={[styles.queueIconCircle, pressed && styles.queueIconCirclePressed]}
                    >
                      <Icon name="expand" size={13} tintColor={textColor} />
                    </View>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove queued prompt ${index + 1}`}
                  hitSlop={6}
                  onPress={() => {
                    hapticWarning();
                    onRemoveQueuedPrompt?.(item);
                  }}
                  style={styles.queueIconButton}
                >
                  {({ pressed }) => (
                    <View
                      style={[styles.queueIconCircle, pressed && styles.queueIconCirclePressed]}
                    >
                      <Icon name="trash" size={13} tintColor={textColor} />
                    </View>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
        {goal ? (
          <View style={styles.goalRow}>
            <View style={styles.goalPromptGroup}>
              <View style={styles.goalStatusIconSlot}>
                <Icon
                  name={goalStatusIconName(goal.status)}
                  size={16}
                  tintColor={goalStatusTintColor(goal.status)}
                />
              </View>
              <View style={styles.goalPromptBody}>
                <View style={styles.goalTitleRow}>
                  <Text numberOfLines={1} style={[styles.goalLabel, { color: textSecondaryColor }]}>
                    Goal
                  </Text>
                  <Text numberOfLines={1} style={[styles.goalMeta, { color: textSecondaryColor }]}>
                    {goalStatusMeta(goal)}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[styles.goalObjective, { color: textColor }]}>
                  {goal.objective}
                </Text>
              </View>
            </View>
            <View style={[styles.goalActions, !canToggleGoalPause && styles.goalActionsCompact]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit goal"
                hitSlop={6}
                onPress={() => {
                  hapticSelection();
                  setGoalDraft(goal.objective);
                  setEditingGoal(true);
                }}
                style={styles.queueIconButton}
              >
                {({ pressed }) => (
                  <View style={[styles.queueIconCircle, pressed && styles.queueIconCirclePressed]}>
                    <Icon name="newChat" size={13} tintColor={textColor} />
                  </View>
                )}
              </Pressable>
              {canToggleGoalPause ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={goal.status === "paused" ? "Resume goal" : "Pause goal"}
                  hitSlop={6}
                  onPress={() => {
                    hapticMediumImpact();
                    onToggleGoalPause?.();
                  }}
                  style={styles.queueIconButton}
                >
                  {({ pressed }) => (
                    <View
                      style={[styles.queueIconCircle, pressed && styles.queueIconCirclePressed]}
                    >
                      <Icon
                        name={goal.status === "paused" ? "sendToLine" : "stop"}
                        size={13}
                        tintColor={textColor}
                      />
                    </View>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear goal"
                hitSlop={6}
                onPress={() => {
                  hapticWarning();
                  onClearGoal?.();
                }}
                style={styles.queueIconButton}
              >
                {({ pressed }) => (
                  <View style={[styles.queueIconCircle, pressed && styles.queueIconCirclePressed]}>
                    <Icon name="trash" size={13} tintColor={textColor} />
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </Animated.View>
      <AppBottomSheet
        expandedSnapPercent={52}
        title="Edit goal"
        onClose={closeGoalEditor}
        scrollable={false}
        visible={Boolean(goal && isEditingGoal)}
      >
        <View style={styles.goalEditSheet}>
          <AppBottomSheetTextInput
            autoCapitalize="sentences"
            autoCorrect
            cursorColor={textColor}
            multiline
            onChangeText={setGoalDraft}
            onSubmitEditing={saveGoalDraft}
            placeholder="Goal objective"
            placeholderTextColor={textSecondaryColor}
            returnKeyType="done"
            selectionColor="rgba(124, 199, 255, 0.28)"
            style={[
              styles.goalEditSheetInput,
              {
                borderColor: "rgba(255, 255, 255, 0.14)",
                color: textColor,
              },
            ]}
            textAlignVertical="top"
            value={goalDraft}
          />
          <View style={styles.goalEditSheetActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel goal edit"
              onPress={closeGoalEditor}
              style={({ pressed }) => [styles.planDismissButton, pressed && styles.pressed]}
            >
              <Text style={[styles.goalEditCancelText, { color: textSecondaryColor }]}>Cancel</Text>
            </Pressable>
            <Button
              accessibilityRole="button"
              accessibilityLabel="Save goal"
              disabled={!canSaveGoalDraft}
              onPress={saveGoalDraft}
              style={[
                styles.planSubmitButton,
                !canSaveGoalDraft && styles.goalEditSaveButtonDisabled,
              ]}
            >
              <Text style={styles.planSubmitText}>Save</Text>
            </Button>
          </View>
        </View>
      </AppBottomSheet>
    </>
  );
});

const queuePromptMarkdownStyle = {
  link: {
    color: "#7CC7FF",
    fontFamily: Fonts.sansSemiBold,
    underline: false,
  },
  paragraph: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 0,
    marginTop: 0,
  },
} satisfies MarkdownStyle;

function PlanDecisionPanel({
  contextDraft,
  onContextDraftChange,
  onDismiss,
  onSelectDecision,
  onSubmit,
  selectedDecision,
}: {
  contextDraft: string;
  onContextDraftChange: (draft: string) => void;
  onDismiss: () => void;
  onSelectDecision: (decision: "context" | "implement") => void;
  onSubmit: () => void;
  selectedDecision: "context" | "implement";
}) {
  const theme = useTheme();
  const contextInputRef = useRef<TextInputInstance | null>(null);
  const canSubmit = selectedDecision === "implement" || Boolean(contextDraft.trim());

  function selectContextDecision() {
    if (selectedDecision !== "context") {
      hapticSelection();
    }
    onSelectDecision("context");
  }

  function selectImplementDecision() {
    contextInputRef.current?.blur();
    onSelectDecision("implement");
  }

  useEffect(() => {
    if (selectedDecision !== "context") {
      return;
    }

    requestAnimationFrame(() => {
      contextInputRef.current?.focus();
    });
  }, [selectedDecision]);

  function focusPlanContextInput() {
    selectContextDecision();
    requestAnimationFrame(() => {
      contextInputRef.current?.focus();
    });
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={[
        styles.planDecisionPanel,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: "rgba(255, 255, 255, 0.14)",
        },
      ]}
    >
      <Text style={[styles.planDecisionTitle, { color: theme.text }]}>
        Do you want to implement this plan?
      </Text>
      <View style={styles.planDecisionRows}>
        <PlanDecisionRow
          index={1}
          label="Yes, implement this plan"
          selected={selectedDecision === "implement"}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
          onPress={selectImplementDecision}
        />
        <PlanContextInputRow
          ref={contextInputRef}
          index={2}
          value={contextDraft}
          selected={selectedDecision === "context"}
          textColor={theme.text}
          textSecondaryColor={theme.textSecondary}
          onChangeText={onContextDraftChange}
          onFocus={selectContextDecision}
          onPress={focusPlanContextInput}
        />
      </View>
      <View style={styles.planDecisionActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss plan decision"
          onPress={onDismiss}
          style={({ pressed }) => [styles.planDismissButton, pressed && styles.pressed]}
        >
          <Text style={[styles.planDismissText, { color: theme.textSecondary }]}>Ignore</Text>
        </Pressable>
        <Button
          accessibilityLabel={
            selectedDecision === "implement" ? "Implement plan" : "Add context before implementing"
          }
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={onSubmit}
          size="default"
          variant="default"
          style={styles.planSubmitButton}
        >
          <Text style={styles.planSubmitText}>Submit ↩</Text>
        </Button>
      </View>
    </Animated.View>
  );
}

function InputRequestPanel({
  answerDraft,
  freeformSelected,
  onAnswerDraftChange,
  onFreeformSelect,
  onIgnore,
  onOptionSelect,
  onSubmit,
  questionIndex,
  request,
  selectedOption,
}: {
  answerDraft: string;
  freeformSelected: boolean;
  onAnswerDraftChange: (draft: string) => void;
  onFreeformSelect: () => void;
  onIgnore: () => void;
  onOptionSelect: (option: string) => void;
  onSubmit: () => void;
  questionIndex: number;
  request: PendingInputRequest;
  selectedOption?: string;
}) {
  const theme = useTheme();
  const answerInputRef = useRef<TextInputInstance | null>(null);
  const question = request.questions[questionIndex];
  const options = question?.options ?? [];
  const canSubmit = !question || Boolean(selectedOption || answerDraft.trim());

  useEffect(() => {
    if (options.length > 0) {
      return;
    }
    requestAnimationFrame(() => {
      answerInputRef.current?.focus();
    });
  }, [options.length, questionIndex, request.id]);

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={[
        styles.planDecisionPanel,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: "rgba(255, 255, 255, 0.14)",
        },
      ]}
    >
      <View style={styles.inputRequestTitleRow}>
        <Text style={[styles.planDecisionTitle, { color: theme.text }]}>
          {question?.header ?? "Codex needs input"}
        </Text>
        {request.questions.length > 1 ? (
          <Text style={[styles.inputRequestCount, { color: theme.textSecondary }]}>
            {questionIndex + 1}/{request.questions.length}
          </Text>
        ) : null}
      </View>
      {question ? (
        <>
          <Text style={[styles.inputRequestQuestion, { color: theme.textSecondary }]}>
            {question.question}
          </Text>
          <View style={styles.planDecisionRows}>
            {options.map((option, index) => (
              <InputOptionRow
                key={option.label}
                description={option.description}
                index={index + 1}
                label={option.label}
                selected={selectedOption === option.label}
                textColor={theme.text}
                textSecondaryColor={theme.textSecondary}
                onPress={() => onOptionSelect(option.label)}
              />
            ))}
            <PlanContextInputRow
              ref={answerInputRef}
              index={options.length + 1}
              value={answerDraft}
              selected={freeformSelected}
              textColor={theme.text}
              textSecondaryColor={theme.textSecondary}
              onChangeText={onAnswerDraftChange}
              onFocus={() => {
                onFreeformSelect();
              }}
              onPress={() => {
                onFreeformSelect();
                onAnswerDraftChange(answerDraft);
                requestAnimationFrame(() => answerInputRef.current?.focus());
              }}
              onSelect={onFreeformSelect}
            />
          </View>
        </>
      ) : (
        <Text style={[styles.inputRequestQuestion, { color: theme.textSecondary }]}>
          Codex requested input, but no question was provided.
        </Text>
      )}
      <View style={styles.planDecisionActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ignore input request"
          onPress={onIgnore}
          style={({ pressed }) => [styles.planDismissButton, pressed && styles.pressed]}
        >
          <Text style={[styles.planDismissText, { color: theme.textSecondary }]}>Ignore</Text>
        </Pressable>
        <Button
          accessibilityLabel="Submit input request answer"
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={onSubmit}
          size="default"
          variant="default"
          style={styles.planSubmitButton}
        >
          <Text style={styles.planSubmitText}>Submit ↩</Text>
        </Button>
      </View>
    </Animated.View>
  );
}

function InputOptionRow({
  description,
  index,
  label,
  onPress,
  selected,
  textColor,
  textSecondaryColor,
}: {
  description?: string;
  index: number;
  label: string;
  onPress: () => void;
  selected: boolean;
  textColor: string;
  textSecondaryColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.planDecisionRow,
        selected && styles.planDecisionRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.planDecisionIndex, { color: textSecondaryColor }]}>{index}.</Text>
      <View style={styles.inputOptionCopy}>
        <Text
          numberOfLines={1}
          style={[styles.planDecisionLabel, { color: selected ? textColor : textSecondaryColor }]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            numberOfLines={1}
            style={[styles.inputOptionDescription, { color: textSecondaryColor }]}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const PlanContextInputRow = memo(function PlanContextInputRow({
  index,
  onChangeText,
  onFocus,
  onPress,
  onSelect,
  ref,
  selected,
  textColor,
  textSecondaryColor,
  value,
}: {
  index: number;
  onChangeText: (draft: string) => void;
  onFocus: () => void;
  onPress: () => void;
  onSelect?: () => void;
  ref?: Ref<TextInputInstance>;
  selected: boolean;
  textColor: string;
  textSecondaryColor: string;
  value: string;
}) {
  return (
    <Pressable
      accessibilityRole="none"
      onPress={() => {
        onSelect?.();
        onPress();
      }}
      style={({ pressed }) => [
        styles.planDecisionRow,
        styles.planContextInputRow,
        selected && styles.planDecisionRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.planDecisionIndex, { color: textSecondaryColor }]}>{index}.</Text>
      <TextInput
        accessibilityLabel="Additional context for Codex"
        allowFontScaling={false}
        maxFontSizeMultiplier={1}
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          onSelect?.();
          onFocus();
        }}
        onPressIn={() => {
          onSelect?.();
          onPress();
        }}
        placeholder="Give Codex more context"
        placeholderTextColor={textSecondaryColor}
        multiline
        returnKeyType="default"
        style={[styles.planContextInput, { color: textColor }]}
      />
    </Pressable>
  );
});

function PlanDecisionRow({
  index,
  label,
  onPress,
  selected,
  textColor,
  textSecondaryColor,
}: {
  index: number;
  label: string;
  onPress: () => void;
  selected: boolean;
  textColor: string;
  textSecondaryColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.planDecisionRow,
        selected && styles.planDecisionRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.planDecisionIndex, { color: textSecondaryColor }]}>{index}.</Text>
      <Text
        numberOfLines={2}
        style={[styles.planDecisionLabel, { color: selected ? textColor : textSecondaryColor }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const AttachmentRail = memo(function AttachmentRail({
  attachments,
  composerThreadId,
  textColor,
  textSecondaryColor,
}: {
  attachments: ComposerAttachment[];
  composerThreadId?: string;
  textColor: string;
  textSecondaryColor: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <View style={styles.attachmentRail}>
      {attachments.map((attachment, index) => (
        <View key={attachment.id} style={styles.attachmentChip}>
          <View style={styles.attachmentChipIcon}>
            <Image
              source={{ uri: attachment.uri }}
              contentFit="cover"
              style={styles.attachmentChipImage}
            />
          </View>
          <Text numberOfLines={1} style={[styles.attachmentChipLabel, { color: textColor }]}>
            {attachment.name ?? "image.png"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove image ${index + 1}`}
            hitSlop={8}
            onPress={() => {
              hapticSelection();
              removeComposerAttachment(attachment.id, composerThreadId);
            }}
            style={({ pressed }) => [styles.attachmentRemoveButton, pressed && styles.pressed]}
          >
            <Icon name="x" size={12} strokeWidth={2.4} tintColor={textSecondaryColor} />
          </Pressable>
        </View>
      ))}
    </View>
  );
});

function ContextUsageRing({
  onPress,
  usage,
}: {
  onPress?: () => Promise<void> | void;
  usage?: ContextWindowUsage;
}) {
  const theme = useTheme();
  const percent = usage ? Math.round((usage.tokensUsed / usage.tokenLimit) * 100) : undefined;
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const ringColor = clamped >= 85 ? "#F87171" : clamped >= 65 ? "#FBBF24" : "#A7F3D0";
  const size = 22;
  const strokeWidth = 2.4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(usage ? clamped / 100 : 0, {
      duration: 620,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, progress, usage]);

  const progressProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Context usage"
      accessibilityValue={{ text: usage ? `${clamped}% used` : "Usage unavailable" }}
      hitSlop={6}
      onPress={() => {
        hapticSelection();
        void onPress?.();
      }}
      style={({ pressed }) => [styles.contextButton, pressed && styles.pressed]}
    >
      <View style={styles.contextRingTrack}>
        <Svg height={size} width={size} style={styles.contextRingSvg}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={theme.backgroundSelected}
            strokeWidth={strokeWidth}
          />
          <AnimatedCircle
            animatedProps={progressProps}
            cx={size / 2}
            cy={size / 2}
            fill="none"
            originX={size / 2}
            originY={size / 2}
            r={radius}
            rotation="-90"
            stroke={usage ? ringColor : theme.textSecondary}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
            opacity={usage ? 1 : 0.42}
          />
        </Svg>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={[styles.contextPercent, { color: usage ? ringColor : theme.textSecondary }]}
        >
          {usage ? clamped : "--"}
        </Text>
      </View>
    </Pressable>
  );
}

function filterSkills(skills: AgentSkill[], query: string) {
  if (!query) {
    return skills;
  }
  return skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.displayName} ${skill.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

type SkillMentionRange = {
  end: number;
  skill: AgentSkill;
  start: number;
};

type WorkspaceFileMention = ListWorkspaceFilesResponse["files"][number];

type FileMentionRange = {
  end: number;
  file: WorkspaceFileMention;
  start: number;
};

function uniqueSkills(skills: AgentSkill[]) {
  const seen = new Set<string>();
  const unique: AgentSkill[] = [];
  for (const skill of skills) {
    if (seen.has(skill.id)) {
      continue;
    }
    seen.add(skill.id);
    unique.push(skill);
  }
  return unique;
}

function skillMentionDisplayText(skill: AgentSkill) {
  return promptSkillMentionLabel(skill);
}

function skillMentionTextCandidates(skill: AgentSkill) {
  return [
    skillMentionDisplayText(skill),
    `$${skill.displayName}`,
    skill.displayName,
    `$${skill.name}`,
    skill.name,
  ];
}

function skillMentionRangesFromDraft(draft: string, skills: AgentSkill[]) {
  const ranges: SkillMentionRange[] = [];
  const occupiedRanges: Array<{ end: number; start: number }> = [];
  for (const skill of skills) {
    const candidates = skillMentionTextCandidates(skill).sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      const start = findStandaloneToken(draft, candidate);
      if (start === -1) {
        continue;
      }
      const end = start + candidate.length;
      if (occupiedRanges.some((range) => Math.max(range.start, start) < Math.min(range.end, end))) {
        continue;
      }
      ranges.push({ end, skill, start });
      occupiedRanges.push({ end, start });
      break;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function findStandaloneToken(value: string, token: string) {
  const match = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`).exec(value);
  if (!match?.index) {
    return match ? 0 : -1;
  }
  return match.index + (match[1]?.length ?? 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextSkillMentionRanges(
  currentRanges: SkillMentionRange[],
  replacementRange: { end: number; start: number },
  replacementLength: number,
  newRange: SkillMentionRange,
) {
  const replacedLength = replacementRange.end - replacementRange.start;
  const delta = replacementLength - replacedLength;
  const shiftedRanges = currentRanges.reduce<SkillMentionRange[]>((ranges, range) => {
    if (range.skill.id === newRange.skill.id) {
      return ranges;
    }
    if (range.end > replacementRange.start && range.start < replacementRange.end) {
      return ranges;
    }
    if (range.start < replacementRange.end) {
      ranges.push(range);
      return ranges;
    }
    ranges.push({
      ...range,
      end: range.end + delta,
      start: range.start + delta,
    });
    return ranges;
  }, []);

  return [...shiftedRanges, newRange].sort((a, b) => a.start - b.start);
}

function nextSkillMentionRangesForTextChange(
  previousDraft: string,
  nextDraft: string,
  currentRanges: SkillMentionRange[],
) {
  if (currentRanges.length === 0 || previousDraft === nextDraft) {
    return currentRanges;
  }

  const edit = changedTextRange(previousDraft, nextDraft);
  const delta = edit.nextEnd - edit.previousEnd;
  return currentRanges
    .flatMap((range) => {
      if (edit.previousEnd <= range.start) {
        return [{ ...range, end: range.end + delta, start: range.start + delta }];
      }
      if (edit.previousStart >= range.end) {
        return [range];
      }
      if (
        edit.previousStart === edit.previousEnd &&
        edit.previousStart === range.start &&
        delta > 0
      ) {
        return [{ ...range, end: range.end + delta, start: range.start + delta }];
      }
      if (
        edit.previousStart === edit.previousEnd &&
        edit.previousStart === range.end &&
        delta > 0
      ) {
        return [range];
      }
      return [];
    })
    .sort((a, b) => a.start - b.start);
}

function changedTextRange(previousDraft: string, nextDraft: string) {
  let prefixLength = 0;
  while (
    prefixLength < previousDraft.length &&
    prefixLength < nextDraft.length &&
    previousDraft[prefixLength] === nextDraft[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffix = previousDraft.length;
  let nextSuffix = nextDraft.length;
  while (
    previousSuffix > prefixLength &&
    nextSuffix > prefixLength &&
    previousDraft[previousSuffix - 1] === nextDraft[nextSuffix - 1]
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  return {
    nextEnd: nextSuffix,
    nextStart: prefixLength,
    previousEnd: previousSuffix,
    previousStart: prefixLength,
  };
}

function activeSkillMentionRange(
  draft: string,
  selection: { end: number; start: number },
  query: string | undefined,
  skillRanges: SkillMentionRange[] = [],
) {
  if (query !== undefined) {
    const tokenRange = activeSkillMentionTokenRange(draft, selection, skillRanges);
    if (tokenRange) {
      return tokenRange;
    }
  }

  const cursor = selection.end;
  const beforeCursor = draft.slice(0, cursor);
  const lastTriggerIndex = beforeCursor.lastIndexOf(SKILL_MENTION_INDICATOR);
  if (lastTriggerIndex !== -1) {
    const matched = beforeCursor.slice(lastTriggerIndex);
    if (!/\s/.test(matched)) {
      return {
        end: cursor,
        start: lastTriggerIndex,
      };
    }
  }

  const currentTokenMatch = /(^|\s)\$[^\s$]*$/.exec(beforeCursor);
  if (currentTokenMatch) {
    const matched = currentTokenMatch[0];
    const leadingWhitespaceLength = matched.match(/^\s*/)?.[0].length ?? 0;
    return {
      end: cursor,
      start: cursor - matched.length + leadingWhitespaceLength,
    };
  }

  return undefined;
}

function activeSkillMentionQuery(
  draft: string,
  selection: { end: number; start: number },
  skillRanges: SkillMentionRange[],
) {
  const range = activeSkillMentionRange(draft, selection, "", skillRanges);
  if (!range) {
    return undefined;
  }
  if (
    skillRanges.some(
      (skillRange) => range.start >= skillRange.start && range.start < skillRange.end,
    )
  ) {
    return undefined;
  }
  return draft.slice(range.start + SKILL_MENTION_INDICATOR.length, range.end).toLowerCase();
}

function activeSkillMentionTokenRange(
  draft: string,
  selection: { end: number; start: number },
  skillRanges: SkillMentionRange[],
) {
  const ranges: Array<{ end: number; start: number }> = [];
  const tokenRegex = /(^|\s)(\$[^\s$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(draft))) {
    const leadingWhitespaceLength = match[1].length;
    const start = match.index + leadingWhitespaceLength;
    const end = start + match[2].length;
    if (skillRanges.some((skillRange) => start >= skillRange.start && start < skillRange.end)) {
      continue;
    }
    ranges.push({ end, start });
  }

  return (
    ranges.find((range) => selection.end >= range.start && selection.end <= range.end) ??
    ranges.at(-1)
  );
}

function activeFileMentionRange(
  draft: string,
  selection: { end: number; start: number },
  query: string | undefined,
) {
  const cursor = selection.end;
  const beforeCursor = draft.slice(0, cursor);
  const lastTriggerIndex = beforeCursor.lastIndexOf(FILE_MENTION_INDICATOR);
  if (lastTriggerIndex !== -1) {
    const matched = beforeCursor.slice(lastTriggerIndex);
    if (!/\s/.test(matched)) {
      return {
        end: cursor,
        start: lastTriggerIndex,
      };
    }
  }

  const currentTokenMatch = /(^|\s)@[^\s@]*$/.exec(beforeCursor);
  if (currentTokenMatch) {
    const matched = currentTokenMatch[0];
    const leadingWhitespaceLength = matched.match(/^\s*/)?.[0].length ?? 0;
    return {
      end: cursor,
      start: cursor - matched.length + leadingWhitespaceLength,
    };
  }

  if (query === undefined) {
    return undefined;
  }
  const queryToken = `${FILE_MENTION_INDICATOR}${query}`;
  const queryStart = draft.toLowerCase().lastIndexOf(queryToken.toLowerCase());
  if (queryStart === -1) {
    return undefined;
  }
  return {
    end: queryStart + queryToken.length,
    start: queryStart,
  };
}

function activeFileMentionQuery(draft: string, selection: { end: number; start: number }) {
  const range = activeFileMentionRange(draft, selection, "");
  if (!range) {
    return undefined;
  }
  return draft.slice(range.start + FILE_MENTION_INDICATOR.length, range.end).toLowerCase();
}

function nextFileMentionRanges(
  currentRanges: FileMentionRange[],
  replacementRange: { end: number; start: number },
  replacementLength: number,
  newRange: FileMentionRange,
) {
  const replacedLength = replacementRange.end - replacementRange.start;
  const delta = replacementLength - replacedLength;
  const shiftedRanges = currentRanges.reduce<FileMentionRange[]>((ranges, range) => {
    if (range.end > replacementRange.start && range.start < replacementRange.end) {
      return ranges;
    }
    if (range.start < replacementRange.end) {
      ranges.push(range);
      return ranges;
    }
    ranges.push({
      ...range,
      end: range.end + delta,
      start: range.start + delta,
    });
    return ranges;
  }, []);

  return [...shiftedRanges, newRange].sort((a, b) => a.start - b.start);
}

function nextFileMentionRangesForTextChange(
  previousDraft: string,
  nextDraft: string,
  currentRanges: FileMentionRange[],
) {
  if (currentRanges.length === 0 || previousDraft === nextDraft) {
    return currentRanges;
  }

  const edit = changedTextRange(previousDraft, nextDraft);
  const delta = edit.nextEnd - edit.previousEnd;
  return currentRanges
    .flatMap((range) => {
      if (edit.previousEnd <= range.start) {
        return [{ ...range, end: range.end + delta, start: range.start + delta }];
      }
      if (edit.previousStart >= range.end) {
        return [range];
      }
      if (
        edit.previousStart === edit.previousEnd &&
        edit.previousStart === range.start &&
        delta > 0
      ) {
        return [{ ...range, end: range.end + delta, start: range.start + delta }];
      }
      if (
        edit.previousStart === edit.previousEnd &&
        edit.previousStart === range.end &&
        delta > 0
      ) {
        return [range];
      }
      return [];
    })
    .sort((a, b) => a.start - b.start);
}

function markdownFromDraftWithMentions(
  draft: string,
  skillRanges: SkillMentionRange[],
  fileRanges: FileMentionRange[],
) {
  const mentionRanges = [
    ...skillRanges.map((range) => ({
      end: range.end,
      start: range.start,
      url: skillLinkUrl(range.skill),
    })),
    ...fileRanges.map((range) => ({
      end: range.end,
      start: range.start,
      url: fileMentionLinkUrl(range.file),
    })),
  ].sort((left, right) => left.start - right.start);

  let cursor = 0;
  let markdown = "";
  for (const range of mentionRanges) {
    if (range.start < cursor || range.end > draft.length) {
      continue;
    }
    const linkText = draft.slice(range.start, range.end);
    markdown += escapeMarkdownText(draft.slice(cursor, range.start));
    markdown += `[${escapeMarkdownLinkText(linkText)}](${range.url})`;
    cursor = range.end;
  }
  markdown += escapeMarkdownText(draft.slice(cursor));
  return markdown;
}

function skillLinkUrl(skill: AgentSkill) {
  return skill.path;
}

function fileMentionLinkUrl(file: WorkspaceFileMention) {
  return `file://${encodeURIComponent(file.path)}?kind=${encodeURIComponent(file.kind)}`;
}

function escapeMarkdownText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function escapeMarkdownLinkText(value: string) {
  return escapeMarkdownText(value).replaceAll("\n", " ");
}

function unescapeMarkdownText(value: string) {
  return value.replace(/\\([\\[\]])/g, "$1");
}

function fileMentionsFromMarkdown(markdown: string) {
  const ranges: FileMentionRange[] = [];
  const linkRegex = /\[((?:\\.|[^\]\\])*)\]\((file:\/\/[^)]*)\)/g;
  let linkMatch: RegExpExecArray | null;
  let markdownCursor = 0;
  let plainCursor = 0;
  while ((linkMatch = linkRegex.exec(markdown))) {
    plainCursor += markdownToPlainText(markdown.slice(markdownCursor, linkMatch.index)).length;
    const mentionText = unescapeMarkdownText(linkMatch[1]);
    const link = fileMentionLinkParts(linkMatch[2]);
    const path = link.path || mentionText.trim();
    if (!path) {
      continue;
    }
    const start = plainCursor;
    const end = start + mentionText.length;
    plainCursor = end;
    markdownCursor = linkMatch.index + linkMatch[0].length;
    ranges.push({
      end,
      file: {
        directory: dirnameFromWorkspacePath(path),
        kind: link.kind ?? "file",
        name: path.split("/").pop() ?? path,
        path,
      },
      start,
    });
  }
  return ranges;
}

function skillMentionsFromMarkdown(markdown: string, availableSkills: AgentSkill[]) {
  const nextSkills: AgentSkill[] = [];
  const ranges: SkillMentionRange[] = [];
  const skillByPath = new Map(availableSkills.map((skill) => [skill.path, skill]));
  const seenSkillIds = new Set<string>();
  const linkRegex = /\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g;
  let linkMatch: RegExpExecArray | null;
  let markdownCursor = 0;
  let plainCursor = 0;
  while ((linkMatch = linkRegex.exec(markdown))) {
    plainCursor += markdownToPlainText(markdown.slice(markdownCursor, linkMatch.index)).length;
    const mentionText = unescapeMarkdownText(linkMatch[1]);
    const label = linkMatch[1];
    const url = linkMatch[2];
    const skill = skillFromMarkdownMention(label, url, skillByPath);
    const start = plainCursor;
    const end = start + mentionText.length;
    plainCursor = end;
    markdownCursor = linkMatch.index + linkMatch[0].length;
    if (!skill || seenSkillIds.has(skill.id)) {
      continue;
    }
    seenSkillIds.add(skill.id);
    nextSkills.push(skill);
    ranges.push({ end, skill, start });
  }
  return { ranges, skills: nextSkills };
}

function skillFromMarkdownMention(
  label: string,
  url: string,
  skillByPath: Map<string, AgentSkill>,
) {
  const skill = skillByPath.get(safeDecodeMarkdownUrl(url));
  if (!skill) {
    return undefined;
  }
  return promptSkillMentionTextCandidates(skill).includes(unescapeMarkdownText(label).trim())
    ? skill
    : undefined;
}

function safeDecodeMarkdownUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function richerSkillMarkdown(
  candidateMarkdown: string,
  fallbackMarkdown: string,
  availableSkills: AgentSkill[],
) {
  const candidateMentions = skillMentionsFromMarkdown(candidateMarkdown, availableSkills);
  const fallbackMentions = skillMentionsFromMarkdown(fallbackMarkdown, availableSkills);
  if (fallbackMentions.ranges.length > candidateMentions.ranges.length) {
    return fallbackMarkdown;
  }
  if (
    fallbackMentions.ranges.length === candidateMentions.ranges.length &&
    fallbackMarkdown.length > candidateMarkdown.length &&
    fallbackMentions.ranges.length > 0
  ) {
    return fallbackMarkdown;
  }
  return candidateMarkdown;
}

function fileMentionLinkParts(url: string) {
  const result: { kind?: "directory" | "file"; path?: string } = {};
  const match = /^file:\/\/([^?]*)(?:\?(.*))?$/.exec(url);
  if (!match) {
    return result;
  }
  result.path = decodeURIComponent(match[1]);
  const params = match[2] ?? "";
  for (const part of params.split("&")) {
    const [key, value] = part.split("=");
    if (key === "kind" && (value === "directory" || value === "file")) {
      result.kind = value;
    }
  }
  return result;
}

function dirnameFromWorkspacePath(path: string) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? "" : path.slice(0, slashIndex);
}

function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, (_match, linkText: string) =>
      unescapeMarkdownText(linkText),
    )
    .replace(/\\([\\[\]])/g, "$1");
}

function formatGoalElapsed(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    days > 0 ? `${days}d` : undefined,
    hours > 0 || days > 0 ? `${hours}h` : undefined,
    minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : undefined,
    `${seconds}s`,
  ];
  return parts.filter(Boolean).join(" ");
}

function goalStatusMeta(goal: ThreadGoal) {
  switch (goal.status) {
    case "active":
      return formatGoalElapsed(goal.timeUsedSeconds);
    case "paused":
      return "Paused";
    case "complete":
      return `Complete ${formatGoalElapsed(goal.timeUsedSeconds)}`;
    case "blocked":
      return "Blocked";
    case "usageLimited":
      return "Usage limited";
    case "budgetLimited":
      return "Budget limited";
    default:
      return assertNever(goal.status);
  }
}

function goalStatusIconName(status: ThreadGoal["status"]): AppIconName {
  switch (status) {
    case "active":
    case "complete":
      return "goal";
    case "paused":
      return "stop";
    case "blocked":
    case "usageLimited":
    case "budgetLimited":
      return "warning";
    default:
      return assertNever(status);
  }
}

function goalStatusTintColor(status: ThreadGoal["status"]) {
  switch (status) {
    case "active":
    case "complete":
      return "#8EE6B1";
    case "paused":
      return "#F8C66A";
    case "blocked":
    case "usageLimited":
    case "budgetLimited":
      return "#FFB36B";
    default:
      return assertNever(status);
  }
}

function isGoalPauseToggleVisible(status: ThreadGoal["status"]) {
  return status === "active" || status === "paused";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

function sameSkillSelection(left: AgentSkill[], right: AgentSkill[]) {
  return (
    left.length === right.length && left.every((skill, index) => skill.id === right[index]?.id)
  );
}

const styles = StyleSheet.create({
  composerStack: {
    position: "relative",
  },
  container: {
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderRadius: 18,
    gap: 5,
    marginHorizontal: 18,
    marginBottom: 6,
    marginTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  planDecisionPanel: {
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    marginBottom: 6,
    marginHorizontal: 18,
    marginTop: 6,
    paddingBottom: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  planDecisionTitle: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  inputRequestTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  inputRequestCount: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 15,
  },
  inputRequestQuestion: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    lineHeight: 17,
    maxHeight: 40,
  },
  planDecisionRows: {
    gap: 6,
  },
  planDecisionRow: {
    alignItems: "center",
    borderRadius: 9,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  planDecisionRowSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  planContextInputRow: {
    alignItems: "center",
    minHeight: 46,
    paddingVertical: 8,
  },
  planContextInput: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 19,
    maxHeight: 38,
    minHeight: 22,
    minWidth: 0,
    padding: 0,
    textAlignVertical: "top",
  },
  planDecisionIndex: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    width: 20,
  },
  planDecisionLabel: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 0,
    minWidth: 0,
  },
  inputOptionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  inputOptionDescription: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 16,
  },
  planDecisionActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  planDismissButton: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 8,
  },
  planDismissText: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  planSubmitButton: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 32,
    minWidth: 64,
    paddingHorizontal: 12,
  },
  planSubmitText: {
    color: "#0D0F13",
    fontFamily: Fonts.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  queuePanel: {
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    gap: 4,
    alignSelf: "center",
    overflow: "hidden",
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    position: "absolute",
    bottom: "100%",
    transform: [{ translateY: 6 }],
    zIndex: 2,
    width: "86%",
  },
  queueRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minHeight: 38,
  },
  goalRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  goalPromptGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: QUEUE_CONTENT_GAP,
    minWidth: 0,
  },
  goalStatusIconSlot: {
    alignItems: "center",
    height: QUEUE_LEADING_SLOT_SIZE,
    justifyContent: "center",
    width: QUEUE_LEADING_SLOT_SIZE,
  },
  goalPromptBody: {
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minWidth: 0,
  },
  goalTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  goalLabel: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 14,
  },
  goalMeta: {
    flexShrink: 0,
    fontFamily: Fonts.mono,
    fontSize: 10,
    includeFontPadding: false,
    lineHeight: 13,
  },
  goalObjective: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    includeFontPadding: false,
    lineHeight: 16,
  },
  goalActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
    height: 28,
    justifyContent: "flex-end",
    width: 96,
  },
  goalActionsCompact: {
    width: 62,
  },
  goalEditSheet: {
    gap: 14,
  },
  goalEditSheetInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    height: 136,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  goalEditSheetActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  goalEditCancelText: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  goalEditSaveButtonDisabled: {
    opacity: 0.45,
  },
  queuePromptGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: QUEUE_CONTENT_GAP,
    minWidth: 0,
  },
  queuePromptIconSlot: {
    alignItems: "center",
    height: QUEUE_LEADING_SLOT_SIZE,
    justifyContent: "center",
    width: QUEUE_LEADING_SLOT_SIZE,
  },
  queuePromptBody: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  queuePromptMarkdown: {
    maxHeight: 34,
    minWidth: 0,
    opacity: 0.88,
    overflow: "hidden",
    paddingRight: 2,
  },
  queueActions: {
    alignItems: "center",
    flexShrink: 0,
    flexDirection: "row",
    gap: QUEUE_ACTION_GAP,
    justifyContent: "flex-end",
    height: 34,
    width: QUEUE_ACTIONS_WIDTH,
  },
  queueSteerButton: {
    alignItems: "center",
    flexShrink: 0,
    flexDirection: "row",
    height: 28,
    justifyContent: "center",
    width: QUEUE_STEER_BUTTON_WIDTH,
  },
  queueSteerPill: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 28,
    justifyContent: "center",
    width: QUEUE_STEER_BUTTON_WIDTH,
  },
  queueSteerPillPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderColor: "rgba(255, 255, 255, 0.34)",
    opacity: 1,
    transform: [{ scale: 0.94 }],
  },
  queueActionText: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 14,
    textAlign: "center",
  },
  queueIconButton: {
    alignItems: "center",
    flexShrink: 0,
    height: QUEUE_ICON_BUTTON_SIZE,
    justifyContent: "center",
    width: QUEUE_ICON_BUTTON_SIZE,
  },
  queueIconCircle: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 10,
    borderWidth: 1,
    height: QUEUE_ICON_BUTTON_SIZE,
    justifyContent: "center",
    width: QUEUE_ICON_BUTTON_SIZE,
  },
  queueIconCirclePressed: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderColor: "rgba(255, 255, 255, 0.32)",
    opacity: 1,
    transform: [{ scale: 0.94 }],
  },
  skillPanel: {
    alignSelf: "center",
    borderRadius: 16,
    borderWidth: 1,
    bottom: "100%",
    gap: 2,
    maxHeight: 286,
    overflow: "hidden",
    paddingBottom: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: "absolute",
    transform: [{ translateY: -8 }],
    width: "86%",
    zIndex: 3,
  },
  skillList: {
    maxHeight: SUGGESTION_LIST_MAX_HEIGHT,
  },
  skillListContent: {
    gap: SUGGESTION_LIST_GAP,
  },
  skillRow: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 9,
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  skillRowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  skillIcon: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  skillCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  skillTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  skillTitle: {
    flex: 1,
    fontFamily: Fonts.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0,
  },
  skillSource: {
    flexShrink: 0,
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    maxWidth: 82,
  },
  skillDescription: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 14,
  },
  skillEmptyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  skillEmptyText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    backgroundColor: "transparent",
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    maxHeight: 84,
    minHeight: 42,
    paddingHorizontal: 2,
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: "top",
  },
  inputWithModeChip: {
    paddingRight: 82,
  },
  planModeChip: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    paddingHorizontal: 9,
    position: "absolute",
    right: 12,
    top: 10,
    zIndex: 1,
  },
  planModeChipText: {
    color: "#F2F2F2",
    fontFamily: Fonts.sansSemiBold,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 14,
  },
  actionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "flex-start",
  },
  attachmentRail: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingBottom: 2,
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    height: 32,
    paddingLeft: 6,
    paddingRight: 4,
  },
  attachmentChipIcon: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    overflow: "hidden",
    width: 18,
  },
  attachmentChipImage: {
    height: "100%",
    opacity: 0.76,
    width: "100%",
  },
  attachmentChipLabel: {
    backgroundColor: "transparent",
    fontFamily: Fonts.sansSemiBold,
    fontSize: 12,
    height: 18,
    lineHeight: 18,
    maxWidth: 82,
    paddingTop: 0,
    textAlignVertical: "center",
  },
  attachmentRemoveButton: {
    alignItems: "center",
    borderRadius: 10,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  leadingActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    flex: 1,
    height: 44,
    minWidth: 0,
  },
  footerRow: {
    alignItems: "stretch",
    flex: 1,
    height: 44,
    justifyContent: "center",
    minWidth: 0,
  },
  contextButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    marginLeft: 2,
    width: 36,
  },
  contextRingTrack: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  contextRingSvg: {
    position: "absolute",
  },
  contextPercent: {
    fontFamily: Fonts.sansBold,
    fontSize: 7,
    lineHeight: 9,
    maxWidth: 16,
    textAlign: "center",
  },
  iconButton: {
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    width: 36,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sendButtonDisabled: {
    backgroundColor: "rgba(243, 244, 246, 0.14)",
    opacity: 0.72,
  },
  sheetSection: {
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10,
  },
  sheetSectionTitle: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0,
    lineHeight: 14,
    paddingHorizontal: 10,
    paddingBottom: 4,
    textTransform: "uppercase",
  },
  limitRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  limitCopy: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  limitTitle: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  limitSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 16,
  },
  limitValue: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 17,
    marginLeft: 12,
  },
  pressed: {
    opacity: 0.75,
  },
});
