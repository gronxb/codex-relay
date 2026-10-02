// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  scrollTo: vi.fn<(options: { x: number; animated: boolean }) => void>(),
  windowWidth: 1600,
}));

vi.mock("react-native", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    useWindowDimensions: () => ({ width: native.windowWidth }),
    View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ScrollView: ({
      children,
      ref,
    }: {
      children: ReactNode;
      ref: Ref<{ scrollTo: typeof native.scrollTo }>;
    }) => {
      useImperativeHandle(ref, () => ({ scrollTo: native.scrollTo }));
      return <div>{children}</div>;
    },
  };
});
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: (styles: object) => styles } }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AdaptivePanes } from "./adaptive-panes";
import { IpadSplitLayoutProvider, useIpadSplitLayout } from "../chat/ipad-split-layout";

describe("adaptive workspace panes", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mounted = vi.fn<(name: string) => void>();
  const unmounted = vi.fn<(name: string) => void>();

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

  function render(width: number, sideBySide: boolean, selectedPane = 0, secondaryVisible = true) {
    act(() =>
      root.render(
        <AdaptivePanes
          primary={<StatefulPane name="chat" />}
          secondary={<StatefulPane name="terminal" />}
          divider={<div />}
          width={width}
          secondaryWidth={360}
          dividerWidth={14}
          sideBySide={sideBySide}
          selectedPane={selectedPane}
          secondaryVisible={secondaryVisible}
          onSelectPane={vi.fn<(pane: number) => void>()}
          onLayout={vi.fn<() => void>()}
        />,
      ),
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

  it("keeps the selected compact page after a width change and resets the offset when unfolded", () => {
    render(390, false, 1);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 390, animated: false });
    render(430, false, 1);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 430, animated: false });
    render(960, true, 1);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: false });
    render(390, false, 1);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 390, animated: false });
  });

  it("returns to the chat when the secondary pane is unavailable", () => {
    render(390, false, 1);
    render(390, false, 1, false);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: false });
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
