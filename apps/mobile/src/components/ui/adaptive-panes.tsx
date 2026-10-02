import { useLayoutEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { ScrollView, View, type LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

// Keep both panes in the same native parents when the window folds or resizes.
export function AdaptivePanes({
  primary,
  secondary,
  divider,
  width,
  secondaryWidth,
  dividerWidth,
  sideBySide,
  secondaryVisible,
  selectedPane,
  onSelectPane,
  onLayout,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  divider: ReactNode;
  width: number;
  secondaryWidth: number;
  dividerWidth: number;
  sideBySide: boolean;
  secondaryVisible: boolean;
  selectedPane: number;
  onSelectPane: (pane: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const showsSecondPage = !sideBySide && secondaryVisible;
  const offset = showsSecondPage ? selectedPane * width : 0;

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ x: offset, animated: false });
  }, [offset, width]);

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={!sideBySide}
        scrollEnabled={showsSecondPage}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        onLayout={onLayout}
        onContentSizeChange={() => scrollRef.current?.scrollTo({ x: offset, animated: false })}
        onMomentumScrollEnd={(event) => {
          if (showsSecondPage && width > 0) {
            onSelectPane(
              Math.min(1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width))),
            );
          }
        }}
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View
          style={[
            styles.pane,
            {
              width: sideBySide && secondaryVisible ? width - secondaryWidth - dividerWidth : width,
            },
          ]}
          accessibilityElementsHidden={showsSecondPage && selectedPane === 1}
          importantForAccessibility={
            showsSecondPage && selectedPane === 1 ? "no-hide-descendants" : "auto"
          }
        >
          {primary}
        </View>
        <View style={sideBySide && secondaryVisible ? { width: dividerWidth } : styles.hidden}>
          {divider}
        </View>
        <View
          collapsable={false}
          pointerEvents={secondaryVisible ? "auto" : "none"}
          style={[
            styles.pane,
            { width: sideBySide ? secondaryWidth : width },
            !secondaryVisible && styles.hiddenPane,
          ]}
          accessibilityElementsHidden={!secondaryVisible || (showsSecondPage && selectedPane === 0)}
          importantForAccessibility={
            !secondaryVisible || (showsSecondPage && selectedPane === 0)
              ? "no-hide-descendants"
              : "auto"
          }
        >
          {secondary}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1 },
  pane: { height: "100%", minWidth: 0 },
  hidden: { display: "none" },
  // Fabric removes display:none descendants, recycling native WebView state.
  hiddenPane: { position: "absolute", left: 0, top: 0, opacity: 0 },
});
