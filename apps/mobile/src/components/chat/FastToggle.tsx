import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hapticSelection } from "@/lib/haptics";

const TRACK_WIDTH = 36;
const THUMB_SIZE = 16;
const TRACK_INSET = 2;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - TRACK_INSET * 2;

export function FastToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(enabled ? 1 : 0);

  useEffect(() => {
    const destination = enabled ? 1 : 0;
    progress.value = reduceMotion ? destination : withTiming(destination, { duration: 140 });
  }, [enabled, progress, reduceMotion]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.powerTrack, theme.powerBlue]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [0, THUMB_TRAVEL]) }],
  }));

  return (
    <Pressable
      accessibilityHint="1.5x speed, more usage"
      accessibilityLabel="Fast"
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      onPress={() => {
        hapticSelection();
        onChange(!enabled);
      }}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Icon
        name="fast"
        size={15}
        strokeWidth={1.9}
        tintColor={enabled ? theme.powerBlue : theme.textSecondary}
      />
      <Text style={[styles.label, { color: enabled ? theme.text : theme.textSecondaryStrong }]}>
        Fast
      </Text>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, { backgroundColor: theme.text }, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    gap: Spacing.two,
    height: 44,
    justifyContent: "flex-end",
    paddingLeft: Spacing.two,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  track: {
    borderCurve: "continuous",
    borderRadius: 10,
    height: 20,
    justifyContent: "center",
    paddingHorizontal: TRACK_INSET,
    width: TRACK_WIDTH,
  },
  thumb: {
    borderCurve: "continuous",
    borderRadius: THUMB_SIZE / 2,
    height: THUMB_SIZE,
    width: THUMB_SIZE,
  },
  pressed: {
    opacity: 0.66,
  },
});
