import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type { PaneArrangementLayout } from "./pane-arrangement-layout";

export type { PaneArrangementLayout } from "./pane-arrangement-layout";

// The web has no hinge: both panes overlap at full size, primary in front.
export function PaneArrangement({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  onLayoutChange: (layout: PaneArrangementLayout) => void;
}) {
  return (
    <View style={styles.fill}>
      <View pointerEvents="box-none" style={styles.pane}>
        {secondary}
      </View>
      <View pointerEvents="box-none" style={styles.pane}>
        {primary}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pane: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
