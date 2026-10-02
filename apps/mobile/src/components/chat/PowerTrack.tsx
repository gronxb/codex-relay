import { useCallback, useEffect, useMemo, useRef } from "react";
import { type AccessibilityActionEvent, type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { StyleSheet } from "react-native-unistyles";

import { useTheme } from "@/hooks/use-theme";

import {
  POWER_THUMB_SIZE,
  powerCrossedIndices,
  powerDetentedProgress,
  powerProgressForIndex,
  powerProgressForPosition,
  powerSelectionIndexForPosition,
  powerSelectionIndexWithHysteresis,
  powerTapTransitionStops,
  powerTransitionDuration,
} from "./power-selector-geometry";

const POWER_RELEASE_SNAP_MS = 100;

const SPARKLES = [
  { left: 10, size: 2, threshold: 0.82, top: 8 },
  { left: 17, size: 1.5, threshold: 0.84, top: 16 },
  { left: 29, size: 2, threshold: 0.85, top: 6 },
  { left: 37, size: 1.5, threshold: 0.87, top: 17 },
  { left: 48, size: 2.5, threshold: 0.88, top: 10 },
  { left: 57, size: 1.5, threshold: 0.9, top: 5 },
  { left: 64, size: 2.5, threshold: 0.91, top: 16 },
  { left: 72, size: 1.5, threshold: 0.92, top: 7 },
  { left: 78, size: 2, threshold: 0.94, top: 16 },
  { left: 84, size: 3, threshold: 0.95, top: 8 },
  { left: 90, size: 1.5, threshold: 0.97, top: 17 },
  { left: 94, size: 2, threshold: 0.98, top: 6 },
  { left: 22, size: 2.5, threshold: 0.89, top: 12 },
  { left: 43, size: 1.5, threshold: 0.93, top: 4 },
  { left: 69, size: 2, threshold: 0.96, top: 11 },
  { left: 88, size: 2.5, threshold: 0.99, top: 4 },
] as const;

export function PowerTrack({
  accessibilityValueLabel,
  onCommitIndex,
  onCrossIndex,
  selectedIndex,
  selectionCount,
}: {
  accessibilityValueLabel: string;
  onCommitIndex: (index: number) => void;
  onCrossIndex: (index: number) => void;
  selectedIndex: number;
  selectionCount: number;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const trackWidth = useSharedValue(0);
  const activeIndex = useSharedValue(selectedIndex);
  const detentScale = useSharedValue(1);
  const panActivated = useSharedValue(false);
  const progress = useSharedValue(powerProgressForIndex(selectedIndex, selectionCount));
  const onCommitIndexRef = useRef(onCommitIndex);
  const onCrossIndexRef = useRef(onCrossIndex);

  useEffect(() => {
    onCommitIndexRef.current = onCommitIndex;
    onCrossIndexRef.current = onCrossIndex;
  }, [onCommitIndex, onCrossIndex]);

  const commitIndex = useCallback((index: number) => onCommitIndexRef.current(index), []);
  const crossIndex = useCallback((index: number) => onCrossIndexRef.current(index), []);

  useEffect(() => {
    if (activeIndex.value === selectedIndex) {
      return;
    }
    const previousIndex = activeIndex.value;
    activeIndex.value = selectedIndex;
    progress.value = withTiming(powerProgressForIndex(selectedIndex, selectionCount), {
      duration: powerTransitionDuration(previousIndex, selectedIndex, selectionCount, reduceMotion),
    });
  }, [activeIndex, progress, reduceMotion, selectedIndex, selectionCount]);

  const gesture = useMemo(() => {
    function pulseDetent() {
      "worklet";

      if (reduceMotion) {
        return;
      }
      detentScale.value = withSequence(
        withTiming(0.965, { duration: 45 }),
        withTiming(1, { duration: 75 }),
      );
    }

    function trackPosition(position: number) {
      "worklet";

      const nextProgress = powerProgressForPosition(position, trackWidth.value);
      const nextIndex = powerSelectionIndexWithHysteresis(
        nextProgress,
        activeIndex.value,
        selectionCount,
      );
      progress.value = nextProgress;
      if (nextIndex !== activeIndex.value) {
        pulseDetent();
        for (const crossedIndex of powerCrossedIndices(activeIndex.value, nextIndex)) {
          scheduleOnRN(crossIndex, crossedIndex);
        }
        activeIndex.value = nextIndex;
      }
    }

    function animateTapStops(stops: ReturnType<typeof powerTapTransitionStops>, stopPosition = 0) {
      "worklet";

      const stop = stops[stopPosition];
      if (!stop) {
        return;
      }
      progress.value = withTiming(stop.progress, { duration: stop.duration }, (finished) => {
        if (!finished) {
          return;
        }
        pulseDetent();
        activeIndex.value = stop.index;
        scheduleOnRN(crossIndex, stop.index);
        if (stopPosition < stops.length - 1) {
          animateTapStops(stops, stopPosition + 1);
          return;
        }
        scheduleOnRN(commitIndex, stop.index);
      });
    }

    const panGesture = Gesture.Pan()
      .minDistance(2)
      .onBegin(() => {
        panActivated.value = false;
      })
      .onStart((event) => {
        panActivated.value = true;
        cancelAnimation(progress);
        cancelAnimation(detentScale);
        detentScale.value = 1;
        trackPosition(event.x);
      })
      .onUpdate((event) => trackPosition(event.x))
      .onFinalize((_event, success) => {
        if (!panActivated.value) {
          return;
        }
        panActivated.value = false;
        if (!success) {
          activeIndex.value = selectedIndex;
        }
        const settledIndex = activeIndex.value;
        progress.value = withTiming(
          powerProgressForIndex(settledIndex, selectionCount),
          { duration: reduceMotion ? 0 : POWER_RELEASE_SNAP_MS },
          (finished) => {
            if (finished) {
              scheduleOnRN(commitIndex, settledIndex);
            }
          },
        );
      });

    const tapGesture = Gesture.Tap()
      .maxDistance(5)
      .onBegin(() => {
        cancelAnimation(progress);
        cancelAnimation(detentScale);
        detentScale.value = 1;
      })
      .onEnd((event) => {
        const targetIndex = powerSelectionIndexForPosition(
          event.x,
          trackWidth.value,
          selectionCount,
        );
        const stops = powerTapTransitionStops(
          activeIndex.value,
          targetIndex,
          selectionCount,
          reduceMotion,
        );
        if (stops.length === 0) {
          progress.value = withTiming(powerProgressForIndex(targetIndex, selectionCount), {
            duration: reduceMotion ? 0 : POWER_RELEASE_SNAP_MS,
          });
          scheduleOnRN(commitIndex, targetIndex);
          return;
        }
        animateTapStops(stops);
      });

    return Gesture.Race(panGesture, tapGesture);
  }, [
    activeIndex,
    commitIndex,
    crossIndex,
    detentScale,
    panActivated,
    progress,
    reduceMotion,
    selectedIndex,
    selectionCount,
    trackWidth,
  ]);

  const inactiveMaskStyle = useAnimatedStyle(() => {
    const visualProgress = powerDetentedProgress(progress.value, selectionCount);
    return {
      width: trackWidth.value,
      transform: [{ translateX: visualProgress * trackWidth.value }],
    };
  });
  const thumbStyle = useAnimatedStyle(() => {
    const visualProgress = powerDetentedProgress(progress.value, selectionCount);
    return {
      transform: [
        {
          translateX: visualProgress * Math.max(trackWidth.value - POWER_THUMB_SIZE, 0),
        },
        { scale: detentScale.value },
      ],
    };
  });
  const ultraHaloStyle = useAnimatedStyle(() => {
    const visualProgress = powerDetentedProgress(progress.value, selectionCount);
    return {
      opacity: interpolate(visualProgress, [0.86, 1], [0, 0.52], Extrapolation.CLAMP),
      transform: [
        {
          scaleX: interpolate(visualProgress, [0.86, 1], [0.96, 1.01], Extrapolation.CLAMP),
        },
      ],
    };
  });
  const spectrumStyle = useAnimatedStyle(() => {
    const visualProgress = powerDetentedProgress(progress.value, selectionCount);
    return {
      opacity: interpolate(visualProgress, [0.82, 1], [0, 1], Extrapolation.CLAMP),
    };
  });

  function handleLayout(event: LayoutChangeEvent) {
    trackWidth.value = event.nativeEvent.layout.width;
  }

  function handleAccessibilityAction(event: AccessibilityActionEvent) {
    const delta = event.nativeEvent.actionName === "increment" ? 1 : -1;
    const nextIndex = Math.min(Math.max(selectedIndex + delta, 0), selectionCount - 1);
    if (nextIndex !== selectedIndex) {
      onCrossIndex(nextIndex);
      onCommitIndex(nextIndex);
    }
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityActions={[
          { label: "Increase Power", name: "increment" },
          { label: "Decrease Power", name: "decrement" },
        ]}
        accessibilityHint="Swipe up or down to adjust"
        accessibilityLabel="Power"
        accessibilityRole="adjustable"
        accessibilityValue={{
          max: selectionCount,
          min: 1,
          now: selectedIndex + 1,
          text: accessibilityValueLabel,
        }}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleLayout}
        style={styles.gestureSurface}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.ultraHalo, { backgroundColor: theme.powerMagenta }, ultraHaloStyle]}
        />
        <View
          pointerEvents="none"
          style={[styles.trackShell, { backgroundColor: theme.powerBlue }]}
        >
          <Animated.View style={[styles.gradient, spectrumStyle]}>
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id="power-spectrum" x1="0%" x2="100%" y1="0%" y2="0%">
                  <Stop offset="0%" stopColor={theme.powerBlue} />
                  <Stop offset="58%" stopColor={theme.powerViolet} />
                  <Stop offset="100%" stopColor={theme.powerMagenta} />
                </LinearGradient>
              </Defs>
              <Rect fill="url(#power-spectrum)" height="100%" rx={13} width="100%" x={0} y={0} />
            </Svg>
          </Animated.View>
          <Animated.View
            style={[styles.inactiveMask, { backgroundColor: theme.powerTrack }, inactiveMaskStyle]}
          />
          {SPARKLES.map((sparkle) => (
            <PowerSparkle
              key={`${sparkle.left}-${sparkle.top}`}
              progress={progress}
              reduceMotion={reduceMotion}
              selectionCount={selectionCount}
              ultraActive={selectedIndex === selectionCount - 1}
              {...sparkle}
            />
          ))}
          <View style={styles.stops}>
            {Array.from({ length: selectionCount }, (_, index) => (
              <View key={index} style={styles.stop} />
            ))}
          </View>
        </View>
        <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </GestureDetector>
  );
}

function PowerSparkle({
  left,
  progress,
  reduceMotion,
  selectionCount,
  size,
  threshold,
  top,
  ultraActive,
}: {
  left: number;
  progress: SharedValue<number>;
  reduceMotion: boolean;
  selectionCount: number;
  size: number;
  threshold: number;
  top: number;
  ultraActive: boolean;
}) {
  const twinkle = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(twinkle);
    if (!ultraActive) {
      twinkle.value = 0;
      return;
    }
    if (reduceMotion) {
      twinkle.value = 1;
      return;
    }

    const duration = 320 + ((left * 23) % 260);
    const delay = (left * 19) % 480;
    twinkle.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration }),
          withTiming(0, { duration: Math.round(duration * 1.15) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(twinkle);
  }, [left, reduceMotion, twinkle, ultraActive]);

  const animatedStyle = useAnimatedStyle(() => {
    const visualProgress = powerDetentedProgress(progress.value, selectionCount);
    const visibility = interpolate(
      visualProgress,
      [threshold, Math.min(threshold + 0.18, 1)],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const shimmer = 0.46 + twinkle.value * 0.54;
    return {
      opacity: visibility * shimmer,
      transform: [{ scale: 0.55 + visibility * (0.28 + twinkle.value * 0.32) }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.sparkle,
        {
          height: size,
          left: `${left}%`,
          top,
          width: size,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  gestureSurface: {
    height: 44,
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  ultraHalo: {
    borderCurve: "continuous",
    borderRadius: 15,
    height: 30,
    left: -2,
    position: "absolute",
    right: -2,
    top: 7,
  },
  trackShell: {
    borderCurve: "continuous",
    borderRadius: 13,
    height: 26,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 9,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  inactiveMask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  stops: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: POWER_THUMB_SIZE / 2,
    position: "absolute",
    right: 0,
    top: 0,
  },
  stop: {
    backgroundColor: "rgba(255, 255, 255, 0.58)",
    borderRadius: 999,
    height: 4,
    width: 4,
  },
  sparkle: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 999,
    position: "absolute",
  },
  thumb: {
    backgroundColor: "#FFFFFF",
    borderRadius: POWER_THUMB_SIZE / 2,
    elevation: 3,
    height: POWER_THUMB_SIZE,
    left: 0,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    top: 7,
    width: POWER_THUMB_SIZE,
  },
});
