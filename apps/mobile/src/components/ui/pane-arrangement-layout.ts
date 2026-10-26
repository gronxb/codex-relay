export type PaneArrangementLayout = {
  // The platform placed the panes on either side of a half-open hinge.
  hingeSplit: boolean;
  axis: "horizontal" | "vertical" | null;
};

export const FLAT_PANE_ARRANGEMENT: PaneArrangementLayout = { hingeSplit: false, axis: null };
