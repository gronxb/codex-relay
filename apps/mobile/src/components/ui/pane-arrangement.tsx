import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { ArrangementView, type ArrangementLayout } from "react-native-arrangement-view";

import type { PaneArrangementLayout } from "./pane-arrangement-layout";

export type { PaneArrangementLayout } from "./pane-arrangement-layout";

// Two full-size, overlapping panes with the primary in front. The app lays the
// flat layout out itself inside each pane; a half-open hinge makes the
// platform separate the panes on either side of the crease, chat below or
// leading, workspace preview above or trailing.
export function PaneArrangement({
  primary,
  secondary,
  onLayoutChange,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  onLayoutChange: (layout: PaneArrangementLayout) => void;
}) {
  return (
    <ArrangementView
      style={styles.fill}
      arrangement="overlay"
      primaryEdge={["leading", "bottom"]}
      onArrangementLayoutChange={(layout: ArrangementLayout) =>
        onLayoutChange({
          hingeSplit: layout.secondaryVisible && !layout.isOverlapping,
          axis: layout.isOverlapping ? null : layout.axis,
        })
      }
    >
      <ArrangementView.Primary>{primary}</ArrangementView.Primary>
      <ArrangementView.Secondary>{secondary}</ArrangementView.Secondary>
    </ArrangementView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
