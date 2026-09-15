import { bridge, createWebView } from "@webview-bridge/react-native";

import type { WorkspaceTerminalOutputResponse } from "codex-relay/api-schema";

export type WorkspaceSshTerminalState = {
  copySelectionRequestId?: number;
  fontSize?: number;
  selectionMode?: boolean;
  reconnectRequestId?: number;
  terminalId: string;
  workspacePath?: string;
};

export type WorkspaceSshTerminalSessionStatus =
  | "closed"
  | "connected"
  | "connecting"
  | "reconnecting";

type WorkspaceSshTerminalBridgeShape = WorkspaceSshTerminalState & {
  closeSession(request: WorkspaceSshTerminalSessionRequest): Promise<void>;
  copySelection(request: WorkspaceSshTerminalCopyRequest): Promise<void>;
  reportError(request: WorkspaceSshTerminalErrorRequest): Promise<void>;
  reportReady(request: WorkspaceSshTerminalReadyRequest): Promise<void>;
  reportSessionStatus(request: WorkspaceSshTerminalStatusRequest): Promise<void>;
  resizeSession(request: WorkspaceSshTerminalResizeRequest): Promise<void>;
  startOutputStream(request: WorkspaceSshTerminalReadRequest): Promise<void>;
  startSession(
    request: WorkspaceSshTerminalStartRequest,
  ): Promise<{ sessionId: string; workspacePath: string }>;
  stopOutputStream(request: WorkspaceSshTerminalSessionRequest): Promise<void>;
  writeSession(request: WorkspaceSshTerminalWriteRequest): Promise<void>;
};

type WorkspaceSshTerminalReadyRequest = {
  terminalId: string;
};

type WorkspaceSshTerminalCopyRequest = WorkspaceSshTerminalReadyRequest & {
  text: string;
};

type WorkspaceSshTerminalErrorRequest = WorkspaceSshTerminalReadyRequest & {
  message: string;
};

type WorkspaceSshTerminalStatusRequest = WorkspaceSshTerminalReadyRequest & {
  message?: string;
  sessionId?: string;
  status: WorkspaceSshTerminalSessionStatus;
};

type WorkspaceSshTerminalSessionRequest = WorkspaceSshTerminalReadyRequest & {
  sessionId: string;
};

type WorkspaceSshTerminalReadRequest = WorkspaceSshTerminalSessionRequest & {
  since: number;
};

type WorkspaceSshTerminalResizeRequest = WorkspaceSshTerminalSessionRequest & {
  cols: number;
  rows: number;
};

type WorkspaceSshTerminalStartRequest = WorkspaceSshTerminalReadyRequest & {
  cols: number;
  rows: number;
};

type WorkspaceSshTerminalWriteRequest = WorkspaceSshTerminalSessionRequest & {
  data: string;
};

type WorkspaceSshTerminalBridgeHandlers = {
  closeSession(sessionId: string): Promise<void>;
  copySelection(text: string): Promise<void>;
  reportError(message: string): void;
  reportReady(): void;
  reportSessionStatus(
    status: WorkspaceSshTerminalSessionStatus,
    message: string | undefined,
    sessionId: string | undefined,
  ): void;
  resizeSession(sessionId: string, cols: number, rows: number): Promise<void>;
  startOutputStream(sessionId: string, since: number): Promise<void>;
  startSession(cols: number, rows: number): Promise<{ sessionId: string; workspacePath: string }>;
  stopOutputStream(sessionId: string): Promise<void>;
  writeSession(sessionId: string, data: string): Promise<void>;
};

const defaultTerminalState: WorkspaceSshTerminalState = {
  terminalId: "",
};

const workspaceSshTerminalBridgeHandlers = new Map<string, WorkspaceSshTerminalBridgeHandlers>();
let nextWorkspaceSshTerminalId = 0;

export const workspaceSshTerminalPostMessageSchema = {
  terminalOutput: {
    validate(value: unknown) {
      return value as WorkspaceSshTerminalOutputEvent;
    },
  },
  terminalState: {
    validate(value: unknown) {
      return value as WorkspaceSshTerminalState;
    },
  },
};

export type WorkspaceSshTerminalOutputEvent = {
  response: WorkspaceTerminalOutputResponse;
  sessionId: string;
  terminalId: string;
};

export type WorkspaceSshTerminalPostMessageSchema = typeof workspaceSshTerminalPostMessageSchema;

export const workspaceSshTerminalBridge = bridge<WorkspaceSshTerminalBridgeShape>(() => ({
  ...defaultTerminalState,
  async closeSession(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.closeSession(request.sessionId);
  },
  async copySelection(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.copySelection(request.text);
  },
  async reportError(request) {
    workspaceSshTerminalBridgeHandlers.get(request.terminalId)?.reportError(request.message);
  },
  async reportReady(request) {
    workspaceSshTerminalBridgeHandlers.get(request.terminalId)?.reportReady();
  },
  async reportSessionStatus(request) {
    workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.reportSessionStatus(request.status, request.message, request.sessionId);
  },
  async resizeSession(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.resizeSession(request.sessionId, request.cols, request.rows);
  },
  async startOutputStream(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.startOutputStream(request.sessionId, request.since);
  },
  async startSession(request) {
    const response = await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.startSession(request.cols, request.rows);
    if (!response) {
      throw new Error("Terminal bridge is not ready.");
    }
    return response;
  },
  async stopOutputStream(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.stopOutputStream(request.sessionId);
  },
  async writeSession(request) {
    await workspaceSshTerminalBridgeHandlers
      .get(request.terminalId)
      ?.writeSession(request.sessionId, request.data);
  },
}));

export const {
  postMessage: postWorkspaceSshTerminalBridgeMessage,
  WebView: WorkspaceSshTerminalBridgeWebView,
} = createWebView({
  bridge: workspaceSshTerminalBridge,
  debug: __DEV__,
  postMessageSchema: workspaceSshTerminalPostMessageSchema,
  responseTimeout: 8000,
});

export function createWorkspaceSshTerminalId() {
  nextWorkspaceSshTerminalId += 1;
  return `workspace-ssh-terminal-${nextWorkspaceSshTerminalId}`;
}

export function registerWorkspaceSshTerminalBridgeHandlers(
  terminalId: string,
  handlers: WorkspaceSshTerminalBridgeHandlers,
) {
  workspaceSshTerminalBridgeHandlers.set(terminalId, handlers);
  return () => {
    if (workspaceSshTerminalBridgeHandlers.get(terminalId) === handlers) {
      workspaceSshTerminalBridgeHandlers.delete(terminalId);
    }
  };
}

export function postWorkspaceSshTerminalState(state: WorkspaceSshTerminalState) {
  workspaceSshTerminalBridge.setState(state);
  postWorkspaceSshTerminalBridgeMessage("terminalState", state, {
    broadcast: true,
  });
}

export function postWorkspaceSshTerminalOutput(event: WorkspaceSshTerminalOutputEvent) {
  postWorkspaceSshTerminalBridgeMessage("terminalOutput", event, {
    broadcast: true,
  });
}

export type WorkspaceSshTerminalBridge = typeof workspaceSshTerminalBridge;
