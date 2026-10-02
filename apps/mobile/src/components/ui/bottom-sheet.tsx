import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hapticSelection } from "@/lib/haptics";
import { Icon } from "./icon";
import { Text } from "./text";

export { SheetActionRow, SheetSelectedDot } from "./bottom-sheet-action-row";

const KEYBOARD_DISMISS_PRESENT_FALLBACK_MS = 360;

export function AppBottomSheet({
  backAccessibilityLabel = "Back",
  children,
  androidKeyboardInputMode = "adjustResize",
  enableDynamicSizing = true,
  enableBlurKeyboardOnGesture = true,
  expandedSnapPercent: expandedSnapPercentOverride,
  initialSnapIndex = 0,
  keyboardBehavior = "interactive",
  keyboardBlurBehavior = "restore",
  onBack,
  onClose,
  scrollable = true,
  subtitle,
  title,
  visible,
}: {
  androidKeyboardInputMode?: "adjustPan" | "adjustResize";
  backAccessibilityLabel?: string;
  children: ReactNode;
  enableDynamicSizing?: boolean;
  enableBlurKeyboardOnGesture?: boolean;
  expandedSnapPercent?: number;
  initialSnapIndex?: number;
  keyboardBehavior?: "interactive" | "extend" | "fillParent";
  keyboardBlurBehavior?: "none" | "restore";
  onBack?: () => void;
  onClose: () => void;
  scrollable?: boolean;
  subtitle?: string;
  title: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const sheetRef = useRef<BottomSheetModal>(null);
  const presentFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const [isMounted, setMounted] = useState(visible);
  const shouldRenderSheet = visible || isMounted;
  const maxSheetHeight = expandedSnapPercentOverride
    ? Math.max(280, windowHeight * (expandedSnapPercentOverride / 100))
    : Math.max(280, Math.min(windowHeight * 0.94, windowHeight - insets.top - 6));
  const expandedSnapPercent =
    expandedSnapPercentOverride ?? Math.max(48, Math.round((maxSheetHeight / windowHeight) * 100));
  const collapsedSnapPercent = Math.min(48, Math.max(32, expandedSnapPercent - 18));
  const snapPoints = useMemo(
    () =>
      collapsedSnapPercent === expandedSnapPercent
        ? [`${expandedSnapPercent}%`]
        : [`${collapsedSnapPercent}%`, `${expandedSnapPercent}%`],
    [collapsedSnapPercent, expandedSnapPercent],
  );
  const clampedInitialSnapIndex = Math.min(initialSnapIndex, snapPoints.length - 1);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }

    if (!isMounted) {
      return;
    }

    dismissKeyboard();
    sheetRef.current?.dismiss();
  }, [isMounted, visible]);

  useEffect(() => {
    if (!shouldRenderSheet || !visible) {
      return;
    }

    let didCancel = false;

    const presentSheet = () => {
      if (didCancel) {
        return;
      }
      presentFrameRef.current = requestAnimationFrame(() => {
        presentFrameRef.current = undefined;
        if (!didCancel) {
          sheetRef.current?.present();
        }
      });
    };

    void dismissKeyboardBeforePresent().finally(() => {
      presentSheet();
    });

    return () => {
      didCancel = true;
      if (presentFrameRef.current) {
        cancelAnimationFrame(presentFrameRef.current);
        presentFrameRef.current = undefined;
      }
    };
  }, [shouldRenderSheet, visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.34}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleDismiss = useCallback(() => {
    dismissKeyboard();
    setMounted(false);
    if (visible) {
      onClose();
    }
  }, [onClose, visible]);

  if (!shouldRenderSheet) {
    return null;
  }

  const content = (
    <>
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            accessibilityLabel={backAccessibilityLabel}
            accessibilityRole="button"
            onPress={() => {
              hapticSelection();
              onBack();
            }}
            style={({ pressed }) => [styles.backButton, pressed ? styles.backPressed : null]}
          >
            <Icon name="back" size={18} tintColor={theme.text} />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondaryStrong }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {children}
    </>
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      backdropComponent={renderBackdrop}
      backgroundStyle={[
        styles.background,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.backgroundSelected,
        },
      ]}
      bottomInset={0}
      android_keyboardInputMode={androidKeyboardInputMode}
      enableBlurKeyboardOnGesture={enableBlurKeyboardOnGesture}
      enableDismissOnClose
      enableDynamicSizing={enableDynamicSizing}
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      handleStyle={styles.handle}
      index={clampedInitialSnapIndex}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior={keyboardBlurBehavior}
      maxDynamicContentSize={maxSheetHeight}
      onDismiss={handleDismiss}
      snapPoints={snapPoints}
      style={[styles.sheetContainer, { marginLeft: insets.left, marginRight: insets.right }]}
      topInset={insets.top + 6}
    >
      {scrollable ? (
        <BottomSheetScrollView
          bounces={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(14, insets.bottom + 8) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView
          style={[styles.content, { paddingBottom: Math.max(14, insets.bottom + 8) }]}
        >
          {content}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
}

export { BottomSheetTextInput as AppBottomSheetTextInput };

async function dismissKeyboardBeforePresent() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      KeyboardController.dismiss().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, KEYBOARD_DISMISS_PRESENT_FALLBACK_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function dismissKeyboard() {
  void KeyboardController.dismiss().catch(() => undefined);
}

const styles = StyleSheet.create({
  background: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
  },
  sheetContainer: {
    overflow: "hidden",
  },
  handle: {
    paddingBottom: 4,
    paddingTop: 8,
  },
  handleIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    height: 4,
    width: 38,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    marginLeft: -8,
    marginRight: -2,
    width: 44,
  },
  backPressed: {
    opacity: 0.62,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    lineHeight: 20,
    paddingBottom: 4,
    paddingHorizontal: 6,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  content: {
    alignSelf: "stretch",
    gap: 2,
    paddingHorizontal: 14,
  },
});
