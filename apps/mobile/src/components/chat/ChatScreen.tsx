import { useSelector } from "@legendapp/state/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentSkill,
  PromptAttachment as ApiPromptAttachment,
  PromptSkill as ApiPromptSkill,
  PendingInputRequest,
  ReasoningEffort,
  RuntimeMode,
  RuntimePreferences,
  ThreadCollaborationMode,
  ThreadSummary,
  WebPreviewTarget,
  WorkspaceChangesResponse,
  WorkspacePreviewNavigationRequest,
} from "codex-relay/api-schema";
import {
  WORKSPACE_PREVIEW_OPEN_PROTOCOL,
  WorkspacePreviewNavigationRequestSchema,
  promptMarkdownWithSkills,
  promptSkillDisplayName,
  promptSkillMentionTextCandidates,
} from "codex-relay/api-schema";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type ScanningResult,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardController } from "react-native-keyboard-controller";
import PagerView from "react-native-pager-view";
import Animated, { LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import { AppToast } from "@/components/ui/toast";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { activeThreadAfterRefresh } from "@/lib/active-thread-selection";
import {
  getCodexRelayServerUrl,
  hasCodexRelaySession,
  interruptThreadRun,
  isPairingQrPayloadError,
  listSkills,
  pairWithQrPayload,
  refreshSession,
  resolveApproval,
  resolveCodexRelayUrl,
  streamThreadRun,
  uploadImageAttachments,
} from "@/lib/codex-relay-api";
import {
  hapticLightImpact,
  hapticMediumImpact,
  hapticSelection,
  hapticSuccess,
  hapticWarning,
} from "@/lib/haptics";
import { runtimePreferencesForWorkspace } from "@/lib/runtime-preferences";
import {
  applyStreamEventToServerState,
  checkoutWorkspaceBranchServerState,
  clearThreadGoalServerState,
  clearServerState,
  commitPushWorkspaceServerState,
  createThreadServerState,
  fetchContextWindowState,
  fetchModelsState,
  fetchQueuedInputsState,
  fetchRateLimitsState,
  fetchStatusState,
  fetchThreadGoalState,
  fetchThreadState,
  fetchThreadsState,
  fetchWorkspaceChangesState,
  optimisticallySteerQueuedInputState,
  removePendingInputRequestState,
  removeQueuedThreadInputServerState,
  restoreOptimisticSteerQueuedInputState,
  serverStateKeys,
  serverStateQueryFns,
  setQueuedInputsState,
  setRuntimePreferencesResponseState,
  setRuntimePreferencesState,
  setStatusState,
  setThreadDetailState,
  setThreadRunningState,
  setThreadsState,
  setWorkspaceRuntimePreferencesState,
  steerQueuedThreadInputServerState,
  submitThreadInputServerState,
  updateThreadGoalServerState,
  updateRuntimePreferencesServerState,
} from "@/lib/server-state";
import { recordSuccessfulAiConversationForReviewPrompt } from "@/lib/store-review-prompt";
import { completeThreadRunSession, handleThreadRunStreamEvent } from "@/lib/thread-run-stream";
import { readCachedWorkspaceRuntimePreferences } from "@/lib/workspace-runtime-preferences-cache";
import {
  appendComposerAttachments,
  chatStore$,
  clearComposerDraft,
  clearThreadStreamReconnectRequest,
  composerThreadKey,
  getCollaborationMode,
  getComposerAttachments,
  getComposerDraft,
  getComposerSkills,
  moveNewThreadCollaborationMode,
  requestThreadStreamReconnect,
  resetChatSessionState,
  setActiveThread,
  setComposerAttachments,
  setComposerDraft,
  setComposerSkills,
  setConnection,
  setHasPairedSession,
  setServerUrl,
  setThreadCollaborationMode,
  setThreadMessagesLoading,
  type LocalPromptAttachment,
  type QueuedComposerPrompt,
} from "@/state/chat-store";
import { addWorkspacePreviewTab } from "@/state/workspace-preview-store";

import { ChatControls } from "./ChatControls";
import { ChatShell } from "./ChatShell";
import { ConnectionBanner } from "./ConnectionBanner";
import {
  EXPANDED_DRAWER_BREAKPOINT,
  THREE_PANE_LAYOUT_BREAKPOINT,
  useIpadSplitLayout,
} from "./ipad-split-layout";
import { WorkspacePreviewSurface } from "./WorkspacePreviewSurface";
import type { WorkspaceMarkdownPreviewTarget } from "./workspace-preview/markdown-target";

const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 8 * 1024 * 1024;
const CHAT_INPUT_NATIVE_ID = "chat-composer-input";
const CONNECTION_HEALTH_CHECK_MS = 5000;
const CONNECTION_RETRY_MS = 2500;
const STREAM_STALL_RECONNECT_MS = 45_000;
const STREAM_WATCHDOG_INTERVAL_MS = 10_000;
const SCANNER_TO_APPROVAL_SHEET_DELAY_MS = 450;
const COPY_TOAST_VISIBLE_MS = 1800;
const PREVIEW_RESIZE_HANDLE_WIDTH = 14;
const DEFAULT_PREVIEW_PANE_WIDTH = 540;
const MIN_CHAT_PANE_WIDTH = 420;
const MIN_PREVIEW_PANE_WIDTH = 360;
const EMPTY_SKILLS: AgentSkill[] = [];
const EMPTY_THREADS: ThreadSummary[] = [];
let isHandlingPairingLink = false;
let lastHandledPairingUrl: string | undefined;

export function ChatScreen() {
  const { width } = useWindowDimensions();
  const { isSidebarVisible, toggleSidebar } = useIpadSplitLayout();
  const [pasteApprovalCode, setPasteApprovalCode] = useState<string | undefined>(undefined);
  const [pasteApprovalServerUrl, setPasteApprovalServerUrl] = useState<string | undefined>(
    undefined,
  );
  const [isPastePairOpen, setPastePairOpen] = useState(false);
  const [isPastePairing, setPastePairing] = useState(false);
  const [isAttachingImages, setAttachingImages] = useState(false);
  const composerFocusRequestKey = 0;
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isLoadingChanges, setLoadingChanges] = useState(false);
  const [workspaceChanges, setWorkspaceChanges] = useState<WorkspaceChangesResponse | undefined>(
    undefined,
  );
  const [workspaceChangesError, setWorkspaceChangesError] = useState<string | undefined>(undefined);
  const [
    optimisticRuntimePreferencesByWorkspacePath,
    setOptimisticRuntimePreferencesByWorkspacePath,
  ] = useState<Record<string, RuntimePreferences>>({});
  const [optimisticRuntimePreferences, setOptimisticRuntimePreferences] = useState<
    RuntimePreferences | undefined
  >(undefined);
  const [markdownPreviewTarget, setMarkdownPreviewTarget] = useState<
    WorkspaceMarkdownPreviewTarget | undefined
  >(undefined);
  const [isHandlingScan, setHandlingScan] = useState(false);
  const [activePagerPage, setActivePagerPage] = useState(0);
  const [isWidePreviewVisible, setWidePreviewVisible] = useState(true);
  const [wideLayoutWidth, setWideLayoutWidth] = useState(0);
  const [previewPaneWidth, setPreviewPaneWidth] = useState(DEFAULT_PREVIEW_PANE_WIDTH);
  const [scannerMessage, setScannerMessage] = useState("Point the camera at the connection QR.");
  const copyToastIdRef = useRef(0);
  const [copyToast, setCopyToast] = useState<{ id: number } | undefined>(undefined);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const usesExpandedSidebar = width >= EXPANDED_DRAWER_BREAKPOINT;
  const usesWideLayout = width >= THREE_PANE_LAYOUT_BREAKPOINT;
  const drawerNavigation = useNavigation<{
    openDrawer?: () => void;
  }>();
  const queryClient = useQueryClient();
  const checkoutWorkspaceBranchMutation = useMutation({
    mutationFn: (body: Parameters<typeof checkoutWorkspaceBranchServerState>[1]) =>
      checkoutWorkspaceBranchServerState(queryClient, body),
    onSuccess: (_response, body) => {
      void queryClient
        .invalidateQueries({
          queryKey: serverStateKeys.workspaceChanges(body.workspacePath),
        })
        .catch(() => undefined);
    },
  });
  const commitPushWorkspaceMutation = useMutation({
    mutationFn: (body: Parameters<typeof commitPushWorkspaceServerState>[1]) =>
      commitPushWorkspaceServerState(queryClient, body),
    onSuccess: (_response, body) => {
      void queryClient
        .invalidateQueries({
          queryKey: serverStateKeys.workspaceChanges(body.workspacePath),
        })
        .catch(() => undefined);
    },
  });
  const createThreadMutation = useMutation({
    mutationFn: (body: Parameters<typeof createThreadServerState>[1]) =>
      createThreadServerState(queryClient, body),
    onSuccess: () => {
      void queryClient
        .invalidateQueries({ queryKey: serverStateKeys.threads() })
        .catch(() => undefined);
    },
  });
  const removeQueuedThreadInputMutation = useMutation({
    mutationFn: (input: { inputId: string; threadId: string }) =>
      removeQueuedThreadInputServerState(queryClient, input.threadId, input.inputId),
    onSuccess: (_response, input) => {
      void queryClient
        .invalidateQueries({
          queryKey: serverStateKeys.queuedInputs(input.threadId),
        })
        .catch(() => undefined);
      void queryClient
        .invalidateQueries({ queryKey: serverStateKeys.thread(input.threadId) })
        .catch(() => undefined);
    },
  });
  const steerQueuedThreadInputMutation = useMutation({
    mutationFn: (input: { inputId: string; threadId: string }) =>
      steerQueuedThreadInputServerState(queryClient, input.threadId, input.inputId),
    onMutate: async (input) => {
      const queuedInput = queryClient
        .getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.queuedInputs>>>(
          serverStateKeys.queuedInputs(input.threadId),
        )
        ?.inputs.find((candidate) => candidate.id === input.inputId);
      if (!queuedInput) {
        return undefined;
      }
      const snapshot = await optimisticallySteerQueuedInputState(
        queryClient,
        input.threadId,
        queuedInput,
      );
      return { snapshot };
    },
    onError: (_caught, input, context) => {
      restoreOptimisticSteerQueuedInputState(queryClient, input.threadId, context?.snapshot);
    },
    onSuccess: (_response, input) => {
      void queryClient
        .invalidateQueries({
          queryKey: serverStateKeys.queuedInputs(input.threadId),
        })
        .catch(() => undefined);
      void queryClient
        .invalidateQueries({ queryKey: serverStateKeys.thread(input.threadId) })
        .catch(() => undefined);
    },
  });
  const updateThreadGoalMutation = useMutation({
    mutationFn: (input: { objective?: string; status?: "active" | "paused"; threadId: string }) =>
      updateThreadGoalServerState(queryClient, input.threadId, {
        objective: input.objective,
        status: input.status,
      }),
    onSuccess: (_response, input) => {
      void queryClient
        .invalidateQueries({ queryKey: serverStateKeys.thread(input.threadId) })
        .catch(() => undefined);
    },
  });
  const clearThreadGoalMutation = useMutation({
    mutationFn: (input: { threadId: string }) =>
      clearThreadGoalServerState(queryClient, input.threadId),
    onSuccess: (_response, input) => {
      void queryClient
        .invalidateQueries({ queryKey: serverStateKeys.thread(input.threadId) })
        .catch(() => undefined);
    },
  });
  const submitThreadInputMutation = useMutation({
    mutationFn: (input: {
      body: Parameters<typeof submitThreadInputServerState>[2];
      threadId: string;
    }) => submitThreadInputServerState(queryClient, input.threadId, input.body),
    onSuccess: (_response, input) => {
      queryClient.setQueryData(serverStateKeys.thread(input.threadId), (current) => current);
      queryClient.setQueryData(serverStateKeys.threads(), (current) => current);
    },
  });
  const updateRuntimePreferencesMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateRuntimePreferencesServerState>[0]) =>
      updateRuntimePreferencesServerState(body),
    onSuccess(response) {
      setRuntimePreferencesResponseState(queryClient, response);
      const workspacePreferences = response.workspacePath
        ? (response.runtimePreferencesByWorkspacePath[response.workspacePath] ??
          response.preferences)
        : undefined;
      if (response.workspacePath && workspacePreferences) {
        setOptimisticRuntimePreferencesByWorkspacePath((current) => ({
          ...current,
          [response.workspacePath as string]: workspacePreferences,
        }));
      } else {
        setOptimisticRuntimePreferences(response.preferences);
      }
      queryClient.setQueryData(serverStateKeys.status(), (current) => current);
    },
    onError(caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    },
  });
  const pagerRef = useRef<PagerView>(null);
  const isAttachingImagesRef = useRef(false);
  const isHandlingScanRef = useRef(false);
  const isModernScannerOpenRef = useRef(false);
  const previewResizeStartWidthRef = useRef(DEFAULT_PREVIEW_PANE_WIDTH);
  const scanPairingGenerationRef = useRef(0);
  const closeStreamRef = useRef<(() => void) | undefined>(undefined);
  const refreshPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const lastStreamActivityAtRef = useRef(0);
  const streamGenerationRef = useRef(0);
  const threadStatusPollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeThreadId = useSelector(() => chatStore$.activeThreadId.get());
  const connection = useSelector(() => chatStore$.connection.get());
  const error = useSelector(() => chatStore$.error.get());
  const hasPairedSession = useSelector(() => chatStore$.hasPairedSession.get());
  const collaborationMode = useSelector(
    () =>
      chatStore$.collaborationModeByThreadId[composerThreadKey(activeThreadId)].get() ??
      (activeThreadId
        ? chatStore$.threadsById[activeThreadId].collaborationMode.get()
        : undefined) ??
      "default",
  );
  const serverUrl = useSelector(() => chatStore$.serverUrl.get());
  const threadMessagesLoadingByThreadId = useSelector(() =>
    chatStore$.threadMessagesLoadingByThreadId.get(),
  );
  const threadStreamReconnectRequest = useSelector(() =>
    chatStore$.threadStreamReconnectRequest.get(),
  );

  const statusQuery = useQuery({
    queryKey: serverStateKeys.status(),
    queryFn: serverStateQueryFns.status,
    enabled: false,
  });
  const threadsQuery = useQuery({
    queryKey: serverStateKeys.threads(),
    queryFn: serverStateQueryFns.threads,
    enabled: false,
  });
  const modelsQuery = useQuery({
    queryKey: serverStateKeys.models(),
    queryFn: serverStateQueryFns.models,
    enabled: false,
  });
  const rateLimitsQuery = useQuery({
    queryKey: serverStateKeys.rateLimits(),
    queryFn: serverStateQueryFns.rateLimits,
    enabled: false,
  });
  const activeThreadDetailQuery = useQuery({
    queryKey: activeThreadId
      ? serverStateKeys.thread(activeThreadId)
      : [...serverStateKeys.threads(), "__inactive__", "detail"],
    queryFn: ({ queryKey }) => serverStateQueryFns.thread(String(queryKey[3] ?? "")),
    enabled: Boolean(activeThreadId),
  });
  const queuedInputsQuery = useQuery({
    queryKey: activeThreadId
      ? serverStateKeys.queuedInputs(activeThreadId)
      : [...serverStateKeys.threads(), "__inactive__", "queued-inputs"],
    queryFn: ({ queryKey }) => serverStateQueryFns.queuedInputs(String(queryKey[3] ?? "")),
    enabled: Boolean(activeThreadId),
  });
  const contextWindowQuery = useQuery({
    queryKey: activeThreadId
      ? serverStateKeys.contextWindow(activeThreadId)
      : [...serverStateKeys.threads(), "__inactive__", "context-window"],
    queryFn: ({ queryKey }) => serverStateQueryFns.contextWindow(String(queryKey[3] ?? "")),
    enabled: Boolean(activeThreadId),
  });

  const workspacePath = statusQuery.data?.workspacePath;
  const threads = useMemo(
    () => threadsQuery.data?.threads ?? EMPTY_THREADS,
    [threadsQuery.data?.threads],
  );
  const threadsById = useMemo(() => indexThreadsById(threads), [threads]);
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data?.models]);
  const rateLimitBuckets = useMemo(
    () => rateLimitsQuery.data?.buckets ?? [],
    [rateLimitsQuery.data?.buckets],
  );
  const activeThread =
    activeThreadDetailQuery.data?.thread ??
    (activeThreadId ? threadsById[activeThreadId] : undefined);
  const isRunningAppThread = activeThread?.source === "app" && activeThread.state === "running";
  const activeWorkspacePath = activeThread?.cwd ?? workspacePath;
  const skillsQuery = useQuery({
    queryKey: ["codex-relay-skills", serverUrl, activeWorkspacePath ?? null],
    queryFn: () => listSkills(activeWorkspacePath),
    enabled: Boolean(activeWorkspacePath && hasPairedSession),
    staleTime: 30_000,
  });
  const skills = useMemo(
    () => skillsQuery.data?.skills ?? EMPTY_SKILLS,
    [skillsQuery.data?.skills],
  );
  const skillsLoadState = skillQueryLoadState(skillsQuery);
  const statusPreferences = statusQuery.data?.preferences ?? { runtimeMode: "default" };
  const workspacePreferences = workspacePreferencesForPath(activeWorkspacePath, statusQuery.data);
  const optimisticWorkspacePreferences = activeWorkspacePath
    ? optimisticRuntimePreferencesByWorkspacePath[activeWorkspacePath]
    : optimisticRuntimePreferences;
  const activeRuntimePreferences = runtimePreferencesWithAvailableServiceTier(
    runtimePreferencesForWorkspace(
      optimisticWorkspacePreferences ?? workspacePreferences,
      statusPreferences,
    ),
  );
  const runtimeMode = activeRuntimePreferences.runtimeMode;
  const selectedModel = activeRuntimePreferences.model;
  const selectedServiceTier = activeRuntimePreferences.serviceTier;
  const selectedReasoningEffort = activeRuntimePreferences.reasoningEffort;
  const changeCollaborationMode = useCallback(
    (mode: ThreadCollaborationMode) => {
      setThreadCollaborationMode(activeThreadId, mode);
    },
    [activeThreadId],
  );
  const messages = activeThreadDetailQuery.data?.messages ?? [];
  const isLoadingSelectedThreadMessages = activeThreadId
    ? threadMessagesLoadingByThreadId[activeThreadId] === true
    : false;
  const isLoadingMessages =
    !!activeThreadId &&
    !activeThreadDetailQuery.data &&
    !isRunningAppThread &&
    (isLoadingSelectedThreadMessages || (activeThread?.messageCount ?? 0) > 0);
  const contextWindowUsage = contextWindowQuery.data?.usage ?? undefined;
  const queuedPrompts = useMemo(
    () => queuedInputsQuery.data?.inputs ?? [],
    [queuedInputsQuery.data?.inputs],
  );
  const pendingInputRequest = activeThreadDetailQuery.data?.pendingInputRequests?.[0];
  const isRunning = activeThread?.state === "running";
  const [webPreviewTargetsByThreadId, setWebPreviewTargetsByThreadId] = useState<
    Record<string, WebPreviewTarget | undefined>
  >({});
  const activeWebPreviewTarget = activeThreadId
    ? webPreviewTargetsByThreadId[activeThreadId]
    : undefined;
  const applyStatusFromServer = useCallback(
    (status: Awaited<ReturnType<typeof serverStateQueryFns.status>>) => {
      setStatusState(queryClient, status);
    },
    [queryClient],
  );

  const clearQueuedPrompts = useCallback(
    (threadId = chatStore$.activeThreadId.peek()) => {
      if (threadId) {
        setQueuedInputsState(queryClient, threadId, []);
      }
    },
    [queryClient],
  );

  function markQueuedPromptStarted(threadId: string, prompt?: string) {
    const queuedPrompts =
      queryClient.getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.queuedInputs>>>(
        serverStateKeys.queuedInputs(threadId),
      )?.inputs ?? [];
    if (!prompt || queuedPrompts.length === 0) {
      return;
    }
    const index = queuedPrompts.findIndex(
      (item) => prompt === item.prompt || prompt.startsWith(item.prompt),
    );
    if (index === -1) {
      return;
    }
    const next = queuedPrompts.filter((_, itemIndex) => itemIndex !== index);
    setQueuedInputsState(queryClient, threadId, next);
  }

  function removeQueuedPromptFromState(item: QueuedComposerPrompt) {
    if (!activeThreadId) {
      return;
    }
    const current =
      queryClient.getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.queuedInputs>>>(
        serverStateKeys.queuedInputs(activeThreadId),
      )?.inputs ?? [];
    const next = current.filter((queued) => queued.id !== item.id);
    setQueuedInputsState(queryClient, activeThreadId, next);
  }

  const syncPairedSessionState = useCallback(() => {
    const hasSession = hasCodexRelaySession();
    setHasPairedSession(hasSession);
    if (!hasSession) {
      clearServerState(queryClient);
      resetChatSessionState();
    }
    return hasSession;
  }, [queryClient]);

  const clearThreadStatusPoll = useCallback(() => {
    if (!threadStatusPollRef.current) {
      return;
    }
    clearTimeout(threadStatusPollRef.current);
    threadStatusPollRef.current = undefined;
  }, []);

  const detachCurrentStream = useCallback(() => {
    streamGenerationRef.current += 1;
    closeStreamRef.current?.();
    closeStreamRef.current = undefined;
  }, []);

  const markStreamActivity = useCallback(() => {
    lastStreamActivityAtRef.current = Date.now();
  }, []);

  const syncThreadSnapshot = useCallback(
    async (threadId: string, options: { setOfflineOnError?: boolean } = {}) => {
      const setOfflineOnError = options.setOfflineOnError ?? true;
      setThreadMessagesLoading(threadId, true);
      try {
        const response = await fetchThreadState(queryClient, threadId);
        syncPairedSessionState();
        if (chatStore$.activeThreadId.peek() !== threadId) {
          return response.thread.state;
        }
        setThreadDetailState(
          queryClient,
          response.thread,
          response.messages,
          response.pendingInputRequests,
        );
        await Promise.all([
          fetchQueuedInputsState(queryClient, threadId).catch(() => undefined),
          fetchContextWindowState(queryClient, threadId).catch(() => undefined),
          fetchThreadGoalState(queryClient, threadId).catch(() => undefined),
        ]);
        setConnection("connected");
        return response.thread.state;
      } catch (caught) {
        syncPairedSessionState();
        if (setOfflineOnError && chatStore$.activeThreadId.peek() === threadId) {
          setConnection("offline", errorMessage(caught));
        }
        return undefined;
      } finally {
        setThreadMessagesLoading(threadId, false);
      }
    },
    [queryClient, syncPairedSessionState],
  );

  const scheduleThreadStatusPoll = useCallback(
    (threadId: string) => {
      clearThreadStatusPoll();
      threadStatusPollRef.current = setTimeout(() => {
        threadStatusPollRef.current = undefined;
        if (chatStore$.activeThreadId.peek() !== threadId) {
          return;
        }
        void syncThreadSnapshot(threadId).then((state) => {
          if (state === "running" && chatStore$.activeThreadId.peek() === threadId) {
            scheduleThreadStatusPoll(threadId);
          }
        });
      }, 1500);
    },
    [clearThreadStatusPoll, syncThreadSnapshot],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      setActiveThread(threadId);
      const state = await syncThreadSnapshot(threadId);
      if (state === "running") {
        requestThreadStreamReconnect(threadId);
        return;
      }
      clearThreadStatusPoll();
      if (chatStore$.activeThreadId.peek() === threadId) {
        setThreadRunningState(queryClient, threadId, false);
      }
    },
    [clearThreadStatusPoll, queryClient, syncThreadSnapshot],
  );

  const refreshUsageStatus = useCallback(
    async (threadId = chatStore$.activeThreadId.peek()) => {
      const rateLimitsResponse = await safeAsyncValue(() => fetchRateLimitsState(queryClient));
      const contextResponse = threadId
        ? await safeAsyncValue(() => fetchContextWindowState(queryClient, threadId))
        : undefined;
      if (rateLimitsResponse) {
        queryClient.setQueryData(serverStateKeys.rateLimits(), rateLimitsResponse);
      }
      if (threadId && contextResponse) {
        queryClient.setQueryData(serverStateKeys.contextWindow(threadId), contextResponse);
      }
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const request = (async () => {
      if (chatStore$.connection.peek() !== "checking") {
        setConnection("checking");
      }
      syncPairedSessionState();
      setServerUrl(getCodexRelayServerUrl());
      try {
        await refreshSession().catch(() => false);
        syncPairedSessionState();
        const [status, response, modelsResponse, rateLimitsResponse] = await Promise.all([
          fetchStatusState(queryClient),
          fetchThreadsState(queryClient),
          fetchModelsState(queryClient),
          fetchRateLimitsState(queryClient).catch(() => undefined),
        ]);
        applyStatusFromServer(status);
        setThreadsState(queryClient, response.threads, response.source);
        queryClient.setQueryData(serverStateKeys.models(), modelsResponse);
        if (rateLimitsResponse) {
          queryClient.setQueryData(serverStateKeys.rateLimits(), rateLimitsResponse);
        }
        setConnection("connected");

        const currentActiveThreadId = chatStore$.activeThreadId.peek();
        const hasCurrentActiveThread =
          !!currentActiveThreadId &&
          response.threads.some((thread) => thread.id === currentActiveThreadId);
        const missingActiveThreadState =
          currentActiveThreadId && !hasCurrentActiveThread
            ? await syncThreadSnapshot(currentActiveThreadId, { setOfflineOnError: false })
            : undefined;
        if (chatStore$.activeThreadId.peek() !== currentActiveThreadId) {
          return;
        }
        const missingActiveThreadRestored = Boolean(missingActiveThreadState);
        const nextActiveThreadId = activeThreadAfterRefresh({
          currentActiveThreadId,
          missingActiveThreadRestored,
          threads: response.threads,
        });

        if (nextActiveThreadId !== currentActiveThreadId) {
          setActiveThread(nextActiveThreadId);
        }
        if (nextActiveThreadId && !missingActiveThreadRestored) {
          await loadThread(nextActiveThreadId);
        } else if (nextActiveThreadId && missingActiveThreadState === "running") {
          requestThreadStreamReconnect(nextActiveThreadId);
        }
      } catch (caught) {
        syncPairedSessionState();
        setConnection("offline", errorMessage(caught));
      }
    })();
    refreshPromiseRef.current = request;
    void request.finally(() => {
      if (refreshPromiseRef.current === request) {
        refreshPromiseRef.current = undefined;
      }
    });
    return request;
  }, [applyStatusFromServer, loadThread, queryClient, syncPairedSessionState, syncThreadSnapshot]);

  const keepConnectionIfSessionIsValid = useCallback(
    async (fallbackError: string) => {
      try {
        await refreshSession().catch(() => false);
        syncPairedSessionState();
        const status = await fetchStatusState(queryClient);
        applyStatusFromServer(status);
        setConnection("connected");
      } catch (caught) {
        syncPairedSessionState();
        setConnection("offline", caught instanceof Error ? caught.message : fallbackError);
      }
    },
    [applyStatusFromServer, queryClient, syncPairedSessionState],
  );

  const recoverThreadAfterStreamLoss = useCallback(
    async (threadId: string, fallbackError: string) => {
      if (hasCodexRelaySession()) {
        setConnection("checking");
      }
      await refreshSession().catch(() => false);
      syncPairedSessionState();
      const state = await syncThreadSnapshot(threadId);
      if (state === "running" && chatStore$.activeThreadId.peek() === threadId) {
        const thread = queryClient.getQueryData<
          Awaited<ReturnType<typeof serverStateQueryFns.thread>>
        >(serverStateKeys.thread(threadId))?.thread;
        if (thread?.source === "app") {
          requestThreadStreamReconnect(threadId);
          return;
        }
        scheduleThreadStatusPoll(threadId);
        return;
      }
      if (state) {
        clearThreadStatusPoll();
        return;
      }
      setConnection("offline", fallbackError);
    },
    [
      clearThreadStatusPoll,
      queryClient,
      scheduleThreadStatusPoll,
      syncPairedSessionState,
      syncThreadSnapshot,
    ],
  );

  const recoverPromptRunAfterEarlyStreamLoss = useCallback(
    async (threadId: string, fallbackError: string, restorePrompt: () => void) => {
      const state = await syncThreadSnapshot(threadId);
      if (state === "running") {
        requestThreadStreamReconnect(threadId);
        return;
      }

      setThreadRunningState(queryClient, threadId, false);
      clearQueuedPrompts(threadId);
      setQueuedInputsState(queryClient, threadId, []);
      restorePrompt();

      if (state) {
        setConnection("connected");
        return;
      }

      void keepConnectionIfSessionIsValid(fallbackError);
    },
    [clearQueuedPrompts, keepConnectionIfSessionIsValid, queryClient, syncThreadSnapshot],
  );

  const attachRunningThreadStream = useCallback(
    (threadId: string) => {
      detachCurrentStream();
      const streamGeneration = streamGenerationRef.current + 1;
      streamGenerationRef.current = streamGeneration;
      let receivedStreamEvent = false;
      let sawTerminalStreamEvent = false;
      markStreamActivity();
      setThreadRunningState(queryClient, threadId, true);
      setConnection("connected");
      clearThreadStatusPoll();

      closeStreamRef.current = streamThreadRun(
        threadId,
        {},
        {
          onEvent(event) {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            markStreamActivity();
            receivedStreamEvent = true;
            handleThreadRunStreamEvent(event, {
              fallbackThreadId: threadId,
              applyEvent: (streamEvent) => {
                applyStreamEventToServerState(queryClient, streamEvent);
              },
              onPreviewTarget(previewThreadId, target) {
                setWebPreviewTargetsByThreadId((current) => ({
                  ...current,
                  [previewThreadId]: target,
                }));
              },
              onTerminal(terminalThreadId, terminalEvent) {
                sawTerminalStreamEvent = true;
                completeThreadRunSession({
                  threadId: terminalThreadId,
                  clearQueuedPrompts,
                  onSuccessfulCompletion: recordSuccessfulAiConversationForReviewPrompt,
                  setQueuedInputs: (queuedThreadId, inputs) =>
                    setQueuedInputsState(queryClient, queuedThreadId, inputs),
                  setRunning: (isRunning) =>
                    setThreadRunningState(queryClient, terminalThreadId, isRunning),
                  terminalEvent,
                  refreshUsageStatus,
                });
              },
            });
          },
          onError(caught) {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            closeStreamRef.current?.();
            closeStreamRef.current = undefined;
            if (receivedStreamEvent) {
              void recoverThreadAfterStreamLoss(threadId, caught.message);
              return;
            }
            void recoverThreadAfterStreamLoss(threadId, caught.message);
          },
          onClose() {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            closeStreamRef.current = undefined;
            if (!receivedStreamEvent) {
              void recoverThreadAfterStreamLoss(
                threadId,
                "Codex Relay stream closed before the running thread attached.",
              );
              return;
            }
            if (!sawTerminalStreamEvent) {
              void recoverThreadAfterStreamLoss(
                threadId,
                "Codex Relay stream closed before the running thread completed.",
              );
              return;
            }
            void refreshUsageStatus(threadId).catch(() => undefined);
          },
        },
      );
    },
    [
      clearThreadStatusPoll,
      clearQueuedPrompts,
      detachCurrentStream,
      markStreamActivity,
      recoverThreadAfterStreamLoss,
      refreshUsageStatus,
      queryClient,
    ],
  );

  useEffect(() => {
    if (!threadStreamReconnectRequest) {
      return;
    }
    clearThreadStreamReconnectRequest(threadStreamReconnectRequest.requestId);
    attachRunningThreadStream(threadStreamReconnectRequest.threadId);
  }, [attachRunningThreadStream, threadStreamReconnectRequest]);

  useEffect(() => {
    if (
      !activeThreadId ||
      activeThread?.state !== "running" ||
      activeThread.source !== "app" ||
      closeStreamRef.current ||
      threadStreamReconnectRequest
    ) {
      return;
    }

    requestThreadStreamReconnect(activeThreadId);
  }, [activeThread?.source, activeThread?.state, activeThreadId, threadStreamReconnectRequest]);

  const loadWorkspaceChanges = useCallback(
    async (options: { staleTime?: number } = {}) => {
      setLoadingChanges(true);
      setWorkspaceChangesError(undefined);
      try {
        const changes = await fetchWorkspaceChangesState(queryClient, activeWorkspacePath, options);
        setWorkspaceChanges(changes);
        setConnection("connected");
      } catch (caught) {
        syncPairedSessionState();
        setWorkspaceChangesError(errorMessage(caught));
      } finally {
        setLoadingChanges(false);
      }
    },
    [activeWorkspacePath, queryClient, syncPairedSessionState],
  );

  useEffect(() => {
    setWorkspaceChanges(undefined);
    setWorkspaceChangesError(undefined);
  }, [activeWorkspacePath]);

  const showPagerPage = useCallback((page: number) => {
    setActivePagerPage(page);
    requestAnimationFrame(() => {
      pagerRef.current?.setPage(page);
    });
  }, []);

  const guardWorkspacePreviewAction = useCallback(async () => true, []);

  const openWorkspacePreview = useCallback(
    (request: WorkspacePreviewNavigationRequest) => {
      const parsedRequest = WorkspacePreviewNavigationRequestSchema.safeParse({
        ...request,
        workspacePath: request.workspacePath ?? activeWorkspacePath,
      });

      if (!parsedRequest.success) {
        Alert.alert("Unable to open preview", "This workspace preview request is invalid.");
        return;
      }

      const previewRequest = parsedRequest.data;
      const workspacePath = previewRequest.workspacePath ?? activeWorkspacePath;

      if (previewRequest.tab === "markdown") {
        const path = workspaceRelativeMarkdownPath(previewRequest.target.path, workspacePath);
        if (!path) {
          Alert.alert(
            "Unable to open Markdown",
            "This document is not inside the current workspace.",
          );
          return;
        }

        setMarkdownPreviewTarget({
          name: previewRequest.target.name,
          path,
          workspacePath,
        });
      }

      if (previewRequest.tab === "web" && previewRequest.target && activeThreadId) {
        setWebPreviewTargetsByThreadId((current) => ({
          ...current,
          [activeThreadId]: previewRequest.target,
        }));
      }

      dismissKeyboardForWorkspacePreview();
      addWorkspacePreviewTab(workspacePath, previewRequest.tab);
      hapticMediumImpact();
      if (usesWideLayout) {
        setWidePreviewVisible(true);
        setActivePagerPage(1);
      } else {
        requestAnimationFrame(() => {
          showPagerPage(1);
        });
      }
    },
    [activeThreadId, activeWorkspacePath, showPagerPage, usesWideLayout],
  );

  const openMarkdownAttachmentPreview = useCallback(
    (target: WorkspaceMarkdownPreviewTarget) => {
      openWorkspacePreview({
        protocol: WORKSPACE_PREVIEW_OPEN_PROTOCOL,
        tab: "markdown",
        target,
        workspacePath: activeWorkspacePath,
      });
    },
    [activeWorkspacePath, openWorkspacePreview],
  );

  const closeWorkspacePreview = useCallback(() => {
    hapticSelection();
    if (usesWideLayout) {
      setWidePreviewVisible(false);
      setActivePagerPage(0);
      return;
    }
    showPagerPage(0);
  }, [showPagerPage, usesWideLayout]);

  const checkoutBranch = useCallback(
    async (branch: string) => {
      if (!(await guardWorkspacePreviewAction())) {
        return;
      }

      await checkoutWorkspaceBranchMutation.mutateAsync({
        branch,
        workspacePath: activeWorkspacePath,
      });
      await loadWorkspaceChanges();
    },
    [
      activeWorkspacePath,
      checkoutWorkspaceBranchMutation,
      guardWorkspacePreviewAction,
      loadWorkspaceChanges,
    ],
  );

  async function commitPush() {
    if (!(await guardWorkspacePreviewAction())) {
      return;
    }

    const changes = await fetchWorkspaceChangesState(queryClient, activeWorkspacePath);
    setWorkspaceChanges(changes);
    await commitPushWorkspaceMutation.mutateAsync({
      message: commitMessageForWorkspaceChanges(changes),
      workspacePath: activeWorkspacePath,
    });
    hapticSuccess();
    await loadWorkspaceChanges();
  }

  async function createPullRequest() {
    if (!(await guardWorkspacePreviewAction())) {
      return;
    }

    await sendPrompt(
      [
        "$github:yeet",
        "",
        "Create a draft pull request for the current workspace changes.",
        "Use the repository PR conventions, include the relevant context from this thread, and refresh the workspace diff before writing the PR description.",
      ].join("\n"),
    );
  }

  useEffect(() => {
    setServerUrl(getCodexRelayServerUrl());
    syncPairedSessionState();
    void refresh();
    return () => {
      clearThreadStatusPoll();
      detachCurrentStream();
      isModernScannerOpenRef.current = false;
      void CameraView.dismissScanner().catch(() => undefined);
    };
  }, [clearThreadStatusPoll, detachCurrentStream, refresh, syncPairedSessionState]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        detachCurrentStream();
      };
    }, [detachCurrentStream, refresh]),
  );

  useEffect(() => {
    let previousAppState = AppState.currentState;
    const appStateListener = AppState.addEventListener("change", (nextAppState) => {
      const wasInactive = previousAppState !== "active";
      previousAppState = nextAppState;

      if (nextAppState === "active") {
        if (wasInactive) {
          detachCurrentStream();
          void refresh();
        }
        return;
      }

      detachCurrentStream();
    });

    return () => appStateListener.remove();
  }, [detachCurrentStream, refresh]);

  useEffect(() => {
    if (!activeThreadId || !isRunning || connection !== "connected") {
      return undefined;
    }

    const watchdog = setInterval(() => {
      const lastActivityAt = lastStreamActivityAtRef.current;
      if (lastActivityAt && Date.now() - lastActivityAt < STREAM_STALL_RECONNECT_MS) {
        return;
      }

      void syncThreadSnapshot(activeThreadId).then((state) => {
        if (state === "running" && chatStore$.activeThreadId.peek() === activeThreadId) {
          detachCurrentStream();
          requestThreadStreamReconnect(activeThreadId);
        }
      });
    }, STREAM_WATCHDOG_INTERVAL_MS);

    return () => clearInterval(watchdog);
  }, [activeThreadId, connection, detachCurrentStream, isRunning, syncThreadSnapshot]);

  useEffect(() => {
    if (connection !== "offline" || !hasPairedSession) {
      return undefined;
    }

    const retry = setTimeout(() => {
      void refresh();
    }, CONNECTION_RETRY_MS);
    return () => clearTimeout(retry);
  }, [connection, hasPairedSession, refresh]);

  useEffect(() => {
    if (connection !== "connected" || isRunning) {
      return undefined;
    }

    const healthCheck = setInterval(() => {
      void keepConnectionIfSessionIsValid("Codex Relay connection lost.");
    }, CONNECTION_HEALTH_CHECK_MS);
    return () => clearInterval(healthCheck);
  }, [connection, isRunning, keepConnectionIfSessionIsValid]);

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert("Camera access needed", "Allow camera access to scan the connection QR code.");
        return;
      }
    }

    setHandlingScan(false);
    isHandlingScanRef.current = false;
    setScannerMessage("Point the camera at the connection QR.");

    if (CameraView.isModernBarcodeScannerAvailable) {
      isModernScannerOpenRef.current = true;
      try {
        await CameraView.launchScanner({
          barcodeTypes: ["qr"],
          isHighlightingEnabled: true,
        });
        return;
      } catch (caught) {
        isModernScannerOpenRef.current = false;
        if (isBarcodeScannerCancellation(caught)) {
          return;
        }
      }
    }

    setScannerOpen(true);
  }

  const handlePairingLink = useCallback(
    async (url: string | null) => {
      const pairingUrl = url?.trim();
      if (
        !pairingUrl?.startsWith("codex-relay://pair") ||
        pairingUrl === lastHandledPairingUrl ||
        isHandlingPairingLink
      ) {
        return;
      }

      lastHandledPairingUrl = pairingUrl;
      isHandlingPairingLink = true;
      setPastePairing(true);
      setPasteApprovalCode(undefined);
      setPasteApprovalServerUrl(undefined);
      try {
        const pairing = await pairWithQrPayload(pairingUrl, {
          onApprovalCode(approvalCode, serverUrl) {
            setPasteApprovalCode(approvalCode);
            setPasteApprovalServerUrl(serverUrl);
            setPastePairOpen(true);
          },
        });
        setServerUrl(pairing.serverUrl);
        clearServerState(queryClient);
        syncPairedSessionState();
        setPastePairOpen(false);
        setPasteApprovalCode(undefined);
        setPasteApprovalServerUrl(undefined);
        hapticSuccess();
        await refresh();
      } catch {
        Alert.alert("Pairing failed", pairingFailureAlertMessage);
      } finally {
        isHandlingPairingLink = false;
        setPastePairing(false);
      }
    },
    [queryClient, refresh, syncPairedSessionState],
  );

  useEffect(() => {
    let isMounted = true;
    void Linking.getInitialURL().then((url) => {
      if (isMounted) {
        void handlePairingLink(url);
      }
    });
    const unsubscribe = subscribeToPairingLinks(handlePairingLink);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [handlePairingLink]);

  const closeScannerSurface = useCallback(async () => {
    const wasModernScannerOpen = isModernScannerOpenRef.current;
    isModernScannerOpenRef.current = false;
    setScannerOpen(false);
    if (wasModernScannerOpen) {
      await CameraView.dismissScanner().catch(() => undefined);
    }
  }, []);

  const presentScannedPairingApproval = useCallback(
    async (scanPairingGeneration: number, approvalCode: string, serverUrl: string) => {
      setPasteApprovalCode(approvalCode);
      setPasteApprovalServerUrl(serverUrl);
      setScannerMessage(approvalMessage(approvalCode, serverUrl));
      await closeScannerSurface();
      await delay(SCANNER_TO_APPROVAL_SHEET_DELAY_MS);
      if (scanPairingGenerationRef.current === scanPairingGeneration && isHandlingScanRef.current) {
        setPastePairOpen(true);
      }
    },
    [closeScannerSurface],
  );

  const handleScanPayload = useCallback(
    async (payload: unknown) => {
      if (isHandlingScanRef.current) {
        return;
      }

      const scanPairingGeneration = scanPairingGenerationRef.current + 1;
      scanPairingGenerationRef.current = scanPairingGeneration;
      isHandlingScanRef.current = true;
      setHandlingScan(true);
      setPasteApprovalCode(undefined);
      setPasteApprovalServerUrl(undefined);
      setScannerMessage("QR detected. Pairing...");
      await closeScannerSurface();
      setPastePairOpen(true);
      try {
        const pairing = await pairWithQrPayload(payload, {
          onApprovalCode(approvalCode, serverUrl) {
            void presentScannedPairingApproval(scanPairingGeneration, approvalCode, serverUrl);
          },
        });
        scanPairingGenerationRef.current += 1;
        isHandlingScanRef.current = false;
        setHandlingScan(false);
        setServerUrl(pairing.serverUrl);
        clearServerState(queryClient);
        syncPairedSessionState();
        setPastePairOpen(false);
        setPasteApprovalCode(undefined);
        setPasteApprovalServerUrl(undefined);
        await closeScannerSurface();
        hapticSuccess();
        await refresh();
      } catch (caught) {
        scanPairingGenerationRef.current += 1;
        await closeScannerSurface();
        isHandlingScanRef.current = false;
        setHandlingScan(false);
        setPastePairOpen(false);
        setPasteApprovalCode(undefined);
        setPasteApprovalServerUrl(undefined);
        const isInvalidPairingQr = isPairingQrPayloadError(caught);
        setScannerMessage(scannerPairingFailureMessage(caught));
        Alert.alert(
          isInvalidPairingQr ? "Invalid QR code" : "Pairing failed",
          isInvalidPairingQr ? invalidPairingQrAlertMessage : pairingFailureAlertMessage,
        );
      }
    },
    [
      closeScannerSurface,
      presentScannedPairingApproval,
      queryClient,
      refresh,
      syncPairedSessionState,
    ],
  );

  function handleBarcodeScanned(result: BarcodeScanningResult | ScanningResult) {
    void handleScanPayload(readScannedPayload(result));
  }

  useEffect(() => {
    const barcodeScanListener = CameraView.onModernBarcodeScanned((result) => {
      if (!isModernScannerOpenRef.current) {
        return;
      }

      void handleScanPayload(readScannedPayload(result));
    });

    return () => barcodeScanListener.remove();
  }, [handleScanPayload]);

  async function sendPrompt(
    promptOverride?: string,
    collaborationModeOverride?: ThreadCollaborationMode,
  ) {
    const isDraftPrompt = promptOverride === undefined;
    const composerThreadId = chatStore$.activeThreadId.peek();
    const draft = getComposerDraft(composerThreadId);
    const attachments = getComposerAttachments(composerThreadId);
    const selectedSkills = getComposerSkills(composerThreadId);
    const pendingAttachments = isDraftPrompt ? attachments : [];
    const pendingSkills = isDraftPrompt ? selectedSkills : [];
    const rawTextPrompt = (promptOverride ?? draft).trim();
    const textPrompt = rawTextPrompt;
    const requestCollaborationMode =
      collaborationModeOverride ?? getCollaborationMode(composerThreadId);
    if (!textPrompt && pendingAttachments.length === 0 && pendingSkills.length === 0) {
      return;
    }

    const fallbackPrompt =
      pendingAttachments.length > 0
        ? "Please use the attached image(s) as context."
        : "Use the selected skill.";
    const requestAttachments = promptAttachmentsForRequest(pendingAttachments);
    const requestSkills = promptSkillsForRequestFromPrompt(textPrompt, pendingSkills, skills);
    const prompt = promptMarkdownWithSkills(textPrompt || fallbackPrompt, requestSkills);
    const runPreferences = currentRuntimePreferences();
    if (isDraftPrompt) {
      clearComposerDraft(composerThreadId);
    }

    const shouldSubmitRunningInput = isRunning && activeThread?.state === "running";
    if (shouldSubmitRunningInput) {
      if (!isDraftPrompt || !activeThreadId) {
        return;
      }

      Keyboard.dismiss();
      hapticLightImpact();

      try {
        const response = await submitThreadInputMutation.mutateAsync({
          threadId: activeThreadId,
          body: {
            attachments: requestAttachments,
            prompt,
            skills: requestSkills,
            model: runPreferences.model,
            serviceTier: runPreferences.serviceTier,
            reasoningEffort: runPreferences.reasoningEffort,
            runtimeMode: runPreferences.runtimeMode,
            collaborationMode: requestCollaborationMode,
          },
        });
        const current =
          queryClient.getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.queuedInputs>>>(
            serverStateKeys.queuedInputs(activeThreadId),
          )?.inputs ?? [];
        {
          const next = [
            ...current,
            response.input ?? {
              attachments: requestAttachments,
              id: `${Date.now()}`,
              prompt,
              skills: requestSkills,
            },
          ];
          const extra = next.length - response.queueLength;
          const visibleQueue = extra > 0 ? next.slice(extra) : next;
          setQueuedInputsState(queryClient, activeThreadId, visibleQueue, response.queueLength);
        }
        setConnection("connected");
        if (!closeStreamRef.current && activeThread?.source === "app") {
          requestThreadStreamReconnect(activeThreadId);
        }
      } catch (caught) {
        syncPairedSessionState();
        setComposerDraft(textPrompt, composerThreadId);
        setComposerAttachments(pendingAttachments, composerThreadId);
        setComposerSkills(pendingSkills, composerThreadId);
        setConnection("offline", errorMessage(caught));
      }
      return;
    }

    await startPromptRun({
      attachments: requestAttachments,
      collaborationMode: requestCollaborationMode,
      prompt,
      restoreDraftOnFailure: isDraftPrompt,
      restoreAttachments: pendingAttachments,
      restoreSkills: pendingSkills,
      restoreText: textPrompt,
      skills: requestSkills,
      threadId: composerThreadId,
    });
  }

  async function startPromptRun(input: {
    attachments: ApiPromptAttachment[];
    collaborationMode: ThreadCollaborationMode;
    prompt: string;
    restoreAttachments?: LocalPromptAttachment[];
    restoreDraftOnFailure?: boolean;
    restoreSkills?: AgentSkill[];
    restoreText?: string;
    skills: ApiPromptSkill[];
    threadId?: string;
  }) {
    const runPreferences = currentRuntimePreferences();
    const queuedThreadId = input.threadId ?? chatStore$.activeThreadId.peek();
    setThreadRunningState(queryClient, queuedThreadId, true);
    let threadId = input.threadId;
    clearQueuedPrompts(queuedThreadId);
    if (queuedThreadId) {
      setQueuedInputsState(queryClient, queuedThreadId, []);
    }
    setConnection("connected");
    clearThreadStatusPoll();
    hapticLightImpact();
    Keyboard.dismiss();

    try {
      if (!threadId) {
        const response = await createThreadMutation.mutateAsync({
          title: titleFromPrompt(input.prompt),
          collaborationMode: input.collaborationMode,
          workspacePath: activeWorkspacePath,
        });
        moveNewThreadCollaborationMode(response.thread.id, input.collaborationMode);
        setThreadDetailState(queryClient, response.thread, response.messages);
        setThreadRunningState(queryClient, response.thread.id, true);
        setActiveThread(response.thread.id);
        threadId = response.thread.id;
      }

      const runThreadId = threadId;
      setThreadCollaborationMode(runThreadId, input.collaborationMode);
      detachCurrentStream();
      const streamGeneration = streamGenerationRef.current + 1;
      streamGenerationRef.current = streamGeneration;
      let receivedStreamEvent = false;
      let sawTerminalStreamEvent = false;
      markStreamActivity();
      const restorePrompt = () => {
        if (!input.restoreDraftOnFailure) {
          return;
        }
        setComposerDraft(input.restoreText ?? input.prompt, runThreadId);
        setComposerAttachments(input.restoreAttachments ?? [], runThreadId);
        setComposerSkills(input.restoreSkills ?? [], runThreadId);
      };
      closeStreamRef.current = streamThreadRun(
        runThreadId,
        {
          attachments: input.attachments,
          prompt: input.prompt,
          skills: input.skills,
          model: runPreferences.model,
          serviceTier: runPreferences.serviceTier,
          reasoningEffort: runPreferences.reasoningEffort,
          runtimeMode: runPreferences.runtimeMode,
          collaborationMode: input.collaborationMode,
        },
        {
          onEvent(event) {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            markStreamActivity();
            receivedStreamEvent = true;
            if (event.type === "thread.state.changed" && event.thread.state === "running") {
              markQueuedPromptStarted(runThreadId, event.thread.lastPrompt);
            }
            handleThreadRunStreamEvent(event, {
              fallbackThreadId: runThreadId,
              applyEvent: (streamEvent) => {
                applyStreamEventToServerState(queryClient, streamEvent);
              },
              onPreviewTarget(previewThreadId, target) {
                setWebPreviewTargetsByThreadId((current) => ({
                  ...current,
                  [previewThreadId]: target,
                }));
              },
              onTerminal(terminalThreadId, terminalEvent) {
                sawTerminalStreamEvent = true;
                completeThreadRunSession({
                  threadId: terminalThreadId,
                  clearQueuedPrompts,
                  onSuccessfulCompletion: recordSuccessfulAiConversationForReviewPrompt,
                  setQueuedInputs: (queuedThreadId, inputs) =>
                    setQueuedInputsState(queryClient, queuedThreadId, inputs),
                  setRunning: (isRunning) =>
                    setThreadRunningState(queryClient, terminalThreadId, isRunning),
                  terminalEvent,
                  refreshUsageStatus,
                });
              },
            });
          },
          onError(caught) {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            closeStreamRef.current?.();
            closeStreamRef.current = undefined;
            if (receivedStreamEvent) {
              clearQueuedPrompts(runThreadId);
              setQueuedInputsState(queryClient, runThreadId, []);
              void recoverThreadAfterStreamLoss(runThreadId, caught.message);
              return;
            }
            void recoverPromptRunAfterEarlyStreamLoss(runThreadId, caught.message, restorePrompt);
          },
          onClose() {
            if (streamGeneration !== streamGenerationRef.current) {
              return;
            }
            closeStreamRef.current = undefined;
            if (!receivedStreamEvent) {
              void recoverPromptRunAfterEarlyStreamLoss(
                runThreadId,
                "Codex Relay stream closed before the request started.",
                restorePrompt,
              );
              return;
            }
            if (!sawTerminalStreamEvent) {
              clearQueuedPrompts(runThreadId);
              setQueuedInputsState(queryClient, runThreadId, []);
              void recoverThreadAfterStreamLoss(
                runThreadId,
                "Codex Relay stream closed before the request completed.",
              );
              return;
            }
            void refreshUsageStatus(runThreadId).catch(() => undefined);
          },
        },
      );
    } catch (caught) {
      syncPairedSessionState();
      if (input.restoreDraftOnFailure) {
        setComposerDraft(input.restoreText ?? input.prompt, threadId);
        setComposerAttachments(input.restoreAttachments ?? [], threadId);
        setComposerSkills(input.restoreSkills ?? [], threadId);
      }
      setConnection("offline", errorMessage(caught));
      setThreadRunningState(queryClient, threadId, false);
      clearQueuedPrompts(input.threadId);
    }
  }

  function implementPlan() {
    if (isRunning) {
      return;
    }

    changeCollaborationMode("default");
    void sendPrompt("Implement plan", "default");
  }

  function addPlanContext(context: string) {
    if (isRunning) {
      return;
    }

    changeCollaborationMode("plan");
    void sendPrompt(context, "plan");
  }

  async function submitInputRequest(request: PendingInputRequest, answers: string[]) {
    hapticLightImpact();
    try {
      await resolveApproval(request.id, {
        answers,
        decision: "approve",
      });
      removePendingInputRequestState(queryClient, request.threadId, request.id);
      setConnection("connected");
      if (!closeStreamRef.current && chatStore$.activeThreadId.peek() === request.threadId) {
        requestThreadStreamReconnect(request.threadId);
      }
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  async function ignoreInputRequest(request: PendingInputRequest) {
    hapticSelection();
    try {
      await resolveApproval(request.id, {
        decision: "cancel",
      });
      removePendingInputRequestState(queryClient, request.threadId, request.id);
      setConnection("connected");
      if (!closeStreamRef.current && chatStore$.activeThreadId.peek() === request.threadId) {
        requestThreadStreamReconnect(request.threadId);
      }
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  async function attachImagesFromGallery() {
    if (isAttachingImagesRef.current) {
      return;
    }

    const composerThreadId = activeThreadId;
    isAttachingImagesRef.current = true;
    setAttachingImages(true);
    try {
      const attachments = getComposerAttachments(composerThreadId);
      const remainingSlots = MAX_IMAGE_ATTACHMENTS - attachments.length;
      if (remainingSlots <= 0) {
        Alert.alert(
          "Image limit reached",
          `Attach up to ${MAX_IMAGE_ATTACHMENTS} images at a time.`,
        );
        return;
      }

      await ImagePicker.requestMediaLibraryPermissionsAsync();

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ["images"],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.72,
        selectionLimit: remainingSlots,
        shouldDownloadFromNetwork: true,
      });

      if (result.canceled) {
        return;
      }

      let acceptedPayloadBytes = 0;
      let skippedImages = 0;
      const selectedAssets = result.assets.flatMap((asset) => {
        const payloadBytes = asset.fileSize ?? 0;
        if (acceptedPayloadBytes + payloadBytes > MAX_ATTACHMENT_PAYLOAD_BYTES) {
          skippedImages += 1;
          return [];
        }

        acceptedPayloadBytes += payloadBytes;
        return [asset];
      });

      if (selectedAssets.length === 0) {
        Alert.alert("Image attach failed", "Could not read the selected image.");
        return;
      }

      const uploaded = await uploadImageAttachments(
        selectedAssets.map((asset, index) => ({
          mimeType: asset.mimeType ?? "image/jpeg",
          name: asset.fileName ?? `image-${index + 1}.jpg`,
          uri: asset.uri,
        })),
      );

      const nextAttachments = uploaded.attachments.flatMap((attachment, index) => {
        const asset = selectedAssets[index];
        if (!asset) {
          skippedImages += 1;
          return [];
        }
        const mimeType = asset.mimeType ?? "image/jpeg";
        return {
          id: `${Date.now()}-${index}-${asset.assetId ?? asset.uri}`,
          mimeType: attachment.mimeType ?? mimeType,
          name: attachment.name ?? asset.fileName ?? undefined,
          path: attachment.path,
          uri: asset.uri,
          url: attachment.url,
        };
      });

      if (nextAttachments.length === 0) {
        Alert.alert("Image attach failed", "Could not read the selected image.");
        return;
      }

      appendComposerAttachments(nextAttachments, composerThreadId);
      if (skippedImages > 0) {
        Alert.alert(
          "Some images were skipped",
          "Choose fewer or smaller images so the chat stays stable.",
        );
      }
    } catch (caught) {
      Alert.alert("Image attach failed", errorMessage(caught));
    } finally {
      isAttachingImagesRef.current = false;
      setAttachingImages(false);
    }
  }

  async function removeQueuedPrompt(item: QueuedComposerPrompt) {
    if (!activeThreadId) {
      return;
    }
    try {
      await removeQueuedThreadInputMutation.mutateAsync({
        inputId: item.id,
        threadId: activeThreadId,
      });
      removeQueuedPromptFromState(item);
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  async function restoreQueuedPrompt(item: QueuedComposerPrompt) {
    if (!activeThreadId) {
      return;
    }
    try {
      await removeQueuedThreadInputMutation.mutateAsync({
        inputId: item.id,
        threadId: activeThreadId,
      });
      removeQueuedPromptFromState(item);
      const draft = getComposerDraft(activeThreadId);
      setComposerDraft(
        draft.trim() ? `${draft.trim()}\n${item.prompt}` : item.prompt,
        activeThreadId,
      );
      if (item.attachments.length > 0) {
        setComposerAttachments(
          [
            ...getComposerAttachments(activeThreadId),
            ...item.attachments.map(localAttachmentFromPromptAttachment),
          ],
          activeThreadId,
        );
      }
      if (item.skills.length > 0) {
        setComposerSkills(
          mergeAgentSkills(
            getComposerSkills(activeThreadId),
            agentSkillsFromPromptSkills(item.skills, skillsQuery.data?.skills ?? []),
          ),
          activeThreadId,
        );
      }
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  async function steerQueuedPrompt(item: QueuedComposerPrompt) {
    if (!activeThreadId) {
      return;
    }
    try {
      await steerQueuedThreadInputMutation.mutateAsync({
        inputId: item.id,
        threadId: activeThreadId,
      });
      setConnection("connected");
      hapticMediumImpact();
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  function stopRun() {
    clearThreadStatusPoll();
    detachCurrentStream();
    if (activeThreadId) {
      interruptThreadRun(activeThreadId).catch(() => undefined);
    }
    setThreadRunningState(queryClient, activeThreadId, false);
    clearQueuedPrompts();
    if (activeThreadId) {
      setQueuedInputsState(queryClient, activeThreadId, []);
    }
    hapticWarning();
  }

  function saveThreadGoalObjective(objective: string) {
    if (!activeThreadId) {
      return;
    }
    updateThreadGoalMutation.mutate({ threadId: activeThreadId, objective });
    hapticSelection();
  }

  function toggleThreadGoalPause() {
    if (!activeThreadId || !activeThread?.goal) {
      return;
    }
    updateThreadGoalMutation.mutate({
      threadId: activeThreadId,
      status: activeThread.goal.status === "paused" ? "active" : "paused",
    });
    hapticMediumImpact();
  }

  function clearThreadGoal() {
    if (!activeThreadId) {
      return;
    }
    clearThreadGoalMutation.mutate({ threadId: activeThreadId });
    hapticWarning();
  }

  async function createNewThread() {
    if (isRunning) {
      return;
    }

    const newThreadCollaborationMode = collaborationMode;
    try {
      const response = await createThreadMutation.mutateAsync({
        title: "New chat",
        collaborationMode: newThreadCollaborationMode,
        workspacePath: activeWorkspacePath,
      });
      setThreadCollaborationMode(response.thread.id, newThreadCollaborationMode);
      setThreadDetailState(queryClient, response.thread, response.messages);
      setActiveThread(response.thread.id);
      clearQueuedPrompts();
      setQueuedInputsState(queryClient, response.thread.id, []);
      setConnection("connected");
      hapticSuccess();
    } catch (caught) {
      syncPairedSessionState();
      setConnection("offline", errorMessage(caught));
    }
  }

  function currentRuntimePreferences(): RuntimePreferences {
    const thread = activeThread;
    const targetWorkspacePath = thread?.cwd ?? workspacePath;
    const cachedStatus =
      queryClient.getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.status>>>(
        serverStateKeys.status(),
      ) ?? statusQuery.data;
    const cachedWorkspacePreferences = workspacePreferencesForPath(
      targetWorkspacePath,
      cachedStatus,
    );
    const optimisticWorkspacePreferences = targetWorkspacePath
      ? optimisticRuntimePreferencesByWorkspacePath[targetWorkspacePath]
      : optimisticRuntimePreferences;
    return runtimePreferencesWithAvailableServiceTier(
      runtimePreferencesForWorkspace(
        optimisticWorkspacePreferences ?? cachedWorkspacePreferences,
        cachedStatus?.preferences ?? { runtimeMode: "default" },
      ),
    );
  }

  function reasoningEffortForModel(
    modelId: string | undefined,
    preferredReasoningEffort: ReasoningEffort | undefined,
  ) {
    const model = models.find((candidate) => candidate.model === modelId);
    const supported = model?.supportedReasoningEfforts ?? [];
    if (supported.length === 0) {
      return undefined;
    }
    if (preferredReasoningEffort && supported.includes(preferredReasoningEffort)) {
      return preferredReasoningEffort;
    }
    if (model?.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
      return model.defaultReasoningEffort;
    }
    return supported.includes("medium") ? "medium" : supported[0];
  }

  function serviceTierForModel(
    modelId: string | undefined,
    preferredServiceTier: string | undefined,
  ) {
    const model = models.find((candidate) => candidate.model === modelId);
    if (!model?.serviceTiers.some((tier) => tier.id === preferredServiceTier)) {
      return undefined;
    }
    return preferredServiceTier;
  }

  function runtimePreferencesWithAvailableServiceTier(preferences: RuntimePreferences) {
    const modelId = preferences.model ?? models[0]?.model;
    if (!preferences.serviceTier || serviceTierForModel(modelId, preferences.serviceTier)) {
      return preferences;
    }
    return {
      ...preferences,
      serviceTier: undefined,
    };
  }

  function commitRuntimePreferences(preferences: RuntimePreferences) {
    const targetWorkspacePath = activeWorkspacePath ?? workspacePath;
    if (targetWorkspacePath) {
      setOptimisticRuntimePreferencesByWorkspacePath((current) => ({
        ...current,
        [targetWorkspacePath]: preferences,
      }));
      setWorkspaceRuntimePreferencesState(queryClient, targetWorkspacePath, preferences);
    } else {
      setOptimisticRuntimePreferences(preferences);
      setRuntimePreferencesState(queryClient, preferences);
    }
    updateRuntimePreferencesMutation.mutate({
      model: preferences.model ?? null,
      serviceTier: preferences.serviceTier ?? null,
      reasoningEffort: preferences.reasoningEffort ?? null,
      runtimeMode: preferences.runtimeMode,
      ...(targetWorkspacePath ? { workspacePath: targetWorkspacePath } : {}),
    });
  }

  function changeRuntimeMode(nextRuntimeMode: RuntimeMode) {
    const currentPreferences = currentRuntimePreferences();
    commitRuntimePreferences({
      ...currentPreferences,
      runtimeMode: nextRuntimeMode,
    });
  }

  function changeSelectedModel(model: string) {
    const currentPreferences = currentRuntimePreferences();
    const serviceTier = serviceTierForModel(model, currentPreferences.serviceTier);
    commitRuntimePreferences({
      ...currentPreferences,
      model,
      serviceTier,
      reasoningEffort: reasoningEffortForModel(model, currentPreferences.reasoningEffort),
    });
  }

  function changeSelectedServiceTier(serviceTier: string | undefined) {
    const currentPreferences = currentRuntimePreferences();
    const model = serviceTier
      ? (currentPreferences.model ?? models[0]?.model)
      : currentPreferences.model;
    commitRuntimePreferences({
      ...currentPreferences,
      ...(model ? { model } : {}),
      serviceTier: serviceTierForModel(model, serviceTier),
    });
  }

  function changeSelectedReasoningEffort(reasoningEffort: ReasoningEffort | undefined) {
    const currentPreferences = currentRuntimePreferences();
    commitRuntimePreferences({
      ...currentPreferences,
      reasoningEffort,
    });
  }

  function workspacePreferencesForPath(
    targetWorkspacePath: string | undefined,
    status: Awaited<ReturnType<typeof serverStateQueryFns.status>> | undefined,
  ) {
    if (!targetWorkspacePath) {
      return undefined;
    }
    const workspacePreferences =
      status?.runtimePreferencesByWorkspacePath[targetWorkspacePath] ??
      (status?.workspacePath === targetWorkspacePath ? status.preferences : undefined) ??
      readCachedWorkspaceRuntimePreferences(getCodexRelayServerUrl(), targetWorkspacePath);
    return workspacePreferences;
  }

  function openThreadDrawer() {
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      drawerNavigation.openDrawer?.();
    });
    hapticMediumImpact();
  }

  function toggleThreadSidebar() {
    Keyboard.dismiss();
    toggleSidebar();
    hapticMediumImpact();
  }

  function toggleWorkspacePreview() {
    Keyboard.dismiss();
    const nextVisible = !isWidePreviewVisible;
    setWidePreviewVisible(nextVisible);
    setActivePagerPage(nextVisible ? 1 : 0);
    hapticMediumImpact();
  }

  const onWideLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setWideLayoutWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  useEffect(() => {
    if (wideLayoutWidth <= 0) {
      return;
    }

    setPreviewPaneWidth((current) => clampPreviewPaneWidth(current, wideLayoutWidth));
  }, [wideLayoutWidth]);

  const clampedPreviewPaneWidth = clampPreviewPaneWidth(previewPaneWidth, wideLayoutWidth);
  const showsWidePreviewPane = usesWideLayout && isWidePreviewVisible;
  const wideChatPaneWidth =
    wideLayoutWidth > 0
      ? Math.max(
          MIN_CHAT_PANE_WIDTH,
          wideLayoutWidth -
            (showsWidePreviewPane ? clampedPreviewPaneWidth + PREVIEW_RESIZE_HANDLE_WIDTH : 0),
        )
      : 0;

  const beginPreviewResize = useCallback(() => {
    previewResizeStartWidthRef.current = clampedPreviewPaneWidth;
    hapticSelection();
  }, [clampedPreviewPaneWidth]);

  const resizePreview = useCallback(
    (translationX: number) => {
      setPreviewPaneWidth(
        clampPreviewPaneWidth(previewResizeStartWidthRef.current - translationX, wideLayoutWidth),
      );
    },
    [wideLayoutWidth],
  );

  const previewResizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(beginPreviewResize)
        .onUpdate((event) => resizePreview(event.translationX)),
    [beginPreviewResize, resizePreview],
  );

  const showMessageCopiedToast = useCallback(() => {
    copyToastIdRef.current += 1;
    setCopyToast({ id: copyToastIdRef.current });
  }, []);

  const isPairing = isPastePairing || isHandlingScan;
  const isWorkspacePreviewVisible = usesWideLayout ? showsWidePreviewPane : activePagerPage === 1;
  const chatPane = (
    <ChatShell
      banner={
        <Animated.View layout={chatBannerLayoutTransition} style={styles.bannerStack}>
          <ConnectionBanner
            connection={connection}
            error={error}
            hasPairedSession={hasPairedSession}
            serverUrl={serverUrl}
            workspacePath={workspacePath}
            onRefresh={refresh}
            onScanConnect={openScanner}
          />
        </Animated.View>
      }
      composerDisabled={connection === "offline"}
      composerInputEditable={connection !== "offline" || hasPairedSession}
      composerFocusRecoveryKey={connection}
      collaborationMode={collaborationMode}
      composerFocusRequestKey={composerFocusRequestKey}
      composerFooter={
        <ChatControls
          models={models}
          runtimeMode={runtimeMode}
          selectedReasoningEffort={selectedReasoningEffort}
          selectedServiceTier={selectedServiceTier}
          selectedModel={selectedModel}
          onRuntimeModeChange={changeRuntimeMode}
          onSelectedReasoningEffortChange={changeSelectedReasoningEffort}
          onSelectedServiceTierChange={changeSelectedServiceTier}
          onSelectedModelChange={changeSelectedModel}
        />
      }
      contextWindowUsage={contextWindowUsage}
      goal={activeThread?.goal ?? null}
      inputNativeID={CHAT_INPUT_NATIVE_ID}
      isAttachingImage={isAttachingImages}
      isLoadingMessages={isLoadingMessages}
      isRunning={isRunning}
      leadingAction={{
        icon: usesExpandedSidebar ? (isSidebarVisible ? "sidebarHide" : "sidebarShow") : "menu",
        label: usesExpandedSidebar
          ? isSidebarVisible
            ? "Hide threads"
            : "Show threads"
          : "Open threads",
        onPress: usesExpandedSidebar ? toggleThreadSidebar : openThreadDrawer,
      }}
      messages={messages}
      onAttachImage={attachImagesFromGallery}
      onCancel={stopRun}
      onCollaborationModeChange={changeCollaborationMode}
      onAddPlanContext={addPlanContext}
      onImplementPlan={implementPlan}
      onIgnoreInputRequest={(request) => void ignoreInputRequest(request)}
      onMessageCopied={showMessageCopiedToast}
      onOpenMarkdownAttachment={openMarkdownAttachmentPreview}
      onRefreshUsageStatus={() => refreshUsageStatus()}
      onSubmitInputRequest={(request, answers) => void submitInputRequest(request, answers)}
      onRemoveQueuedPrompt={(item) => void removeQueuedPrompt(item)}
      onRestoreQueuedPrompt={(item) => void restoreQueuedPrompt(item)}
      onSend={() => sendPrompt()}
      onSteerQueuedPrompt={(item) => void steerQueuedPrompt(item)}
      onClearGoal={clearThreadGoal}
      onSaveGoal={saveThreadGoalObjective}
      onToggleGoalPause={toggleThreadGoalPause}
      pendingInputRequest={pendingInputRequest}
      queuedPrompts={queuedPrompts}
      rateLimitBuckets={rateLimitBuckets}
      skills={skills}
      skillsLoadState={skillsLoadState}
      subtitle={activeWorkspacePath ?? "codex-relay"}
      threadId={activeThreadId}
      title={activeThread?.title ?? "Codex Relay"}
      trailingActions={[
        {
          disabled: isRunning,
          icon: "newThread",
          label: "New thread",
          onPress: createNewThread,
        },
        {
          icon: usesWideLayout ? (isWidePreviewVisible ? "previewHide" : "preview") : "preview",
          label: usesWideLayout
            ? isWidePreviewVisible
              ? "Hide workspace preview"
              : "Show workspace preview"
            : "Workspace preview",
          onPress: usesWideLayout
            ? toggleWorkspacePreview
            : () =>
                openWorkspacePreview({
                  protocol: WORKSPACE_PREVIEW_OPEN_PROTOCOL,
                  tab: "git",
                  workspacePath: activeWorkspacePath,
                }),
        },
      ]}
      workspacePath={activeWorkspacePath}
    />
  );
  const workspacePreviewPane = (
    <WorkspacePreviewSurface
      key={activeThreadId ?? "no-thread"}
      isFocused={isWorkspacePreviewVisible}
      isRunning={isRunning}
      isLoadingChanges={isLoadingChanges}
      serverUrl={serverUrl}
      workspaceChanges={workspaceChanges}
      workspaceChangesError={workspaceChangesError}
      workspacePath={activeWorkspacePath}
      markdownPreviewTarget={markdownPreviewTarget}
      webPreviewTarget={activeWebPreviewTarget}
      onClose={closeWorkspacePreview}
      showCloseButton
      onCheckoutBranch={checkoutBranch}
      onCommitPush={commitPush}
      onCreatePullRequest={createPullRequest}
      onRefreshChanges={loadWorkspaceChanges}
    />
  );

  return (
    <>
      {usesWideLayout ? (
        <View onLayout={onWideLayout} style={styles.wideLayout}>
          <View
            style={[
              styles.wideChatPane,
              wideLayoutWidth > 0 ? { width: wideChatPaneWidth } : styles.wideChatPaneInitial,
            ]}
          >
            {chatPane}
          </View>
          {showsWidePreviewPane ? (
            <>
              <GestureDetector gesture={previewResizeGesture}>
                <Animated.View
                  accessibilityLabel="Resize workspace preview"
                  style={styles.previewResizeHandle}
                >
                  <View style={styles.previewResizeGrip} />
                </Animated.View>
              </GestureDetector>
              <View
                style={[
                  styles.widePreviewPane,
                  wideLayoutWidth > 0
                    ? { width: clampedPreviewPaneWidth }
                    : styles.widePreviewPaneInitial,
                ]}
              >
                {workspacePreviewPane}
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <PagerView
          ref={pagerRef}
          initialPage={activePagerPage}
          onPageSelected={(event) => setActivePagerPage(event.nativeEvent.position)}
          style={styles.pager}
        >
          <View key="chat" collapsable={false} style={styles.pagerPage}>
            {chatPane}
          </View>
          <View key="changes" collapsable={false} style={styles.pagerPage}>
            {workspacePreviewPane}
          </View>
        </PagerView>
      )}
      {copyToast ? (
        <AppToast
          key={copyToast.id}
          durationMs={COPY_TOAST_VISIBLE_MS}
          title="Copied to clipboard"
          message="Message Markdown copied."
          visible
          onDismiss={() =>
            setCopyToast((current) => (current?.id === copyToast.id ? undefined : current))
          }
        />
      ) : null}
      <Modal
        animationType="slide"
        onRequestClose={() => setPastePairOpen(false)}
        presentationStyle="pageSheet"
        visible={isPastePairOpen}
      >
        <SafeAreaView edges={["top", "left", "right"]} style={styles.manualScreen}>
          <View style={styles.manualPanel}>
            <View style={styles.manualHeader}>
              <ThemedText type="smallBold" style={styles.manualTitle}>
                {pasteApprovalCode ? "Approve this phone" : "Pairing"}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close pairing status"
                onPress={() => setPastePairOpen(false)}
                style={({ pressed }) => [styles.manualButtonSecondary, pressed && styles.pressed]}
              >
                <ThemedText type="smallBold">Close</ThemedText>
              </Pressable>
            </View>
            <View style={styles.manualFields}>
              <ThemedText type="small" themeColor="textSecondary">
                {pasteApprovalCode
                  ? "Finish pairing from the Terminal window where codex-relay is running."
                  : "QR recognized. Connecting to the relay..."}
              </ThemedText>
              {pasteApprovalCode ? (
                <View style={styles.manualApproval}>
                  <ThemedText type="smallBold">Approval code</ThemedText>
                  <ThemedText style={styles.manualApprovalCode}>{pasteApprovalCode}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Run this on your computer:
                  </ThemedText>
                  <ThemedText style={styles.manualApprovalCommand}>
                    {approvalCommand(pasteApprovalCode, pasteApprovalServerUrl)}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.manualStatus}>
              <ThemedText type="smallBold" style={styles.manualStatusText}>
                {pasteApprovalCode ? "Waiting for approval" : isPairing ? "Pairing" : "Ready"}
              </ThemedText>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
        presentationStyle="fullScreen"
        visible={isScannerOpen}
      >
        <View style={styles.scannerScreen}>
          <CameraView
            active={isScannerOpen}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            facing="back"
            onBarcodeScanned={isHandlingScan ? undefined : handleBarcodeScanned}
            style={styles.camera}
          />
          <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerOverlay}>
            <View style={styles.scannerHeader}>
              <ThemedText type="smallBold" style={styles.scannerTitle}>
                {isHandlingScan ? "Pairing" : "Scan connection QR"}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close QR scanner"
                onPress={() => setScannerOpen(false)}
                style={({ pressed }) => [styles.scannerClose, pressed && styles.pressed]}
              >
                <ThemedText type="smallBold">Close</ThemedText>
              </Pressable>
            </View>
            <View style={styles.scannerFooter}>
              <ThemedText type="smallBold" style={styles.scannerMessage}>
                {scannerMessage}
              </ThemedText>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function dismissKeyboardForWorkspacePreview() {
  Keyboard.dismiss();
  void KeyboardController.dismiss().catch(() => undefined);
}

function promptAttachmentsForRequest(attachments: LocalPromptAttachment[]): ApiPromptAttachment[] {
  return attachments.map(({ mimeType, name, path, url }) => ({
    mimeType,
    name,
    path,
    type: "image" as const,
    url,
  }));
}

function workspaceRelativeMarkdownPath(path: string, workspacePath: string | undefined) {
  const normalizedPath = decodeAttachmentPath(path)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  const normalizedWorkspacePath = workspacePath?.replace(/\\/g, "/").replace(/\/+$/, "");

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedPath)) {
    return undefined;
  }

  if (!normalizedPath.startsWith("/")) {
    return normalizedPath;
  }

  if (normalizedWorkspacePath && normalizedPath.startsWith(`${normalizedWorkspacePath}/`)) {
    return normalizedPath.slice(normalizedWorkspacePath.length + 1);
  }

  return undefined;
}

function decodeAttachmentPath(path: string) {
  if (!path.startsWith("file://")) {
    return path;
  }

  try {
    return decodeURIComponent(new URL(path).pathname);
  } catch {
    return path;
  }
}

function localAttachmentFromPromptAttachment(
  attachment: ApiPromptAttachment,
  index: number,
): LocalPromptAttachment {
  const uri = attachment.url ? resolveCodexRelayUrl(attachment.url) : (attachment.path ?? "");
  return {
    id: `queued-${Date.now()}-${index}`,
    mimeType: attachment.mimeType,
    name: attachment.name,
    path: attachment.path ?? uri,
    uri,
    url: attachment.url,
  };
}

function promptSkillsForRequest(skills: AgentSkill[]): ApiPromptSkill[] {
  return skills.map(({ name, path }) => ({ name, path }));
}

function promptSkillsForRequestFromPrompt(
  prompt: string,
  selectedSkills: AgentSkill[],
  availableSkills: AgentSkill[],
): ApiPromptSkill[] {
  const candidates = mergeAgentSkills(selectedSkills, availableSkills);
  const skillsInPrompt = agentSkillsFromPromptMarkdown(prompt, candidates, selectedSkills);
  return promptSkillsForRequest(mergeAgentSkills(skillsInPrompt, selectedSkills));
}

function agentSkillsFromPromptMarkdown(
  prompt: string,
  availableSkills: AgentSkill[],
  selectedSkills: AgentSkill[],
) {
  const orderedMatches: Array<{ index: number; skill: AgentSkill }> = [];
  const skillByPath = new Map(availableSkills.map((skill) => [skill.path, skill]));
  const linkRegex = /\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g;
  let cursor = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(prompt))) {
    orderedMatches.push(
      ...agentSkillTextMatches(prompt.slice(cursor, linkMatch.index), cursor, selectedSkills),
    );
    const label = linkMatch[1] ?? "";
    const url = linkMatch[2] ?? "";
    const skill = skillFromMarkdownMention(label, url, skillByPath);
    if (skill) {
      orderedMatches.push({ index: linkMatch.index, skill });
    }
    cursor = linkMatch.index + linkMatch[0].length;
  }
  orderedMatches.push(...agentSkillTextMatches(prompt.slice(cursor), cursor, selectedSkills));

  const seen = new Set<string>();
  return orderedMatches
    .sort((left, right) => left.index - right.index)
    .flatMap(({ skill }) => {
      const key = agentSkillKey(skill);
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [skill];
    });
}

function agentSkillTextMatches(segment: string, offset: number, skills: AgentSkill[]) {
  const matches: Array<{ index: number; skill: AgentSkill }> = [];
  for (const skill of skills) {
    for (const candidate of promptSkillMentionTextCandidates(skill)) {
      if (!candidate.startsWith("$")) {
        continue;
      }
      const index = findStandaloneToken(segment, candidate);
      if (index !== -1) {
        matches.push({ index: offset + index, skill });
        break;
      }
    }
  }
  return matches;
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

function unescapeMarkdownText(value: string) {
  return value.replace(/\\([\\[\]])/g, "$1");
}

function findStandaloneToken(value: string, token: string) {
  const match = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=$|\\s)`).exec(value);
  return match ? match.index + (match[1]?.length ?? 0) : -1;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function agentSkillsFromPromptSkills(skills: ApiPromptSkill[], availableSkills: AgentSkill[]) {
  return skills.map((skill) => {
    const availableSkill = availableSkills.find(
      (candidate) => candidate.path === skill.path || candidate.name === skill.name,
    );
    if (availableSkill) {
      return availableSkill;
    }
    return {
      description: undefined,
      displayName: promptSkillDisplayName(skill),
      id: skill.path,
      name: skill.name,
      path: skill.path,
      source: "workspace" as const,
      sourceLabel: "skill",
    };
  });
}

function subscribeToPairingLinks(onUrl: (url: string) => void) {
  const urlListener = Linking.addEventListener("url", (event) => {
    onUrl(event.url);
  });
  return () => urlListener.remove();
}

function mergeAgentSkills(currentSkills: AgentSkill[], nextSkills: AgentSkill[]) {
  const seen = new Set(currentSkills.map(agentSkillKey));
  const merged = [...currentSkills];
  for (const skill of nextSkills) {
    const key = agentSkillKey(skill);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(skill);
  }
  return merged;
}

function agentSkillKey(skill: Pick<AgentSkill, "name" | "path">) {
  return `${skill.name}:${skill.path}`;
}

function titleFromPrompt(prompt: string) {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function skillQueryLoadState(query: {
  data?: { skills: AgentSkill[] };
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}) {
  if (query.data) {
    return "loaded" as const;
  }
  if (query.isError || query.error) {
    return "failed" as const;
  }
  return query.isLoading || query.isFetching ? ("loading" as const) : ("idle" as const);
}

function indexThreadsById(threads: ThreadSummary[]) {
  const threadsById: Record<string, ThreadSummary> = {};
  for (const thread of threads) {
    threadsById[thread.id] = thread;
  }
  return threadsById;
}

function commitMessageForWorkspaceChanges(changes: WorkspaceChangesResponse) {
  const changedFileCount =
    changes.files.length > 0 ? changes.files.length : changes.stats.filesChanged;

  if (changedFileCount === 1) {
    const filePath = changes.files[0]?.path;
    if (filePath) {
      return `chore: update ${basename(filePath)}`.slice(0, 240);
    }
  }

  if (changedFileCount > 1) {
    return `chore: update ${changedFileCount} workspace files`;
  }

  return "chore: update workspace changes";
}

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to reach the Codex Relay server.";
}

function scannerPairingFailureMessage(error: unknown) {
  return isPairingQrPayloadError(error)
    ? "This is not the Codex Relay QR. Scan the QR shown on your computer."
    : "Could not connect. Use the same Wi-Fi or turn on Tailscale, then scan again.";
}

const invalidPairingQrAlertMessage =
  "Run npx codex-relay@latest on your computer, then scan the QR shown there.";

const pairingFailureAlertMessage =
  "Use the same Wi-Fi on your phone and computer. If that is not possible, turn on Tailscale on both devices and scan again.";

async function safeAsyncValue<T>(callback: () => Promise<T>) {
  try {
    return await callback();
  } catch {
    return undefined;
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function approvalCommand(approvalCode: string, serverUrl?: string) {
  const port = approvalPort(serverUrl);
  return port && port !== "8787"
    ? `PORT=${port} npx codex-relay@latest approve ${approvalCode}`
    : `npx codex-relay@latest approve ${approvalCode}`;
}

function approvalMessage(approvalCode: string, serverUrl?: string) {
  return `Run ${approvalCommand(approvalCode, serverUrl)} in the server terminal.`;
}

function approvalPort(serverUrl?: string) {
  if (!serverUrl) {
    return undefined;
  }

  try {
    return new URL(serverUrl).port;
  } catch {
    return undefined;
  }
}

function readScannedPayload(result: unknown) {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const nativeEvent = record.nativeEvent;
  if (nativeEvent && typeof nativeEvent === "object") {
    return readScannedPayload(nativeEvent);
  }

  return typeof record.data === "string"
    ? record.data
    : typeof record.raw === "string"
      ? record.raw
      : undefined;
}

function isBarcodeScannerCancellation(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("cancel");
}

function clampPreviewPaneWidth(value: number, layoutWidth: number) {
  if (layoutWidth <= 0) {
    return value;
  }

  const availableWidth = Math.max(0, layoutWidth - PREVIEW_RESIZE_HANDLE_WIDTH);
  const minPreviewWidth = Math.min(MIN_PREVIEW_PANE_WIDTH, availableWidth * 0.45);
  const minChatWidth = Math.min(MIN_CHAT_PANE_WIDTH, availableWidth * 0.55);
  const maxPreviewWidth = Math.max(minPreviewWidth, availableWidth - minChatWidth);
  return Math.min(maxPreviewWidth, Math.max(minPreviewWidth, value));
}

const chatBannerLayoutTransition = LinearTransition.duration(180);

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  pager: {
    flex: 1,
  },
  pagerPage: {
    flex: 1,
  },
  wideLayout: {
    backgroundColor: Colors.dark.background,
    flex: 1,
    flexDirection: "row",
  },
  wideChatPane: {
    minWidth: 0,
  },
  wideChatPaneInitial: {
    flex: 1,
  },
  widePreviewPane: {
    minWidth: 0,
  },
  widePreviewPaneInitial: {
    flex: 1.08,
  },
  previewResizeGrip: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: 1,
    height: 44,
    marginLeft: -1,
    opacity: 0.72,
    width: 2,
  },
  previewResizeHandle: {
    alignItems: "flex-start",
    borderLeftColor: "rgba(255, 255, 255, 0.08)",
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    width: PREVIEW_RESIZE_HANDLE_WIDTH,
  },
  bannerStack: {
    flexShrink: 0,
  },
  scannerScreen: {
    backgroundColor: Colors.dark.background,
    flex: 1,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: "space-between",
  },
  scannerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  scannerTitle: {
    backgroundColor: "rgba(42, 42, 42, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  scannerClose: {
    backgroundColor: "rgba(42, 42, 42, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  scannerFooter: {
    alignItems: "center",
    gap: Spacing.three,
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.four,
  },
  scannerMessage: {
    backgroundColor: "rgba(42, 42, 42, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    textAlign: "center",
  },
  manualScreen: {
    backgroundColor: Colors.dark.background,
    flex: 1,
  },
  manualPanel: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  manualHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  manualTitle: {
    fontSize: 20,
    lineHeight: 26,
  },
  manualFields: {
    gap: Spacing.two,
  },
  manualApproval: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  manualApprovalCode: {
    color: Colors.dark.text,
    fontFamily: Fonts.monoMedium,
    fontSize: 24,
    lineHeight: 30,
  },
  manualApprovalCommand: {
    color: Colors.dark.text,
    fontFamily: Fonts.monoMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  manualButtonSecondary: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(132, 145, 165, 0.24)",
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  manualStatus: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
  },
  manualStatusText: {
    fontSize: 14,
    lineHeight: 18,
  },
});
