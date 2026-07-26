import type { ChatMessage } from "codex-relay/api-schema";
import {
  type LegendListRef,
  type LegendListRenderItemProps,
  type MaintainScrollAtEndOptions,
  type MaintainVisibleContentPositionConfig,
} from "@legendapp/list/react-native";
import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

import { MessageBubble } from "./MessageBubble";
import { messageItemType, messageKeyExtractor } from "./timeline-message-items";
import type { WorkspaceMarkdownPreviewTarget } from "./workspace-preview/markdown-target";
import { RunningFooter } from "./RunningFooter";

export { implementablePlanId } from "./plan-progress";

const MESSAGE_ESTIMATED_ITEM_SIZE = 48;
const MAINTAIN_SCROLL_AT_END: MaintainScrollAtEndOptions = {
  animated: false,
  on: {
    dataChange: true,
    itemLayout: true,
    layout: true,
  },
};
const MAINTAIN_VISIBLE_CONTENT_POSITION: MaintainVisibleContentPositionConfig<ChatMessage> = {
  data: false,
  size: true,
};
const MAINTAIN_SCROLL_AT_END_THRESHOLD = 0.1;
const TIMELINE_LOADING_ENTER = FadeIn.duration(140).easing(Easing.out(Easing.cubic));
const TIMELINE_LOADING_EXIT = FadeOut.duration(120).easing(Easing.out(Easing.cubic));
const TIMELINE_CONTENT_SETTLE_OFFSET = 10;

export function MessageTimeline({
  bottomAccessoryHeight = 0,
  isLoading,
  isRunning,
  keyboardLayoutFrozen = false,
  messages,
  onKeyboardDismissRequest,
  onMessageCopied,
  onMessageRewind,
  onOpenMarkdownAttachment,
  threadId,
}: {
  bottomAccessoryHeight?: number;
  isLoading?: boolean;
  isRunning: boolean;
  keyboardLayoutFrozen?: boolean;
  messages: ChatMessage[];
  onKeyboardDismissRequest?: () => void;
  onMessageCopied?: () => void;
  onMessageRewind?: (message: ChatMessage) => void;
  onOpenMarkdownAttachment?: (target: WorkspaceMarkdownPreviewTarget) => void;
  threadId?: string;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const { bottom } = useSafeAreaInsets();
  const rows = messages;
  const timelineKey = threadId ?? "no-thread";
  const [settledTimelineKey, setSettledTimelineKey] = useState<string | undefined>(undefined);
  const extraContentPadding = useSharedValue(0);
  const contentRevealProgress = useSharedValue(0);
  const hasRows = rows.length > 0;
  const isTimelineReady = !hasRows || settledTimelineKey === timelineKey;
  const showLoadingConversation = isLoading || (hasRows && !isTimelineReady);
  const timelineContentStyle = useAnimatedStyle(() => ({
    opacity: contentRevealProgress.value,
    transform: [{ translateY: TIMELINE_CONTENT_SETTLE_OFFSET * (1 - contentRevealProgress.value) }],
  }));

  useEffect(() => {
    extraContentPadding.value = withTiming(Math.max(0, bottomAccessoryHeight), {
      duration: 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [bottomAccessoryHeight, extraContentPadding]);

  useEffect(() => {
    setSettledTimelineKey(undefined);
  }, [timelineKey]);

  useEffect(() => {
    if (isLoading || !hasRows) {
      return;
    }
    let didCancel = false;
    let settleFrame: number | undefined;
    const layoutFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        if (!didCancel) {
          setSettledTimelineKey(timelineKey);
        }
      });
    });
    return () => {
      didCancel = true;
      cancelAnimationFrame(layoutFrame);
      if (settleFrame !== undefined) {
        cancelAnimationFrame(settleFrame);
      }
    };
  }, [hasRows, isLoading, timelineKey]);

  useEffect(() => {
    contentRevealProgress.value = withTiming(showLoadingConversation ? 0 : 1, {
      duration: showLoadingConversation ? 120 : 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [contentRevealProgress, showLoadingConversation]);

  const renderMessage = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => (
      <MessageBubble
        message={item}
        onMessageCopied={onMessageCopied}
        onMessageRewind={onMessageRewind}
        onOpenMarkdownAttachment={onOpenMarkdownAttachment}
      />
    ),
    [onMessageCopied, onMessageRewind, onOpenMarkdownAttachment],
  );
  const handleTimelineLoad = useCallback(() => {
    requestAnimationFrame(() => {
      setSettledTimelineKey(timelineKey);
    });
  }, [timelineKey]);

  return (
    <View onTouchStart={onKeyboardDismissRequest} style={styles.transitionHost}>
      {!isLoading ? (
        rows.length === 0 && !isRunning ? (
          <Animated.View style={[styles.transitionScene, timelineContentStyle]}>
            <View style={styles.empty}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Send a message to start the conversation.
              </ThemedText>
            </View>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.transitionScene, timelineContentStyle]}>
            <KeyboardAwareLegendList
              key={timelineKey}
              ref={listRef}
              alignItemsAtEnd
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
              contentInsetEndAdjustment={extraContentPadding}
              data={rows}
              estimatedItemSize={MESSAGE_ESTIMATED_ITEM_SIZE}
              freeze={keyboardLayoutFrozen}
              getItemType={messageItemType}
              initialScrollAtEnd
              keyExtractor={messageKeyExtractor}
              renderItem={renderMessage}
              contentContainerStyle={styles.content}
              keyboardDismissMode="interactive"
              keyboardLiftBehavior="whenAtEnd"
              keyboardOffset={bottom - 24}
              keyboardShouldPersistTaps="handled"
              maintainScrollAtEnd={MAINTAIN_SCROLL_AT_END}
              maintainScrollAtEndThreshold={MAINTAIN_SCROLL_AT_END_THRESHOLD}
              maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
              onLoad={handleTimelineLoad}
              recycleItems={false}
              scrollEventThrottle={48}
              showsVerticalScrollIndicator={false}
              style={styles.list}
              ListFooterComponent={
                isRunning ? <RunningFooter /> : <View style={styles.listEndPad} />
              }
            />
          </Animated.View>
        )
      ) : null}
      {showLoadingConversation ? (
        <Animated.View
          key={`loading-${timelineKey}`}
          entering={TIMELINE_LOADING_ENTER}
          exiting={TIMELINE_LOADING_EXIT}
          style={styles.transitionScene}
        >
          <LoadingConversation />
        </Animated.View>
      ) : null}
    </View>
  );
}

function LoadingConversation() {
  return (
    <View style={styles.empty} accessibilityRole="progressbar">
      <ActivityIndicator color={Colors.dark.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        Loading conversation…
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.two,
    justifyContent: "center",
    padding: Spacing.four,
  },
  emptyText: {
    maxWidth: 260,
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  listEndPad: {
    height: Spacing.two,
  },
  transitionHost: {
    flex: 1,
    overflow: "hidden",
  },
  transitionScene: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
