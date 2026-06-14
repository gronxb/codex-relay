import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useSelector } from "@legendapp/state/react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ThreadSummary } from "codex-relay/api-schema";
import { router } from "expo-router";
import type { Drawer } from "expo-router/drawer";
import type { ComponentProps } from "react";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  Alert,
  InteractionManager,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { FaGithub } from "@/assets/icons/fa";
import { SheetActionRow } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { codexRelayRepositoryUrl } from "@/constants/links";
import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hasCodexRelaySession } from "@/lib/codex-relay-api";
import { hapticLightImpact, hapticSelection, hapticSuccess } from "@/lib/haptics";
import {
  archiveThreadServerState,
  createThreadServerState,
  fetchThreadState,
  fetchThreadsState,
  fetchWorkspaceDirectoriesState,
  optimisticallyArchiveThreadState,
  restoreOptimisticArchiveThreadState,
  serverStateKeys,
  serverStateQueryFns,
  setThreadDetailState,
  setThreadRunningState,
  setThreadsState,
} from "@/lib/server-state";
import { evaluateRelayVersion, type RelayVersionCompatibility } from "@/lib/version-policy";
import {
  chatStore$,
  requestThreadStreamReconnect,
  setActiveThread,
  setConnection,
  setHasPairedSession,
  setThreadMessagesLoading,
} from "@/state/chat-store";

type DrawerRow =
  | {
      id: string;
      kind: "project";
      projectKey: string;
      title: string;
      workspacePath?: string;
    }
  | { id: string; kind: "thread"; projectKey: string; thread: ThreadSummary }
  | { id: string; kind: "more"; hiddenCount: number; projectKey: string };

type WorkspaceBrowser = {
  directories: { name: string; path: string }[];
  parentPath: string | null;
  path: string;
  rootPath: string;
};

type WorkspaceBrowserRow =
  | { id: string; kind: "parent"; path: string }
  | { id: string; kind: "directory"; name: string; path: string };

type ThreadDrawerUiState = {
  canRenderThreadList: boolean;
  expandedProjects: Record<string, boolean>;
  isCreatingThread: boolean;
  isLoadingWorkspaces: boolean;
  isRefreshingProjects: boolean;
  isWorkspaceSheetVisible: boolean;
  searchQuery: string;
  workspaceBrowser?: WorkspaceBrowser;
};

type ThreadDrawerUiAction =
  | { type: "set-can-render-thread-list"; value: boolean }
  | { type: "set-creating-thread"; value: boolean }
  | { type: "set-loading-workspaces"; value: boolean }
  | { type: "set-refreshing-projects"; value: boolean }
  | { type: "set-search-query"; value: string }
  | { type: "set-workspace-browser"; value: WorkspaceBrowser }
  | { type: "set-workspace-sheet-visible"; value: boolean }
  | { type: "toggle-project"; projectKey: string };

type ThreadDrawerContentProps = Parameters<
  NonNullable<ComponentProps<typeof Drawer>["drawerContent"]>
>[0] & {
  isPermanent?: boolean;
  onSidebarResize?: (translationX: number) => void;
  onSidebarResizeStart?: () => void;
  showResizeHandle?: boolean;
};

type ThreadDrawerNavigation = ThreadDrawerContentProps["navigation"];

const collapsedProjectThreadCount = 5;
const drawerListDrawDistance = 96;
const drawerRowEstimatedSize = 40;
const drawerListIdleTimeoutMs = 180;
const workspaceBrowserRowEstimatedSize = 42;
const initialThreadDrawerUiState: ThreadDrawerUiState = {
  canRenderThreadList: false,
  expandedProjects: {},
  isCreatingThread: false,
  isLoadingWorkspaces: false,
  isRefreshingProjects: false,
  isWorkspaceSheetVisible: false,
  searchQuery: "",
};

function threadDrawerUiReducer(
  state: ThreadDrawerUiState,
  action: ThreadDrawerUiAction,
): ThreadDrawerUiState {
  switch (action.type) {
    case "set-can-render-thread-list":
      return { ...state, canRenderThreadList: action.value };
    case "set-creating-thread":
      return { ...state, isCreatingThread: action.value };
    case "set-loading-workspaces":
      return { ...state, isLoadingWorkspaces: action.value };
    case "set-refreshing-projects":
      return { ...state, isRefreshingProjects: action.value };
    case "set-search-query":
      return { ...state, searchQuery: action.value };
    case "set-workspace-browser":
      return { ...state, workspaceBrowser: action.value };
    case "set-workspace-sheet-visible":
      return { ...state, isWorkspaceSheetVisible: action.value };
    case "toggle-project":
      return {
        ...state,
        expandedProjects: {
          ...state.expandedProjects,
          [action.projectKey]: !state.expandedProjects[action.projectKey],
        },
      };
  }
}

export function ThreadDrawerContent(props: ThreadDrawerContentProps) {
  const drawerStatus = getDrawerStatus(props.state);
  const isDrawerVisible = props.isPermanent || drawerStatus === "open";
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const createThreadMutation = useMutation({
    mutationFn: (body: Parameters<typeof createThreadServerState>[1]) =>
      createThreadServerState(queryClient, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.threads() });
    },
  });
  const archiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => archiveThreadServerState(queryClient, threadId),
    onMutate: async (threadId) => {
      const previousActiveThreadId = chatStore$.activeThreadId.peek();
      const currentThreads =
        queryClient.getQueryData<Awaited<ReturnType<typeof serverStateQueryFns.threads>>>(
          serverStateKeys.threads(),
        )?.threads ?? [];
      const nextActiveThreadId = currentThreads.find((thread) => thread.id !== threadId)?.id;
      const snapshot = await optimisticallyArchiveThreadState(queryClient, threadId);
      if (previousActiveThreadId === threadId) {
        setActiveThread(nextActiveThreadId);
      }
      return { nextActiveThreadId, previousActiveThreadId, snapshot };
    },
    onError: (_caught, _threadId, context) => {
      restoreOptimisticArchiveThreadState(queryClient, context?.snapshot);
      if (
        context?.previousActiveThreadId &&
        chatStore$.activeThreadId.peek() === context.nextActiveThreadId
      ) {
        setActiveThread(context.previousActiveThreadId);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.threads() });
    },
  });
  const activeThreadId = useSelector(() => chatStore$.activeThreadId.get());
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
  const versionQuery = useQuery({
    queryKey: serverStateKeys.version(),
    queryFn: serverStateQueryFns.version,
    enabled: isDrawerVisible,
    retry: false,
    staleTime: 60_000,
  });
  const workspacePath = statusQuery.data?.workspacePath;
  const versionCompatibility = useMemo(
    () => evaluateRelayVersion(versionQuery.data, versionQuery.error),
    [versionQuery.data, versionQuery.error],
  );
  const [uiState, dispatchUi] = useReducer(threadDrawerUiReducer, initialThreadDrawerUiState);
  const {
    canRenderThreadList,
    expandedProjects,
    isCreatingThread,
    isLoadingWorkspaces,
    isRefreshingProjects,
    isWorkspaceSheetVisible,
    searchQuery,
    workspaceBrowser,
  } = uiState;
  const normalizedSearchQuery = normalizeSearchValue(searchQuery);
  const searchProgress = useSharedValue(0);
  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data?.threads]);
  const threadsById = useMemo(() => indexThreadsById(threads), [threads]);
  const visibleThreads = useMemo(
    () =>
      normalizedSearchQuery
        ? threads.filter((thread) => threadMatchesSearch(thread, normalizedSearchQuery))
        : threads,
    [normalizedSearchQuery, threads],
  );
  const activeThread = activeThreadId ? threadsById[activeThreadId] : undefined;
  const currentBrowserPath = workspaceBrowser?.path ?? activeThread?.cwd ?? workspacePath;
  const rows = useMemo(
    () =>
      buildDrawerRows(
        visibleThreads,
        expandedProjects,
        activeThreadId,
        Boolean(normalizedSearchQuery),
      ),
    [activeThreadId, expandedProjects, normalizedSearchQuery, visibleThreads],
  );
  const workspaceRows = useMemo(() => workspaceBrowserRows(workspaceBrowser), [workspaceBrowser]);
  const searchClearAnimatedStyle = useAnimatedStyle<ViewStyle>(() => ({
    opacity: searchProgress.value,
    transform: [
      { translateX: (1 - searchProgress.value) * 6 },
      { scale: 0.86 + searchProgress.value * 0.14 },
    ],
  }));
  const emptySearchAnimatedStyle = useAnimatedStyle(() => ({
    opacity: searchProgress.value,
    transform: [{ translateY: (1 - searchProgress.value) * -4 }],
  }));
  const sidebarResizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(() => {
          props.onSidebarResizeStart?.();
          hapticSelection();
        })
        .onUpdate((event) => {
          props.onSidebarResize?.(event.translationX);
        }),
    [props],
  );

  useEffect(() => {
    const idleTask = requestIdleTask(
      () =>
        dispatchUi({
          type: "set-can-render-thread-list",
          value: isDrawerVisible,
        }),
      drawerListIdleTimeoutMs,
    );
    return () => cancelIdleTask(idleTask);
  }, [isDrawerVisible]);

  useEffect(() => {
    if (isDrawerVisible) {
      Keyboard.dismiss();
    }
  }, [isDrawerVisible]);

  useEffect(() => {
    searchProgress.value = withTiming(normalizedSearchQuery ? 1 : 0, {
      duration: 160,
      easing: Easing.out(Easing.cubic),
    });
  }, [normalizedSearchQuery, searchProgress]);

  const {
    confirmArchiveThread,
    createNewThread,
    loadWorkspaceDirectories,
    openNewThreadWorkspacePicker,
    openSettings,
    refreshProjects,
    selectThread,
    toggleProject,
  } = useThreadDrawerActions({
    activeThread,
    archiveThreadIsPending: archiveThreadMutation.isPending,
    archiveThreadMutateAsync: archiveThreadMutation.mutateAsync,
    createThreadMutateAsync: createThreadMutation.mutateAsync,
    dispatchUi,
    isCreatingThread,
    isLoadingWorkspaces,
    isRefreshingProjects,
    navigation: props.navigation,
    queryClient,
    threadsById,
    workspacePath,
  });

  const renderDrawerRow = useCallback(
    ({ item }: LegendListRenderItemProps<DrawerRow>) => (
      <DrawerRowItem
        archiveThreadPending={archiveThreadMutation.isPending}
        isCreatingThread={isCreatingThread}
        item={item}
        onArchiveThread={confirmArchiveThread}
        onCreateThread={createNewThread}
        onSelectThread={selectThread}
        onToggleProject={toggleProject}
        selected={item.kind === "thread" && item.thread.id === activeThreadId}
        workspacePath={workspacePath}
      />
    ),
    [
      activeThreadId,
      archiveThreadMutation.isPending,
      confirmArchiveThread,
      createNewThread,
      isCreatingThread,
      selectThread,
      toggleProject,
      workspacePath,
    ],
  );

  const listHeader = (
    <DrawerListHeader
      isRefreshingProjects={isRefreshingProjects}
      onCloseMenu={() => {
        hapticSelection();
        props.navigation.closeDrawer();
      }}
      showCloseButton={!props.isPermanent}
      onNewChat={() => void openNewThreadWorkspacePicker()}
      onRefreshProjects={() => void refreshProjects()}
      onSearchChange={(value) => dispatchUi({ type: "set-search-query", value })}
      onSearchClear={() => dispatchUi({ type: "set-search-query", value: "" })}
      searchClearAnimatedStyle={searchClearAnimatedStyle}
      searchQuery={searchQuery}
      versionCompatibility={versionCompatibility}
    />
  );

  const emptyList = normalizedSearchQuery ? (
    <Animated.View style={[styles.emptySearchState, emptySearchAnimatedStyle]}>
      <Text style={styles.emptySearchText}>No matching conversations</Text>
    </Animated.View>
  ) : (
    <View style={styles.emptySearchState}>
      <Text style={styles.emptySearchText}>No chats in this workspace</Text>
    </View>
  );

  return (
    <View style={styles.drawerRoot}>
      {canRenderThreadList ? (
        <LegendList
          contentContainerStyle={[styles.listContent, { paddingBottom: 8, paddingTop: insets.top }]}
          data={rows}
          drawDistance={drawerListDrawDistance}
          estimatedItemSize={drawerRowEstimatedSize}
          getFixedItemSize={getEstimatedDrawerRowSize}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListEmptyComponent={emptyList}
          ListHeaderComponent={listHeader}
          maintainVisibleContentPosition={false}
          recycleItems={false}
          renderItem={renderDrawerRow}
          scrollEventThrottle={16}
          style={styles.list}
        />
      ) : (
        <View
          style={[styles.listContent, styles.list, { paddingBottom: 8, paddingTop: insets.top }]}
        >
          {listHeader}
        </View>
      )}
      <DrawerFooter bottomInset={insets.bottom} onOpenSettings={openSettings} />
      <WorkspaceBrowserModal
        currentBrowserPath={currentBrowserPath}
        isCreatingThread={isCreatingThread}
        isLoadingWorkspaces={isLoadingWorkspaces}
        onClose={() => dispatchUi({ type: "set-workspace-sheet-visible", value: false })}
        onCreateThread={createNewThread}
        onLoadWorkspaceDirectories={loadWorkspaceDirectories}
        visible={isWorkspaceSheetVisible}
        workspaceBrowser={workspaceBrowser}
        workspaceRows={workspaceRows}
      />
      {props.showResizeHandle ? (
        <GestureDetector gesture={sidebarResizeGesture}>
          <Animated.View
            accessibilityLabel="Resize threads sidebar"
            style={styles.sidebarResizeHandle}
          >
            <View style={styles.sidebarResizeGrip} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

function useThreadDrawerActions({
  activeThread,
  archiveThreadIsPending,
  archiveThreadMutateAsync,
  createThreadMutateAsync,
  dispatchUi,
  isCreatingThread,
  isLoadingWorkspaces,
  isRefreshingProjects,
  navigation,
  queryClient,
  threadsById,
  workspacePath,
}: {
  activeThread: ThreadSummary | undefined;
  archiveThreadIsPending: boolean;
  archiveThreadMutateAsync: (
    threadId: string,
  ) => Promise<Awaited<ReturnType<typeof archiveThreadServerState>>>;
  createThreadMutateAsync: (
    body: Parameters<typeof createThreadServerState>[1],
  ) => Promise<Awaited<ReturnType<typeof createThreadServerState>>>;
  dispatchUi: (action: ThreadDrawerUiAction) => void;
  isCreatingThread: boolean;
  isLoadingWorkspaces: boolean;
  isRefreshingProjects: boolean;
  navigation: ThreadDrawerNavigation;
  queryClient: QueryClient;
  threadsById: Record<string, ThreadSummary>;
  workspacePath: string | undefined;
}) {
  const pendingDrawerActionTaskRef = useRef<{ cancel: () => void } | undefined>(undefined);

  useEffect(
    () => () => {
      pendingDrawerActionTaskRef.current?.cancel();
    },
    [],
  );

  const syncPairedSessionState = useCallback(() => {
    setHasPairedSession(hasCodexRelaySession());
  }, []);

  const activateSelectedThread = useCallback(
    async (threadId: string) => {
      const selectedThread = threadsById[threadId];
      setActiveThread(threadId);
      setThreadMessagesLoading(threadId, true);
      try {
        const response = await fetchThreadState(queryClient, threadId);
        setThreadDetailState(
          queryClient,
          response.thread,
          response.messages,
          response.pendingInputRequests,
        );
        setActiveThread(response.thread.id);
        if (response.thread.state === "running") {
          requestThreadStreamReconnect(threadId);
        }
        setConnection("connected");
      } catch (caught) {
        syncPairedSessionState();
        setThreadRunningState(queryClient, selectedThread?.id ?? threadId, false);
        setConnection(
          "offline",
          caught instanceof Error ? caught.message : "Unable to load this Codex thread.",
        );
      } finally {
        setThreadMessagesLoading(threadId, false);
      }
    },
    [queryClient, syncPairedSessionState, threadsById],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      hapticSelection();
      navigation.closeDrawer();
      pendingDrawerActionTaskRef.current?.cancel();
      if (chatStore$.activeThreadId.peek() === threadId) {
        return;
      }
      pendingDrawerActionTaskRef.current = InteractionManager.runAfterInteractions(() => {
        void activateSelectedThread(threadId);
      });
    },
    [activateSelectedThread, navigation],
  );

  const loadWorkspaceDirectories = useCallback(
    async (path?: string) => {
      if (isLoadingWorkspaces) {
        return;
      }

      dispatchUi({ type: "set-loading-workspaces", value: true });
      setConnection("checking");
      try {
        const response = await fetchWorkspaceDirectoriesState(queryClient, path);
        dispatchUi({ type: "set-workspace-browser", value: response });
        setConnection("connected");
      } catch (caught) {
        syncPairedSessionState();
        setConnection(
          "offline",
          caught instanceof Error ? caught.message : "Unable to load workspace folders.",
        );
      } finally {
        dispatchUi({ type: "set-loading-workspaces", value: false });
      }
    },
    [dispatchUi, isLoadingWorkspaces, queryClient, syncPairedSessionState],
  );

  const openNewThreadWorkspacePicker = useCallback(async () => {
    hapticSelection();
    dispatchUi({ type: "set-workspace-sheet-visible", value: true });
    await loadWorkspaceDirectories(activeThread?.cwd ?? workspacePath);
  }, [activeThread?.cwd, dispatchUi, loadWorkspaceDirectories, workspacePath]);

  const createNewThread = useCallback(
    async (selectedWorkspacePath: string | undefined) => {
      if (isCreatingThread) {
        return;
      }

      dispatchUi({ type: "set-creating-thread", value: true });
      try {
        const response = await createThreadMutateAsync({
          title: "New chat",
          workspacePath: selectedWorkspacePath,
        });
        setThreadDetailState(queryClient, response.thread, response.messages);
        setActiveThread(response.thread.id);
        setConnection("connected");
        hapticSuccess();
        dispatchUi({ type: "set-workspace-sheet-visible", value: false });
        navigation.closeDrawer();
      } catch (caught) {
        syncPairedSessionState();
        setConnection(
          "offline",
          caught instanceof Error ? caught.message : "Unable to create a new Codex Relay thread.",
        );
      } finally {
        dispatchUi({ type: "set-creating-thread", value: false });
      }
    },
    [
      createThreadMutateAsync,
      dispatchUi,
      isCreatingThread,
      navigation,
      queryClient,
      syncPairedSessionState,
    ],
  );

  const toggleProject = useCallback(
    (projectKey: string) => {
      hapticSelection();
      dispatchUi({ type: "toggle-project", projectKey });
    },
    [dispatchUi],
  );

  const refreshProjects = useCallback(async () => {
    if (isRefreshingProjects) {
      return;
    }

    dispatchUi({ type: "set-refreshing-projects", value: true });
    setConnection("checking");
    hapticLightImpact();
    try {
      const response = await fetchThreadsState(queryClient);
      setThreadsState(queryClient, response.threads, response.source);
      const currentActiveThreadId = chatStore$.activeThreadId.peek();
      if (
        currentActiveThreadId &&
        !response.threads.some((thread) => thread.id === currentActiveThreadId)
      ) {
        setActiveThread(response.threads[0]?.id);
      }
      setConnection("connected");
    } catch (caught) {
      syncPairedSessionState();
      setConnection(
        "offline",
        caught instanceof Error ? caught.message : "Unable to refresh projects.",
      );
    } finally {
      dispatchUi({ type: "set-refreshing-projects", value: false });
    }
  }, [dispatchUi, isRefreshingProjects, queryClient, syncPairedSessionState]);

  const archiveThread = useCallback(
    async (threadId: string) => {
      if (archiveThreadIsPending) {
        return;
      }

      try {
        const response = await archiveThreadMutateAsync(threadId);
        if (chatStore$.activeThreadId.peek() === threadId) {
          setActiveThread(response.threads[0]?.id);
        }
        hapticSuccess();
      } catch (caught) {
        syncPairedSessionState();
        setConnection(
          "offline",
          caught instanceof Error ? caught.message : "Unable to archive this Codex thread.",
        );
      }
    },
    [archiveThreadIsPending, archiveThreadMutateAsync, syncPairedSessionState],
  );

  const confirmArchiveThread = useCallback(
    (thread: ThreadSummary) => {
      hapticSelection();
      Alert.alert("Archive thread?", `"${thread.title}" will be removed from this workspace.`, [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => void archiveThread(thread.id),
          style: "destructive",
          text: "Archive",
        },
      ]);
    },
    [archiveThread],
  );

  const openSettings = useCallback(() => {
    hapticSelection();
    navigation.closeDrawer();
    pendingDrawerActionTaskRef.current?.cancel();
    pendingDrawerActionTaskRef.current = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => router.push("/settings"));
    });
  }, [navigation]);

  return {
    confirmArchiveThread,
    createNewThread,
    loadWorkspaceDirectories,
    openNewThreadWorkspacePicker,
    openSettings,
    refreshProjects,
    selectThread,
    toggleProject,
  };
}

function DrawerFooter({
  bottomInset,
  onOpenSettings,
}: {
  bottomInset: number;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.footerBlock, { paddingBottom: Math.max(bottomInset, 8) }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open Codex Relay GitHub repository"
        onPress={() => void Linking.openURL(codexRelayRepositoryUrl)}
        style={styles.repositoryFooter}
      >
        {({ pressed }) => (
          <>
            <View style={[styles.rowIconSlot, pressed && styles.drawerPressedContent]}>
              <FaGithub size={16} color={theme.text} />
            </View>
            <View style={[styles.repositoryFooterCopy, pressed && styles.drawerPressedContent]}>
              <Text style={styles.repositoryFooterTitle}>Codex Relay on GitHub</Text>
            </View>
          </>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={onOpenSettings}
        style={styles.footer}
      >
        {({ pressed }) => (
          <>
            <View style={[styles.rowIconSlot, pressed && styles.drawerPressedContent]}>
              <Icon name="settings" size={16} tintColor={theme.text} />
            </View>
            <Text style={[styles.footerText, pressed && styles.drawerPressedContent]}>
              Settings
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

type DrawerRowItemProps = {
  archiveThreadPending: boolean;
  isCreatingThread: boolean;
  item: DrawerRow;
  onArchiveThread: (thread: ThreadSummary) => void;
  onCreateThread: (workspacePath: string | undefined) => Promise<void>;
  onSelectThread: (threadId: string) => void;
  onToggleProject: (projectKey: string) => void;
  selected: boolean;
  workspacePath: string | undefined;
};

const DrawerRowItem = memo(function DrawerRowItem({
  archiveThreadPending,
  isCreatingThread,
  item,
  onArchiveThread,
  onCreateThread,
  onSelectThread,
  onToggleProject,
  selected,
  workspacePath,
}: DrawerRowItemProps) {
  const theme = useTheme();

  if (item.kind === "project") {
    return (
      <View style={styles.projectHeader}>
        <View style={styles.rowIconSlot}>
          <Icon name="folder" size={15} tintColor={theme.textSecondary} />
        </View>
        <Text style={styles.projectTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.projectActions}>
          <Button
            accessibilityLabel={`Create new chat in ${item.title}`}
            disabled={isCreatingThread}
            onPress={() => {
              hapticSelection();
              void onCreateThread(item.workspacePath ?? workspacePath);
            }}
            size="icon"
            variant="ghost"
            className="size-7 rounded-md"
          >
            <Icon name="newThread" size={13} tintColor={theme.textSecondary} />
          </Button>
        </View>
      </View>
    );
  }

  if (item.kind === "more") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${item.hiddenCount} more conversations`}
        onPress={() => onToggleProject(item.projectKey)}
        style={styles.moreRow}
      >
        {({ pressed }) => (
          <>
            <View style={styles.rowIconSlot} />
            <Text style={[styles.moreText, pressed && styles.drawerPressedContent]}>Show more</Text>
          </>
        )}
      </Pressable>
    );
  }

  const running = item.thread.state === "running";
  return (
    <View style={[styles.thread, selected && styles.threadSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open thread ${item.thread.title}`}
        accessibilityState={{ selected }}
        onPress={() => void onSelectThread(item.thread.id)}
        style={styles.threadOpenButton}
      >
        {({ pressed }) => (
          <>
            <View style={[styles.rowIconSlot, pressed && styles.drawerPressedContent]}>
              {running ? (
                <RunningThreadIndicator color={theme.textSecondary} />
              ) : (
                <View style={[styles.activeDot, selected && styles.activeDotSelected]} />
              )}
            </View>
            <View style={[styles.threadContent, pressed && styles.drawerPressedContent]}>
              <Text style={styles.threadTitle} numberOfLines={1}>
                {item.thread.title}
              </Text>
              <Text style={styles.threadTime} numberOfLines={1}>
                {formatRelativeTime(item.thread.lastActivityAt ?? item.thread.updatedAt)}
              </Text>
            </View>
          </>
        )}
      </Pressable>
      <Button
        accessibilityLabel={`Archive thread ${item.thread.title}`}
        disabled={archiveThreadPending}
        onPress={() => onArchiveThread(item.thread)}
        size="icon"
        variant="ghost"
        className="size-8 rounded-md"
      >
        <Icon name="archive" size={14} tintColor={theme.textSecondary} />
      </Button>
    </View>
  );
}, areDrawerRowItemsEqual);

function areDrawerRowItemsEqual(previous: DrawerRowItemProps, next: DrawerRowItemProps) {
  if (
    previous.archiveThreadPending !== next.archiveThreadPending ||
    previous.isCreatingThread !== next.isCreatingThread ||
    previous.item.kind !== next.item.kind ||
    previous.item.id !== next.item.id ||
    previous.onArchiveThread !== next.onArchiveThread ||
    previous.onCreateThread !== next.onCreateThread ||
    previous.onSelectThread !== next.onSelectThread ||
    previous.onToggleProject !== next.onToggleProject ||
    previous.selected !== next.selected ||
    previous.workspacePath !== next.workspacePath
  ) {
    return false;
  }

  if (previous.item.kind === "thread" && next.item.kind === "thread") {
    return (
      previous.item.thread === next.item.thread ||
      (previous.item.thread.title === next.item.thread.title &&
        previous.item.thread.state === next.item.thread.state &&
        previous.item.thread.lastActivityAt === next.item.thread.lastActivityAt &&
        previous.item.thread.updatedAt === next.item.thread.updatedAt)
    );
  }

  if (previous.item.kind === "project" && next.item.kind === "project") {
    return (
      previous.item.title === next.item.title &&
      previous.item.workspacePath === next.item.workspacePath
    );
  }

  if (previous.item.kind === "more" && next.item.kind === "more") {
    return previous.item.hiddenCount === next.item.hiddenCount;
  }

  return true;
}

function DrawerListHeader({
  isRefreshingProjects,
  onCloseMenu,
  onNewChat,
  onRefreshProjects,
  onSearchChange,
  onSearchClear,
  searchClearAnimatedStyle,
  searchQuery,
  showCloseButton,
  versionCompatibility,
}: {
  isRefreshingProjects: boolean;
  onCloseMenu: () => void;
  onNewChat: () => void;
  onRefreshProjects: () => void;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  searchClearAnimatedStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  searchQuery: string;
  showCloseButton: boolean;
  versionCompatibility: RelayVersionCompatibility | undefined;
}) {
  const theme = useTheme();

  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Text style={styles.brandText}>Codex Relay</Text>
        {showCloseButton ? (
          <Button
            accessibilityLabel="Close menu"
            onPress={onCloseMenu}
            size="icon"
            variant="ghost"
            className="ml-auto size-8 rounded-md active:bg-accent/70"
          >
            <Icon name="closeMenu" size={17} tintColor={theme.textSecondary} />
          </Button>
        ) : null}
      </View>
      <View style={styles.searchShell}>
        <Icon name="search" size={14} tintColor={theme.textSecondary} />
        <TextInput
          accessibilityLabel="Search conversations"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onSearchChange}
          placeholder="Search conversations"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          selectionColor={theme.text}
          style={[styles.searchInput, { color: theme.text }]}
          value={searchQuery}
        />
        <Animated.View
          pointerEvents={searchQuery ? "auto" : "none"}
          style={[styles.searchClearSlot, searchClearAnimatedStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear conversation search"
            disabled={!searchQuery}
            hitSlop={8}
            onPress={onSearchClear}
            style={({ pressed }) => [
              styles.searchClearButton,
              pressed && styles.drawerPressedContent,
            ]}
          >
            <Icon name="closeMenu" size={13} tintColor={theme.textSecondary} />
          </Pressable>
        </Animated.View>
      </View>
      {versionCompatibility && !versionCompatibility.compatible ? (
        <RelayVersionNotice compatibility={versionCompatibility} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New Chat"
        onPress={onNewChat}
        style={styles.newChatRow}
      >
        {({ pressed }) => (
          <>
            <View style={[styles.newChatIcon, pressed && styles.drawerPressedContent]}>
              <Icon name="newChat" size={14} tintColor={theme.text} />
            </View>
            <Text style={[styles.newChatText, pressed && styles.drawerPressedContent]}>
              New Chat
            </Text>
          </>
        )}
      </Pressable>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Projects</Text>
        <View style={styles.sectionActions}>
          <Button
            accessibilityLabel="Refresh projects"
            disabled={isRefreshingProjects}
            onPress={onRefreshProjects}
            size="icon"
            variant="ghost"
            className="size-7 rounded-md"
          >
            <Icon name="refresh" size={13} tintColor={theme.textSecondary} />
          </Button>
        </View>
      </View>
    </View>
  );
}

function WorkspaceBrowserModal({
  currentBrowserPath,
  isCreatingThread,
  isLoadingWorkspaces,
  onClose,
  onCreateThread,
  onLoadWorkspaceDirectories,
  visible,
  workspaceBrowser,
  workspaceRows,
}: {
  currentBrowserPath: string | undefined;
  isCreatingThread: boolean;
  isLoadingWorkspaces: boolean;
  onClose: () => void;
  onCreateThread: (workspacePath: string | undefined) => Promise<void>;
  onLoadWorkspaceDirectories: (path?: string) => Promise<void>;
  visible: boolean;
  workspaceBrowser: WorkspaceBrowser | undefined;
  workspaceRows: WorkspaceBrowserRow[];
}) {
  const theme = useTheme();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView edges={["top", "left", "right"]} style={styles.workspaceDrawer}>
        <View style={styles.workspaceDrawerPanel}>
          <View style={styles.workspaceDrawerHeader}>
            <View style={styles.workspaceDrawerTitleBlock}>
              <Text style={styles.workspaceDrawerTitle}>New Chat</Text>
              <Text style={styles.workspaceDrawerSubtitle} numberOfLines={1}>
                {currentBrowserPath ?? "codex-relay"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close folder picker"
              onPress={onClose}
              style={({ pressed }) => [
                styles.workspaceCloseButton,
                pressed && styles.drawerPressedContent,
              ]}
            >
              <Text style={styles.workspaceCloseText}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.workspaceExplorer}>
            <View style={styles.workspaceToolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go to parent folder"
                accessibilityState={{
                  disabled: !workspaceBrowser?.parentPath || isLoadingWorkspaces,
                }}
                disabled={!workspaceBrowser?.parentPath || isLoadingWorkspaces}
                onPress={() =>
                  void onLoadWorkspaceDirectories(workspaceBrowser?.parentPath ?? undefined)
                }
                style={({ pressed }) => [
                  styles.workspaceUpButton,
                  pressed && styles.drawerPressedContent,
                  (!workspaceBrowser?.parentPath || isLoadingWorkspaces) &&
                    styles.workspaceDisabled,
                ]}
              >
                <Icon name="up" size={16} tintColor={theme.text} />
              </Pressable>
              <View style={styles.workspaceLocation}>
                <Text style={styles.workspaceLocationTitle} numberOfLines={1}>
                  {projectName(currentBrowserPath)}
                </Text>
                <Text style={styles.workspaceLocationPath} numberOfLines={1}>
                  {currentBrowserPath ?? "codex-relay"}
                </Text>
              </View>
            </View>

            <LegendList
              ListEmptyComponent={
                isLoadingWorkspaces && !workspaceBrowser ? (
                  <Text style={styles.workspaceEmptyText}>Loading folders…</Text>
                ) : (
                  <View style={styles.workspaceEmptyState}>
                    <Icon name="folder" size={18} tintColor={theme.textSecondary} />
                    <Text style={styles.workspaceEmptyText}>No folders here</Text>
                  </View>
                )
              }
              contentContainerStyle={styles.workspaceList}
              data={workspaceRows}
              estimatedItemSize={workspaceBrowserRowEstimatedSize}
              getFixedItemSize={() => workspaceBrowserRowEstimatedSize}
              keyExtractor={(item) => item.id}
              recycleItems={false}
              renderItem={({ item }) => (
                <WorkspaceBrowserListRow
                  item={item}
                  onOpenDirectory={onLoadWorkspaceDirectories}
                  pressedColor={theme.backgroundSelected}
                  textSecondaryColor={theme.textSecondary}
                />
              )}
              style={styles.workspaceListViewport}
            />
          </View>

          <View style={styles.workspaceDrawerFooter}>
            <SheetActionRow
              accessibilityLabel="Create chat in current folder"
              disabled={isCreatingThread || isLoadingWorkspaces || !currentBrowserPath}
              icon="newChat"
              onPress={() => void onCreateThread(currentBrowserPath)}
              selected
              title="New Chat Here"
              subtitle={projectName(currentBrowserPath)}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const WorkspaceBrowserListRow = memo(function WorkspaceBrowserListRow({
  item,
  onOpenDirectory,
  pressedColor,
  textSecondaryColor,
}: {
  item: WorkspaceBrowserRow;
  onOpenDirectory: (path?: string) => Promise<void>;
  pressedColor: string;
  textSecondaryColor: string;
}) {
  const isParent = item.kind === "parent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isParent ? "Open parent folder" : `Open folder ${item.name}`}
      onPress={() => void onOpenDirectory(item.path)}
      style={styles.workspaceFolderButton}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.workspaceFolderRow,
            pressed && {
              backgroundColor: pressedColor,
            },
          ]}
        >
          <View style={styles.workspaceFolderDisclosure}>
            {isParent ? null : (
              <Icon name="chevronRight" size={14} tintColor={textSecondaryColor} />
            )}
          </View>
          <View style={styles.workspaceFolderIcon}>
            <Icon
              name={isParent ? "up" : "folder"}
              size={isParent ? 16 : 17}
              tintColor={textSecondaryColor}
            />
          </View>
          <View style={styles.workspaceFolderCopy}>
            <Text style={styles.workspaceFolderTitle} numberOfLines={1}>
              {isParent ? "Parent Folder" : item.name}
            </Text>
            {isParent ? (
              <Text style={styles.workspaceFolderSubtitle} numberOfLines={1}>
                ..
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
});

function RunningThreadIndicator({ color }: { color: string }) {
  const rotation = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 950, easing: Easing.linear }),
      -1,
      false,
    );
  }, [rotation]);

  return (
    <Animated.View style={animatedStyle}>
      <Icon name="running" size={13} tintColor={color} />
    </Animated.View>
  );
}

function RelayVersionNotice({
  compatibility,
}: {
  compatibility: Extract<RelayVersionCompatibility, { compatible: false }>;
}) {
  const theme = useTheme();

  return (
    <View accessibilityRole="alert" style={styles.versionNotice}>
      <View style={styles.versionNoticeHeader}>
        <View style={styles.versionNoticeIcon}>
          <Icon name="warning" size={16} tintColor="#F8C46D" />
        </View>
        <View style={styles.versionNoticeCopy}>
          <Text style={styles.versionNoticeTitle}>Update relay</Text>
          <Text style={styles.versionNoticeBody}>{compatibility.reason}</Text>
        </View>
      </View>
      <View style={styles.versionNoticeRows}>
        {compatibility.serverPackageVersion ? (
          <VersionNoticeRow label="Current relay" value={compatibility.serverPackageVersion} />
        ) : null}
        {!compatibility.serverPackageVersion ? (
          <VersionNoticeRow label="Current relay" value={compatibility.current} />
        ) : null}
        <VersionNoticeRow label="Required relay" value={compatibility.required} />
      </View>
      <Text style={[styles.versionNoticeCommand, { color: theme.text }]}>
        {compatibility.updateCommand}
      </Text>
    </View>
  );
}

function VersionNoticeRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.versionNoticeRow}>
      <Text style={styles.versionNoticeLabel}>{label}</Text>
      <Text style={styles.versionNoticeValue}>{value}</Text>
    </View>
  );
}

function buildDrawerRows(
  threads: ThreadSummary[],
  expandedProjects: Record<string, boolean>,
  activeThreadId: string | undefined,
  forceExpanded = false,
): DrawerRow[] {
  const groups = new Map<
    string,
    { title: string; threads: ThreadSummary[]; workspacePath?: string }
  >();

  for (const thread of threads) {
    const title = projectName(thread.cwd);
    const key = thread.cwd ?? title;
    const group = groups.get(key);
    if (group) {
      group.threads.push(thread);
    } else {
      groups.set(key, { title, threads: [thread], workspacePath: thread.cwd });
    }
  }

  return [...groups.entries()].flatMap(([projectKey, group]) => {
    const isExpanded = forceExpanded || (expandedProjects[projectKey] ?? false);
    const activeThread = activeThreadId
      ? group.threads.find((thread) => thread.id === activeThreadId)
      : undefined;
    const collapsedThreads = group.threads.slice(0, collapsedProjectThreadCount);
    const visibleThreads =
      isExpanded || !activeThread || collapsedThreads.includes(activeThread)
        ? isExpanded
          ? group.threads
          : collapsedThreads
        : [...collapsedThreads.slice(0, collapsedProjectThreadCount - 1), activeThread];
    const hiddenCount = group.threads.length - visibleThreads.length;
    const projectRows: DrawerRow[] = [
      {
        id: `project:${projectKey}`,
        kind: "project",
        projectKey,
        title: group.title,
        workspacePath: group.workspacePath,
      },
      ...visibleThreads.map((thread) => ({
        id: `thread:${thread.id}`,
        kind: "thread" as const,
        projectKey,
        thread,
      })),
    ];

    if (hiddenCount > 0) {
      projectRows.push({
        id: `more:${projectKey}`,
        kind: "more",
        hiddenCount,
        projectKey,
      });
    }

    return projectRows;
  });
}

function workspaceBrowserRows(browser: WorkspaceBrowser | undefined): WorkspaceBrowserRow[] {
  if (!browser) {
    return [];
  }

  const rows: WorkspaceBrowserRow[] = [];
  if (browser.parentPath) {
    rows.push({
      id: `parent:${browser.parentPath}`,
      kind: "parent",
      path: browser.parentPath,
    });
  }
  for (const directory of browser.directories) {
    rows.push({
      id: `directory:${directory.path}`,
      kind: "directory",
      name: directory.name,
      path: directory.path,
    });
  }
  return rows;
}

function indexThreadsById(threads: ThreadSummary[]) {
  const threadsById: Record<string, ThreadSummary> = {};
  for (const thread of threads) {
    threadsById[thread.id] = thread;
  }
  return threadsById;
}

function getEstimatedDrawerRowSize(row: DrawerRow) {
  return row.kind === "thread" ? 44 : 32;
}

function getDrawerStatus(state: ThreadDrawerContentProps["state"]) {
  const drawerHistoryEntry = state.history.find(
    (entry): entry is { status: "closed" | "open"; type: "drawer" } => entry.type === "drawer",
  );
  return drawerHistoryEntry?.status ?? "closed";
}

type IdleTask =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

function requestIdleTask(callback: () => void, timeout: number): IdleTask {
  const idleScheduler = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (idleScheduler) {
    return { id: idleScheduler(callback, { timeout }), kind: "idle" };
  }

  return { id: setTimeout(callback, timeout), kind: "timeout" };
}

function cancelIdleTask(task: IdleTask) {
  if (task.kind === "idle") {
    (
      globalThis as typeof globalThis & {
        cancelIdleCallback?: (id: number) => void;
      }
    ).cancelIdleCallback?.(task.id);
    return;
  }

  clearTimeout(task.id);
}

function threadMatchesSearch(thread: ThreadSummary, normalizedQuery: string) {
  return [
    thread.title,
    thread.cwd,
    thread.lastMessagePreview,
    thread.lastPrompt,
    thread.lastResult,
    thread.lastError,
    thread.model,
  ].some((value) => normalizeSearchValue(value).includes(normalizedQuery));
}

function normalizeSearchValue(value: string | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function projectName(cwd: string | undefined) {
  if (!cwd) {
    return "codex-relay";
  }

  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function formatRelativeTime(value: string) {
  const then = new Date(value).getTime();
  const diffMs = Date.now() - then;
  if (!Number.isFinite(then) || diffMs < 0) {
    return "";
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return `${Math.floor(diffMs / day)}d`;
}

const styles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    position: "relative",
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 12,
  },
  list: {
    flex: 1,
  },
  header: {
    gap: 8,
    paddingBottom: 8,
    paddingTop: 12,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 32,
  },
  brandText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  searchShell: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 32,
    marginHorizontal: 4,
    paddingHorizontal: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    height: "100%",
    lineHeight: 15,
    marginLeft: 8,
    minWidth: 0,
    padding: 0,
  },
  searchClearSlot: {
    alignItems: "flex-end",
    overflow: "hidden",
    width: 28,
  },
  searchClearButton: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  versionNotice: {
    backgroundColor: "rgba(248, 196, 109, 0.1)",
    borderColor: "rgba(248, 196, 109, 0.24)",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 9,
    padding: 10,
  },
  versionNoticeHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  versionNoticeIcon: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    marginRight: 8,
    width: 22,
  },
  versionNoticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  versionNoticeTitle: {
    color: "#F8C46D",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  versionNoticeBody: {
    color: "rgba(255, 255, 255, 0.76)",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  versionNoticeRows: {
    gap: 4,
  },
  versionNoticeRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  versionNoticeLabel: {
    color: "rgba(255, 255, 255, 0.54)",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
    width: 78,
  },
  versionNoticeValue: {
    color: "rgba(255, 255, 255, 0.82)",
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    minWidth: 0,
  },
  versionNoticeCommand: {
    backgroundColor: "rgba(0, 0, 0, 0.18)",
    borderRadius: 6,
    fontFamily: Fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  newChatRow: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    minHeight: 36,
    paddingHorizontal: 8,
  },
  newChatIcon: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginRight: 10,
    width: 24,
  },
  newChatText: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  sectionActions: {
    flexDirection: "row",
    gap: 2,
    marginLeft: "auto",
    marginRight: 10,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 8,
    minHeight: 28,
    paddingLeft: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.2,
    lineHeight: 16,
    opacity: 0.68,
  },
  projectHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 32,
    paddingRight: 2,
  },
  projectTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    minWidth: 0,
  },
  projectActions: {
    alignItems: "center",
    flexDirection: "row",
    marginLeft: "auto",
  },
  rowIconSlot: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginRight: 10,
    width: 24,
  },
  thread: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    minHeight: 44,
    paddingLeft: 0,
    paddingRight: 4,
    paddingVertical: 5,
  },
  threadOpenButton: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minHeight: 34,
    minWidth: 0,
  },
  threadContent: {
    flex: 1,
    minWidth: 0,
  },
  threadTitle: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  threadTime: {
    fontSize: 11,
    lineHeight: 14,
    opacity: 0.62,
  },
  threadSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.075)",
  },
  drawerPressedContent: {
    opacity: 0.68,
  },
  sidebarResizeGrip: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 1,
    height: 44,
    opacity: 0.72,
    width: 2,
  },
  sidebarResizeHandle: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    right: -8,
    top: 0,
    width: 16,
    zIndex: 40,
  },
  emptySearchState: {
    alignItems: "center",
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  emptySearchText: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.62,
    textAlign: "center",
  },
  activeDot: {
    backgroundColor: "transparent",
    borderRadius: 3,
    height: 6,
    transform: [{ translateX: 2 }],
    width: 6,
  },
  activeDotSelected: {
    backgroundColor: "#8CC7FF",
  },
  moreRow: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    minHeight: 32,
    paddingLeft: 0,
    paddingRight: 8,
  },
  moreText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    opacity: 0.68,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 42,
    paddingHorizontal: 0,
  },
  footerBlock: {
    backgroundColor: "#191919",
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  repositoryFooter: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  repositoryFooterCopy: {
    flex: 1,
    minWidth: 0,
  },
  repositoryFooterTitle: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  workspaceDisabled: {
    opacity: 0.42,
  },
  workspaceDrawer: {
    backgroundColor: "#191919",
    flex: 1,
  },
  workspaceDrawerFooter: {
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  workspaceDrawerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  workspaceDrawerPanel: {
    flex: 1,
    gap: 14,
    padding: 24,
  },
  workspaceDrawerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.62,
  },
  workspaceDrawerTitle: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  workspaceDrawerTitleBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  workspaceCloseButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  workspaceCloseText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  workspaceEmptyState: {
    alignItems: "center",
    gap: 7,
    justifyContent: "center",
    minHeight: 72,
    paddingVertical: 12,
  },
  workspaceEmptyText: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.62,
  },
  workspaceExplorer: {
    flex: 1,
    gap: 6,
    minHeight: 0,
  },
  workspaceFolderButton: {
    borderRadius: 7,
    width: "100%",
  },
  workspaceFolderRow: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    minHeight: 40,
    paddingHorizontal: 6,
    paddingVertical: 5,
    width: "100%",
  },
  workspaceFolderDisclosure: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 18,
  },
  workspaceFolderIcon: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginLeft: 2,
    marginRight: 8,
    width: 22,
  },
  workspaceFolderCopy: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  workspaceFolderSubtitle: {
    fontSize: 11,
    lineHeight: 14,
    opacity: 0.56,
  },
  workspaceFolderTitle: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
  },
  workspaceList: {
    gap: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  workspaceListViewport: {
    flex: 1,
  },
  workspaceLocation: {
    flex: 1,
    minWidth: 0,
  },
  workspaceLocationPath: {
    fontSize: 11,
    lineHeight: 14,
    opacity: 0.58,
  },
  workspaceLocationTitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  workspaceToolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 4,
  },
  workspaceUpButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});
