import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

import {
  resolveCodexAppServerMode,
  resolveCodexAppServerSpawn,
  resolveCodexSharedAppServerSpawn,
} from "./codex-binary.js";

type JsonRpcServerMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type PendingRequest = {
  method: string;
  reject(error: Error): void;
  resolve(value: unknown): void;
};

export type AppServerThread = {
  id: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  status: unknown;
  cwd: string;
  source: string;
  modelProvider: string;
  name: string | null;
  turns?: AppServerTurn[];
};

export type AppServerTurn = {
  id: string;
  items: AppServerThreadItem[];
  status: unknown;
  error?: {
    codexErrorInfo?: string;
    message?: string;
  } | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type AppServerTextElement = {
  byteRange: { end: number; start: number };
  placeholder: string | null;
};

export type AppServerUserInput =
  | { type: "text"; text: string; text_elements: AppServerTextElement[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | {
      type: "document" | "file" | "localFile";
      mimeType?: string;
      name?: string;
      path?: string;
      url?: string;
    }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type AppServerThreadItem =
  | {
      type: "userMessage";
      id: string;
      content: AppServerUserInput[];
    }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "plan";
      id: string;
      body?: unknown;
      content?: unknown;
      explanation?: unknown;
      items?: unknown;
      markdown?: unknown;
      message?: unknown;
      plan?: unknown;
      steps?: unknown;
      text?: unknown;
    }
  | { type: "reasoning"; id: string; summary?: string[]; content?: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      aggregatedOutput?: string | null;
      cwd?: string | null;
      exitCode?: number | null;
      status?: string | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: Array<{ path: string; kind: string }>;
      patch?: string | null;
    }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; status?: string | null }
  | {
      type: "collabAgentToolCall";
      id: string;
      tool: "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent";
      status: "inProgress" | "completed" | "failed";
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      model: string | null;
      reasoningEffort: string | null;
      agentsStates: Record<string, { status: string; message: string | null } | undefined>;
    }
  | {
      type: "subAgentActivity";
      id: string;
      kind: "started" | "interacted" | "interrupted";
      agentThreadId: string;
      agentPath: string;
    }
  | { type: "webSearch"; id: string; query: string; status?: string | null }
  | { type: string; id: string };

export type AppServerModel = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
  additionalSpeedTiers?: string[];
  serviceTiers?: Array<{ id: string; name: string; description?: string }>;
};

export type AppServerRateLimits = {
  rateLimits?: unknown;
  rateLimitsByLimitId?: Record<string, unknown>;
};

export type AppServerThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export type AppServerThreadGoal = {
  threadId: string;
  objective: string;
  status: AppServerThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type AppServerRequest = {
  id: number;
  method: string;
  params: unknown;
};

export type AppServerNotification = {
  method: string;
  params: unknown;
};

export type AppServerThreadStartParams = {
  approvalPolicy?: string | null;
  cwd?: string | null;
  experimentalRawEvents: boolean;
  model?: string | null;
  persistExtendedHistory: boolean;
  sandbox?: string | null;
  serviceTier?: string | null;
};

export type AppServerThreadResumeParams = {
  approvalPolicy?: string | null;
  cwd?: string | null;
  excludeTurns?: boolean;
  model?: string | null;
  persistExtendedHistory: boolean;
  sandbox?: string | null;
  serviceTier?: string | null;
  threadId: string;
};

export type AppServerTurnStartParams = {
  approvalPolicy?: string | null;
  collaborationMode?: {
    mode: "default" | "plan";
    settings: {
      developer_instructions: string | null;
      model: string;
      reasoning_effort: string | null;
    };
  } | null;
  cwd?: string | null;
  effort?: string | null;
  input: AppServerUserInput[];
  model?: string | null;
  sandboxPolicy?: unknown;
  serviceTier?: string | null;
  threadId: string;
};

export type AppServerTurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type AppServerThreadArchiveParams = {
  threadId: string;
};

export type AppServerThreadGoalGetParams = {
  threadId: string;
};

export type AppServerThreadGoalSetParams = {
  threadId: string;
  objective?: string | null;
  status?: AppServerThreadGoalStatus | null;
  tokenBudget?: number | null;
};

export type AppServerThreadGoalClearParams = {
  threadId: string;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private initialized: Promise<void> | undefined;
  private notificationHandlers = new Set<(notification: AppServerNotification) => void>();
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private requestHandlers = new Set<(request: AppServerRequest) => void>();
  private readline: Interface | undefined;
  private sharedServer: ChildProcessWithoutNullStreams | undefined;
  private socket: WebSocket | undefined;

  initialize() {
    return this.ensureInitialized();
  }

  async listThreads(limit = 80) {
    const response = await this.request<{ data: AppServerThread[] }>("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: [],
      archived: false,
    });
    return response.data;
  }

  async readThread(threadId: string, options: { includeTurns?: boolean } = {}) {
    const response = await this.request<{ thread: AppServerThread }>("thread/read", {
      threadId,
      includeTurns: options.includeTurns ?? true,
    });
    return response.thread;
  }

  async listModels(limit = 80) {
    const response = await this.request<{ data: AppServerModel[] }>("model/list", {
      limit,
      includeHidden: false,
    });
    return response.data;
  }

  async readRateLimits() {
    return this.request<AppServerRateLimits>("account/rateLimits/read", null);
  }

  async startThread(params: AppServerThreadStartParams) {
    const response = await this.request<{ thread: AppServerThread }>("thread/start", params);
    return response.thread;
  }

  async resumeThread(params: AppServerThreadResumeParams) {
    const response = await this.request<{ thread: AppServerThread }>("thread/resume", params);
    return response.thread;
  }

  async startTurn(params: AppServerTurnStartParams) {
    const response = await this.request<{ turn: AppServerTurn }>("turn/start", params);
    return response.turn;
  }

  async interruptTurn(params: AppServerTurnInterruptParams) {
    await this.request("turn/interrupt", params);
  }

  async archiveThread(params: AppServerThreadArchiveParams) {
    await this.request("thread/archive", params);
  }

  async getThreadGoal(params: AppServerThreadGoalGetParams) {
    const response = await this.request<{ goal: AppServerThreadGoal | null }>(
      "thread/goal/get",
      params,
    );
    return response.goal;
  }

  async setThreadGoal(params: AppServerThreadGoalSetParams) {
    const response = await this.request<{ goal: AppServerThreadGoal }>("thread/goal/set", params);
    return response.goal;
  }

  async clearThreadGoal(params: AppServerThreadGoalClearParams) {
    await this.request("thread/goal/clear", params);
  }

  onNotification(handler: (notification: AppServerNotification) => void) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onRequest(handler: (request: AppServerRequest) => void) {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  async respondToRequest(id: number, result: unknown) {
    await this.writeJson({ id, result });
  }

  async rejectRequest(id: number, code: number, message: string) {
    await this.writeJson({ id, error: { code, message } });
  }

  close() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex app-server was closed."));
    }
    this.pending.clear();
    this.readline?.close();
    this.child?.kill();
    this.socket?.close();
    this.sharedServer?.kill();
    this.readline = undefined;
    this.child = undefined;
    this.socket = undefined;
    this.sharedServer = undefined;
    this.initialized = undefined;
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    await this.ensureInitialized();
    const id = this.nextId++;
    debugAppServer("request", method, id);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject });
      void this.writeJson({ id, method, params }).catch((error: Error) => {
        if (this.pending.delete(id)) {
          reject(error);
        }
      });
    });
  }

  private ensureInitialized() {
    if (!this.initialized) {
      this.initialized = this.start();
    }
    return this.initialized;
  }

  private async start() {
    try {
      if (resolveCodexAppServerMode() === "socket") {
        this.sharedServer = await startSharedCodexAppServer();
        await this.connectSharedCodexAppServer();
      } else {
        this.startStdioCodexAppServer();
      }
      await this.requestRaw("initialize", {
        clientInfo: {
          name: "codex-relay",
          title: "Codex Relay Mobile Server",
          version: "1.2.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      });
    } catch (error) {
      this.readline?.close();
      this.readline = undefined;
      this.child?.kill();
      this.child = undefined;
      this.socket?.close();
      this.socket = undefined;
      this.sharedServer?.kill();
      this.sharedServer = undefined;
      throw error;
    }
  }

  private startStdioCodexAppServer() {
    const spawnConfig = resolveCodexAppServerSpawn();
    this.child = spawn(spawnConfig.command, spawnConfig.args, {
      env: process.env,
      shell: spawnConfig.shell,
      windowsHide: spawnConfig.windowsHide,
    });
    this.readline = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.readline.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      if (process.env.CODEX_RELAY_DEBUG_APP_SERVER === "1") {
        process.stderr.write(String(chunk));
      }
    });
    this.child.once("error", (error) => this.rejectAll(error));
    this.child.once("exit", (code, signal) => {
      this.rejectAll(new Error(`Codex app-server exited with ${signal ?? code ?? 1}.`));
      this.child = undefined;
      this.initialized = undefined;
    });
  }

  private async connectSharedCodexAppServer() {
    const socket = new WebSocket(`ws+unix://${sharedCodexAppServerSocketPath()}:/`, {
      perMessageDeflate: false,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        socket.off("error", handleInitialError);
        resolve();
      };
      const handleInitialError = (error: Error) => {
        socket.off("open", handleOpen);
        reject(error);
      };
      socket.once("open", handleOpen);
      socket.once("error", handleInitialError);
    });
    socket.on("message", (data) => this.handleLine(String(data)));
    socket.on("error", (error) => this.rejectAll(error));
    socket.once("close", (code, reason) => {
      this.rejectAll(
        new Error(
          `Codex app-server socket closed with ${code}${reason.length > 0 ? `: ${String(reason)}` : "."}`,
        ),
      );
      this.socket = undefined;
      this.sharedServer?.kill();
      this.sharedServer = undefined;
      this.initialized = undefined;
    });
  }

  private requestRaw<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const request = JSON.stringify({ id, method, params });
    debugAppServer("request", method, id);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject });
      void this.writeSerializedJson(request).catch((error: Error) => {
        if (this.pending.delete(id)) {
          reject(error);
        }
      });
    });
  }

  private handleLine(line: string) {
    let message: JsonRpcServerMessage;
    try {
      message = JSON.parse(line) as JsonRpcServerMessage;
    } catch {
      return;
    }

    if (typeof message.method === "string" && typeof message.id === "number") {
      debugAppServer("server-request", message.method, message.id);
      const request = { id: message.id, method: message.method, params: message.params };
      if (this.requestHandlers.size === 0) {
        void this.rejectRequest(request.id, -32601, `No handler for ${request.method}.`);
      } else {
        for (const handler of this.requestHandlers) {
          handler(request);
        }
      }
      return;
    }

    if (typeof message.method === "string") {
      debugAppServer("notification", message.method);
      const notification = { method: message.method, params: message.params };
      for (const handler of this.notificationHandlers) {
        handler(notification);
      }
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    debugAppServer("response", pending.method, message.id);
    if (message.error) {
      debugAppServer("error", pending.method, message.id, message.error.message);
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private writeJson(payload: unknown) {
    return this.writeSerializedJson(JSON.stringify(payload));
  }

  private writeSerializedJson(payload: string) {
    return new Promise<void>((resolve, reject) => {
      if (this.socket) {
        this.socket.send(payload, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        return;
      }
      if (!this.child?.stdin) {
        reject(new Error("Codex app-server is not running."));
        return;
      }
      this.child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function startSharedCodexAppServer() {
  const spawnConfig = resolveCodexSharedAppServerSpawn();
  const child = spawn(spawnConfig.command, spawnConfig.args, {
    env: process.env,
    shell: spawnConfig.shell,
    windowsHide: spawnConfig.windowsHide,
  });
  let spawnError: Error | undefined;
  let exitReason: NodeJS.Signals | number | undefined;
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 8_192) {
      stderr += String(chunk).slice(0, 8_192 - stderr.length);
    }
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("exit", (code, signal) => {
    exitReason = signal ?? code ?? 1;
  });

  const socketPath = sharedCodexAppServerSocketPath();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (spawnError) {
      throw new Error(`Failed to start the shared Codex app-server: ${spawnError.message}`);
    }
    try {
      await access(socketPath);
      return child;
    } catch {
      if (exitReason !== undefined) {
        const detail = stderr.trim();
        throw new Error(
          `Failed to start the shared Codex app-server (exit ${exitReason})${detail ? `: ${detail}` : "."}`,
        );
      }
      await setTimeout(25);
    }
  }

  child.kill();
  throw new Error(`Timed out waiting for the shared Codex app-server socket at ${socketPath}.`);
}

function sharedCodexAppServerSocketPath() {
  return join(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
    "app-server-control",
    "app-server-control.sock",
  );
}

function debugAppServer(kind: string, method: string | undefined, id?: number, detail?: string) {
  if (process.env.CODEX_RELAY_DEBUG_APP_SERVER !== "1") {
    return;
  }

  console.log(
    `[app-server] ${kind}${id === undefined ? "" : ` #${id}`}${method ? ` ${method}` : ""}${detail ? ` ${detail}` : ""}`,
  );
}
