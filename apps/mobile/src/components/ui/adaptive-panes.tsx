import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { PaneArrangement } from "./pane-arrangement";
import { FLAT_PANE_ARRANGEMENT, type PaneArrangementLayout } from "./pane-arrangement-layout";

const PAGE_ANIMATION_MS = 220;
const PAGE_SWIPE_ACTIVATION = 24;
const PAGE_SWIPE_FAIL_Y = 16;

// Keep both panes mounted in their own native parents whatever the window does:
// flat compact windows page between them, flat wide windows show them side by
// side with a resizable divider, and a half-open hinge lets the platform place
// one on each half of the screen.
export function AdaptivePanes({
  primary,
  secondary,
  secondaryPlaceholder,
  divider,
  secondaryWidth,
  dividerWidth,
  sideBySide,
  previewShown,
  selectedPane,
  onSelectPane,
  onLayout,
  onArrangementChange,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  // Shown in the secondary half while a hinge split hides the preview.
  secondaryPlaceholder?: ReactNode;
  divider: ReactNode;
  secondaryWidth: number;
  dividerWidth: number;
  sideBySide: boolean;
  previewShown: boolean;
  selectedPane: number;
  onSelectPane: (pane: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onArrangementChange?: (layout: PaneArrangementLayout) => void;
}) {
  const [width, setWidth] = useState(0);
  const [arrangement, setArrangement] = useState<PaneArrangementLayout>(FLAT_PANE_ARRANGEMENT);
  const hingeSplit = arrangement.hingeSplit;
  const pagesBetweenPanes = !hingeSplit && !sideBySide && previewShown;
  const splitsSideBySide = !hingeSplit && sideBySide && previewShown;
  const targetPage = pagesBetweenPanes ? Math.min(1, Math.max(0, selectedPane)) : 0;
  const page = useSharedValue(targetPage);
  const dragStartPage = useSharedValue(0);

  useEffect(() => {
    page.value = pagesBetweenPanes
      ? withTiming(targetPage, { duration: PAGE_ANIMATION_MS })
      : targetPage;
  }, [page, pagesBetweenPanes, targetPage]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      setWidth((current) => (current === nextWidth ? current : nextWidth));
      onLayout(event);
    },
    [onLayout],
  );

  const handleArrangementChange = useCallback(
    (layout: PaneArrangementLayout) => {
      setArrangement((current) =>
        current.hingeSplit === layout.hingeSplit && current.axis === layout.axis ? current : layout,
      );
      onArrangementChange?.(layout);
    },
    [onArrangementChange],
  );

  const pageGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(pagesBetweenPanes && width > 0)
        .activeOffsetX([-PAGE_SWIPE_ACTIVATION, PAGE_SWIPE_ACTIVATION])
        .failOffsetY([-PAGE_SWIPE_FAIL_Y, PAGE_SWIPE_FAIL_Y])
        .onStart(() => {
          dragStartPage.value = page.value;
        })
        .onUpdate((event) => {
          page.value = Math.min(1, Math.max(0, dragStartPage.value - event.translationX / width));
        })
        .onEnd((event) => {
          const projected = page.value - (event.velocityX / width) * 0.2;
          const next = projected > 0.5 ? 1 : 0;
          page.value = withTiming(next, { duration: PAGE_ANIMATION_MS });
          onSelectPane(next);
        }),
    [dragStartPage, onSelectPane, page, pagesBetweenPanes, width],
  );

  const primaryWidth = splitsSideBySide ? Math.max(0, width - secondaryWidth - dividerWidth) : null;

  const primaryStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pagesBetweenPanes ? -page.value * width : 0 }],
  }));
  const secondaryStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: pagesBetweenPanes ? (1 - page.value) * width : previewShown ? 0 : width,
      },
    ],
  }));

  const primaryHidden = pagesBetweenPanes && selectedPane === 1;
  const secondaryHidden = !previewShown || (pagesBetweenPanes && selectedPane === 0);

  return (
    <GestureDetector gesture={pageGesture}>
      <View collapsable={false} onLayout={handleLayout} style={styles.fill}>
        <PaneArrangement
          onLayoutChange={handleArrangementChange}
          primary={
            <View collapsable={false} pointerEvents="box-none" style={styles.fill}>
              <Animated.View
                collapsable={false}
                style={[
                  styles.pane,
                  styles.leadingPane,
                  primaryWidth === null ? styles.fullWidth : { width: primaryWidth },
                  primaryStyle,
                ]}
                accessibilityElementsHidden={primaryHidden}
                importantForAccessibility={primaryHidden ? "no-hide-descendants" : "auto"}
              >
                <SafeAreaView edges={["left", "right"]} style={styles.fill}>
                  {primary}
                </SafeAreaView>
              </Animated.View>
              {splitsSideBySide ? (
                <View style={[styles.divider, { left: primaryWidth ?? 0, width: dividerWidth }]}>
                  {divider}
                </View>
              ) : null}
            </View>
          }
          secondary={
            <View collapsable={false} pointerEvents="box-none" style={styles.fill}>
              <Animated.View
                collapsable={false}
                pointerEvents={previewShown ? "auto" : "none"}
                style={[
                  styles.pane,
                  splitsSideBySide
                    ? [styles.trailingPane, { width: secondaryWidth }]
                    : [styles.leadingPane, styles.fullWidth],
                  !previewShown && styles.hiddenPane,
                  secondaryStyle,
                ]}
                accessibilityElementsHidden={secondaryHidden}
                importantForAccessibility={secondaryHidden ? "no-hide-descendants" : "auto"}
              >
                <SafeAreaView edges={["left", "right"]} style={styles.fill}>
                  {secondary}
                </SafeAreaView>
              </Animated.View>
              {hingeSplit && !previewShown && secondaryPlaceholder ? (
                <SafeAreaView
                  edges={["left", "right"]}
                  style={[styles.pane, styles.leadingPane, styles.fullWidth]}
                >
                  {secondaryPlaceholder}
                </SafeAreaView>
              ) : null}
            </View>
          }
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pane: { position: "absolute", top: 0, bottom: 0, minWidth: 0 },
  leadingPane: { left: 0 },
  trailingPane: { right: 0 },
  fullWidth: { width: "100%" },
  divider: { position: "absolute", top: 0, bottom: 0 },
  // Fabric removes display:none descendants, recycling native WebView state.
  hiddenPane: { opacity: 0 },
});
