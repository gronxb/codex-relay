// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  windowWidth: 1600,
  arrangementLayout: null as null | ((layout: unknown) => void),
}));

vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: object) => styles,
    absoluteFillObject: {},
    flatten: (style: unknown) => style,
  },
  useWindowDimensions: () => ({ width: native.windowWidth }),
  View: ({ children, onLayout }: { children: ReactNode; onLayout?: (event: unknown) => void }) => {
    useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { width: native.windowWidth } } });
    }, [onLayout]);
    return <div>{children}</div>;
  },
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: (styles: object) => styles } }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-gesture-handler", () => {
  const gesture: Record<string, unknown> = {};
  for (const key of [
    "runOnJS",
    "enabled",
    "activeOffsetX",
    "failOffsetY",
    "onStart",
    "onUpdate",
    "onEnd",
  ]) {
    gesture[key] = () => gesture;
  }
  return {
    Gesture: { Pan: () => gesture },
    GestureDetector: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
}));
vi.mock("react-native-arrangement-view", () => ({
  ArrangementView: Object.assign(
    ({
      children,
      onArrangementLayoutChange,
    }: {
      children: ReactNode;
      onArrangementLayoutChange: (layout: unknown) => void;
    }) => {
      native.arrangementLayout = onArrangementLayoutChange;
      return <div>{children}</div>;
    },
    {
      Primary: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Secondary: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    },
  ),
}));

import { AdaptivePanes } from "./adaptive-panes";
import { IpadSplitLayoutProvider, useIpadSplitLayout } from "../chat/ipad-split-layout";

describe("adaptive workspace panes", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mounted = vi.fn<(name: string) => void>();
  const unmounted = vi.fn<(name: string) => void>();
  const onArrangementChange = vi.fn<(layout: { hingeSplit: boolean }) => void>();

  function StatefulPane({ name }: { name: string }) {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      mounted(name);
      return () => unmounted(name);
    }, [name]);
    return (
      <button onClick={() => setDraft("unsent draft")}>
        {name}:{draft}
      </button>
    );
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(width: number, sideBySide: boolean, selectedPane = 0, previewShown = true) {
    native.windowWidth = width;
    act(() =>
      root.render(
        <AdaptivePanes
          primary={<StatefulPane name="chat" />}
          secondary={<StatefulPane name="terminal" />}
          secondaryPlaceholder={<span>preview hidden</span>}
          divider={<div />}
          secondaryWidth={360}
          dividerWidth={14}
          sideBySide={sideBySide}
          selectedPane={selectedPane}
          previewShown={previewShown}
          onSelectPane={vi.fn<(pane: number) => void>()}
          onLayout={vi.fn<() => void>()}
          onArrangementChange={onArrangementChange}
        />,
      ),
    );
  }

  function foldTo(hingeSplit: boolean) {
    act(() =>
      native.arrangementLayout?.({
        secondaryVisible: true,
        axis: hingeSplit ? "horizontal" : null,
        isOverlapping: !hingeSplit,
      }),
    );
  }

  it("keeps drafts and mounted terminal sessions through fold, rotation, and preview hide/show", () => {
    render(390, false);
    act(() => container.querySelectorAll("button").forEach((button) => button.click()));
    render(960, true);
    render(960, true, 0, false);
    render(960, true);
    render(390, false, 1);
    render(844, true, 1);

    expect(mounted.mock.calls).toEqual([["chat"], ["terminal"]]);
    expect(unmounted).not.toHaveBeenCalled();
    expect(container.textContent).toBe("chat:unsent draftterminal:unsent draft");
  });

  it("reports a hinge split and keeps both panes mounted either side of the crease", () => {
    render(390, false, 1);
    act(() => container.querySelectorAll("button").forEach((button) => button.click()));
    foldTo(true);
    expect(onArrangementChange).toHaveBeenLastCalledWith({ hingeSplit: true, axis: "horizontal" });
    render(390, true, 1);
    foldTo(false);
    expect(onArrangementChange).toHaveBeenLastCalledWith({ hingeSplit: false, axis: null });

    expect(unmounted).not.toHaveBeenCalled();
    expect(container.textContent).toBe("chat:unsent draftterminal:unsent draft");
  });

  it("offers to show the preview in the empty half only while hinge-split", () => {
    render(844, true, 0, false);
    expect(container.textContent).not.toContain("preview hidden");
    foldTo(true);
    expect(container.textContent).toContain("preview hidden");
    render(844, true, 0, true);
    expect(container.textContent).not.toContain("preview hidden");
  });

  it("restores the resized sidebar width after folding into the compact drawer", () => {
    function Sidebar() {
      const { resizeSidebar, sidebarWidth } = useIpadSplitLayout();
      return <button onClick={() => resizeSidebar(64)}>{sidebarWidth}</button>;
    }
    function renderSidebar(width: number) {
      native.windowWidth = width;
      act(() =>
        root.render(
          <IpadSplitLayoutProvider>
            <Sidebar />
          </IpadSplitLayoutProvider>,
        ),
      );
    }

    renderSidebar(1600);
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toBe("400");
    renderSidebar(390);
    renderSidebar(1600);
    expect(container.textContent).toBe("400");
  });
});
