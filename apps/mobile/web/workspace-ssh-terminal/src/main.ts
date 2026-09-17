import { linkBridge } from "@webview-bridge/web";
import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import type {
  WorkspaceSshTerminalBridge,
  WorkspaceSshTerminalPostMessageSchema,
  WorkspaceSshTerminalState,
  WorkspaceSshTerminalSessionStatus,
} from "../../../src/components/chat/workspace-preview/workspace-ssh-terminal-bridge";

import "./style.css";

declare global {
  interface Window {
    __workspaceSshTerminalId?: string;
  }
}

const terminalId = window.__workspaceSshTerminalId ?? "";
const defaultFontSize = 13;
const defaultTerminalState: WorkspaceSshTerminalState = {
  fontSize: defaultFontSize,
  terminalId,
};
const bridge = linkBridge<WorkspaceSshTerminalBridge, WorkspaceSshTerminalPostMessageSchema>({
  debug: false,
  initialBridge: {
    ...defaultTerminalState,
    closeSession: async () => undefined,
    copySelection: async () => undefined,
    reportError: async () => undefined,
    reportReady: async () => undefined,
    reportSessionStatus: async () => undefined,
    resizeSession: async () => undefined,
    startOutputStream: async () => undefined,
    startSession: async () => ({ sessionId: "", workspacePath: "" }),
    stopOutputStream: async () => undefined,
    writeSession: async () => undefined,
  },
});

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let sessionId = "";
let nextSeq = 0;
let currentState = defaultTerminalState;
let reconnectTimer = 0;
let isStartingSession = false;
let isClosed = false;
let lastResize = { cols: 80, rows: 24 };
let lastReconnectRequestId = currentState.reconnectRequestId;
let lastCopySelectionRequestId = currentState.copySelectionRequestId;
let reconnectAttempt = 0;
let lastReportedStatus: WorkspaceSshTerminalSessionStatus | undefined;
let lastReportedMessage: string | undefined;
let scrollTouchLastY: number | undefined;

bridge.addEventListener("terminalState", (state) => {
  if (state.terminalId === terminalId) {
    currentState = state;
    applyTerminalState(state);
    if (
      typeof state.copySelectionRequestId === "number" &&
      state.copySelectionRequestId !== lastCopySelectionRequestId
    ) {
      lastCopySelectionRequestId = state.copySelectionRequestId;
      const text = terminal?.getSelection() ?? "";
      if (text) {
        void bridge.copySelection({ terminalId, text }).catch(() => {});
      }
    }
    if (
      typeof state.reconnectRequestId === "number" &&
      state.reconnectRequestId !== lastReconnectRequestId
    ) {
      lastReconnectRequestId = state.reconnectRequestId;
      void reconnectSession("manual");
    }
  }
});

bridge.addEventListener("terminalOutput", (event) => {
  if (event.terminalId !== terminalId || event.sessionId !== sessionId) {
    return;
  }
  handleOutputResponse(event.response);
});

void initializeTerminal();

async function initializeTerminal() {
  try {
    const ghostty = await Ghostty.load(ghosttyWasmUrl);
    terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: currentState.fontSize ?? defaultFontSize,
      ghostty,
      scrollback: 10000,
      theme: {
        background: "#1F1F1F",
        cursor: "#F2F2F2",
        foreground: "#F2F2F2",
        selectionBackground: "#383838",
      },
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerElement());
    setupTouchScroll();
    fitAddon.fit();
    fitAddon.observeResize();
    terminal.onResize((size) => {
      lastResize = normalizeTerminalSize(size);
      if (sessionId) {
        void bridge
          .resizeSession({
            cols: lastResize.cols,
            rows: lastResize.rows,
            sessionId,
            terminalId,
          })
          .catch(() => {});
      }
    });

    await bridge.reportReady({ terminalId });
    await startSession("connecting");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    terminal?.writeln(`\r\nTerminal failed: ${message}`);
    await bridge.reportError({ message, terminalId });
  }
}

function setupTouchScroll() {
  const container = containerElement();

  const dispatchSelectionMouseEvent = (
    type: "mousedown" | "mousemove" | "mouseup",
    touch: Touch,
  ) => {
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const eventTarget = target instanceof HTMLElement ? target : container;

    eventTarget.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        screenX: touch.screenX,
        screenY: touch.screenY,
        view: window,
      }),
    );
  };

  container.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        scrollTouchLastY = undefined;
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      if (currentState.selectionMode) {
        event.preventDefault();
        scrollTouchLastY = undefined;
        dispatchSelectionMouseEvent("mousedown", touch);
        return;
      }

      scrollTouchLastY = touch.clientY;
    },
    { passive: false },
  );

  container.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      if (currentState.selectionMode) {
        event.preventDefault();
        dispatchSelectionMouseEvent("mousemove", touch);
        return;
      }

      if (scrollTouchLastY === undefined) {
        return;
      }

      const nextY = touch.clientY;
      const deltaY = nextY - scrollTouchLastY;
      scrollTouchLastY = nextY;

      if (Math.abs(deltaY) < 2) {
        return;
      }

      event.preventDefault();
      container.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: -deltaY,
        }),
      );
    },
    { passive: false },
  );

  container.addEventListener(
    "touchend",
    (event) => {
      if (currentState.selectionMode) {
        const touch = event.changedTouches[0];
        if (touch) {
          event.preventDefault();
          dispatchSelectionMouseEvent("mouseup", touch);
        }
      }
      scrollTouchLastY = undefined;
    },
    { passive: false },
  );

  container.addEventListener(
    "touchcancel",
    (event) => {
      if (currentState.selectionMode) {
        const touch = event.changedTouches[0];
        if (touch) {
          event.preventDefault();
          dispatchSelectionMouseEvent("mouseup", touch);
        }
      }
      scrollTouchLastY = undefined;
    },
    { passive: false },
  );
}

function applyTerminalState(state: WorkspaceSshTerminalState) {
  if (!terminal || typeof state.fontSize !== "number") {
    return;
  }
  const options = terminal.options;
  if (options.fontSize === state.fontSize) {
    return;
  }
  options.fontSize = state.fontSize;
  fitAddon?.fit();
}

async function startSession(status: WorkspaceSshTerminalSessionStatus) {
  if (!terminal) {
    return;
  }
  if (isStartingSession) {
    return;
  }
  isStartingSession = true;
  isClosed = false;
  await reportSessionStatus(status);
  fitAddon?.fit();
  lastResize = normalizeTerminalSize({
    cols: terminal.cols || 80,
    rows: terminal.rows || 24,
  });
  try {
    const previousSessionId = sessionId;
    if (previousSessionId) {
      await bridge.stopOutputStream({ sessionId: previousSessionId, terminalId }).catch(() => {});
    }
    const response = await bridge.startSession({
      cols: lastResize.cols,
      rows: lastResize.rows,
      terminalId,
    });
    sessionId = response.sessionId;
    reconnectAttempt = 0;
    await reportSessionStatus("connected");
    if (previousSessionId && previousSessionId !== sessionId) {
      nextSeq = 0;
      terminal.writeln("\r\n[previous terminal session was unavailable; started a new one]\r\n");
    }
    await bridge.startOutputStream({ sessionId, since: nextSeq, terminalId });
  } catch (error) {
    scheduleReconnect(error);
  } finally {
    isStartingSession = false;
  }
}

function normalizeTerminalSize(size: { cols: number; rows: number }) {
  const cols = Number.isFinite(size.cols) ? Math.floor(size.cols) : 80;
  const rows = Number.isFinite(size.rows) ? Math.floor(size.rows) : 24;
  return {
    cols: Math.min(300, Math.max(cols, 2)),
    rows: Math.min(120, Math.max(rows, 2)),
  };
}

function handleOutputResponse(response: {
  chunks?: Array<{ data: string; seq: number }>;
  exitCode?: number | null;
  exitedAt?: string;
  nextSeq?: number;
}) {
  const chunks = Array.isArray(response?.chunks) ? response.chunks : [];
  for (const chunk of chunks) {
    terminal?.write(chunk.data);
  }
  nextSeq = typeof response?.nextSeq === "number" ? response.nextSeq : nextSeq;
  reconnectAttempt = 0;
  void reportSessionStatus("connected");
  if (response?.exitedAt) {
    isClosed = true;
    void reportSessionStatus(
      "closed",
      typeof response.exitCode === "number" ? `Exited with ${response.exitCode}` : undefined,
    );
    terminal?.writeln(
      `\r\n[session closed${typeof response.exitCode === "number" ? `: ${response.exitCode}` : ""}]\r\n`,
    );
  }
}

function scheduleReconnect(error: unknown) {
  if (isClosed) {
    return;
  }
  reconnectAttempt += 1;
  const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 4), 15000);
  const message = `Retrying in ${Math.round(delay / 1000)}s: ${errorMessage(error)}`;
  void reportSessionStatus("reconnecting", message);
  if (reconnectAttempt === 1) {
    terminal?.writeln(
      `\r\n[connection interrupted; reconnecting to the same terminal session]\r\n`,
    );
  }
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0;
    void reconnectSession("auto");
  }, delay);
}

async function reconnectSession(source: "auto" | "manual") {
  if (!terminal) {
    return;
  }
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }
  if (source === "manual") {
    terminal.writeln("\r\n[reconnecting to the existing terminal session]\r\n");
  }
  await startSession("reconnecting");
}

async function reportSessionStatus(status: WorkspaceSshTerminalSessionStatus, message?: string) {
  if (lastReportedStatus === status && lastReportedMessage === message) {
    return;
  }
  lastReportedStatus = status;
  lastReportedMessage = message;
  await bridge
    .reportSessionStatus({
      message,
      sessionId: sessionId || undefined,
      status,
      terminalId,
    })
    .catch(() => {});
}

window.addEventListener("resize", () => {
  fitAddon?.fit();
});

window.addEventListener("beforeunload", () => {
  isClosed = true;
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
  }
  if (sessionId) {
    void bridge.stopOutputStream({ sessionId, terminalId }).catch(() => {});
  }
});

function containerElement() {
  const container = document.getElementById("terminal-container");
  if (!container) {
    throw new Error("Terminal container is missing.");
  }
  return container;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
