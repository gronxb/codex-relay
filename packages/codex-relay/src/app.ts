import {
  ArchiveThreadResponseSchema,
  ChatMessageSchema,
  CheckoutWorkspaceBranchRequestSchema,
  CommitPushWorkspaceRequestSchema,
  CreateThreadRequestSchema,
  EncryptedPayloadSchema,
  ImageAttachmentUploadResponseSchema,
  InterruptThreadRunResponseSchema,
  ListModelsResponseSchema,
  ListQueuedThreadInputsResponseSchema,
  ListSkillsResponseSchema,
  ListThreadsResponseSchema,
  ListWorkspaceFilesResponseSchema,
  ListWorkspaceDirectoriesResponseSchema,
  PairRequestSchema,
  PairResponseSchema,
  QueuedThreadInputActionResponseSchema,
  RateLimitsResponseSchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  RunThreadRequestSchema,
  RuntimePreferencesResponseSchema,
  StatusResponseSchema,
  StreamThreadRunEventSchema,
  StreamThreadRunRequestSchema,
  SubmitThreadInputResponseSchema,
  ThreadContextWindowResponseSchema,
  ThreadDetailResponseSchema,
  ThreadMessageDetailFieldSchema,
  ThreadMessageDetailResponseSchema,
  ThreadSummarySchema,
  UpdateWorkspaceFileContentRequestSchema,
  UpdateRuntimePreferencesRequestSchema,
  VersionResponseSchema,
  WorkspaceFileContentResponseSchema,
  WorkspaceChangesResponseSchema,
  WorkspaceGitActionResponseSchema,
  WorkspaceTerminalInputRequestSchema,
  WorkspaceTerminalOutputResponseSchema,
  WorkspaceTerminalResizeRequestSchema,
  WorkspaceTerminalSessionResponseSchema,
  WorkspaceTerminalStartRequestSchema,
  apiPaths,
  chatMessageDetailsFromPromptContext,
  createOpenApiDocument,
  normalizePromptContext,
  promptMarkdownWithSkills,
  stripPromptSkillMentions,
  type ApprovalMode,
  type ArchiveThreadResponse,
  type ChatMessage,
  type CreateThreadResponse,
  type ErrorResponse,
  type ImageAttachmentUploadResponse,
  type ListThreadsResponse,
  type ListWorkspaceFilesResponse,
  type ListWorkspaceDirectoriesResponse,
  type PairResponse,
  type PendingInputRequest,
  type PendingInputRequestQuestion,
  type PromptAttachment,
  type PromptSkill,
  type ReasoningEffort,
  type RunThreadResponse,
  type RuntimeMode,
  type RuntimePreferences,
  type SandboxMode,
  type StatusResponse,
  type StreamThreadRunEvent,
  type SubmitThreadInputResponse,
  type ThreadCollaborationMode,
  type ThreadMessageDetailField,
  type ThreadSummary,
  type UpdateWorkspaceFileContentRequest,
  type VersionResponse,
  type WebPreviewTarget,
  type WorkspaceFileContentResponse,
  type WorkspaceGitActionResponse,
  type WorkspaceTerminalOutputResponse,
  type WorkspaceTerminalSessionResponse,
} from "./api-schema.js";
import {
  openRepository,
  type DeltaType,
  type Diff,
  type DiffDelta,
  type Repository,
  type Status,
  type StatusEntry,
} from "es-git";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as pty from "@lydell/node-pty";
import { z } from "zod";

import {
  CodexAppServerClient,
  type AppServerModel,
  type AppServerNotification,
  type AppServerRateLimits,
  type AppServerRequest,
  type AppServerThread,
  type AppServerThreadItem,
  type AppServerTurn,
  type AppServerTurnStartParams,
  type AppServerUserInput,
} from "./app-server.js";
import {
  classifyStreamEvent,
  createCodexClient,
  extractStreamText,
  getThreadId,
  stringifyRunResult,
  type CodexClient,
} from "./codex.js";
import { readLatestContextWindowUsage } from "./context-window.js";
import { codexRelayDataPath } from "./paths.js";
import { relayDebugLog } from "./debug-log.js";
import type { PairingSessionStore } from "./pairing-store.js";
import {
  createMemoryRuntimePreferencesStore,
  type RuntimePreferencesStore,
} from "./preferences-store.js";
import {
  createSecurePairing,
  decryptFromMobile,
  encryptForMobile,
  type SecureSession,
  type ServerIdentity,
} from "./secure-transport.js";
import { listAvailableSkills } from "./skill-discovery.js";

const defaultWorkspacePath = process.cwd();
const defaultCodexModel = "gpt-5.5";
const execFileAsync = promisify(execFile);
const IMAGE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const WORKSPACE_FILE_PREVIEW_MAX_BYTES = 256 * 1024;
const LOCAL_MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]*)\)/g;
const LOCAL_IMAGE_REFERENCE_PATTERN = /\.(gif|heic|heif|jpe?g|png|webp)$/i;
const imageAttachmentDirectory = codexRelayDataPath("attachments/images");
const requirePackage = createRequire(import.meta.url);
const relayPackage = requirePackage("../package.json") as { version: string };
const collaborationModeTemplateNames = ["default", "execute", "pair_programming", "plan"] as const;
const knownCollaborationModeNames = "Default and Plan";
const collaborationModeTemplates = Object.fromEntries(
  collaborationModeTemplateNames.map((name) => [name, readCollaborationModeTemplate(name)]),
) as Record<(typeof collaborationModeTemplateNames)[number], string>;
const defaultWebPreviewPorts = [3000, 3001, 5173, 4173, 8080, 19006];

type AppOptions = {
  appServer?: CodexAppServerClient | null;
  codex?: CodexClient;
  pairing?: PairingOptions;
  preferences?: RuntimePreferencesStore;
  workspacePath?: string;
};

type PairingOptions = {
  approvalSecret?: string;
  approvalTtlMs?: number;
  dangerouslyAutoApprove?: boolean;
  serverIdentity?: ServerIdentity;
  createClientToken: () => string;
  hashClientToken: (token: string) => string;
  sessions: PairingSessionStore;
  tokenTtlMs: number;
  onPaired?: (client: { clientName?: string; tokenCount: number }) => void;
  onPairAttempt?: (client: { remoteAddress?: string }) => void;
  onPairApprovalRequested?: (client: { approvalCode: string; clientName?: string }) => void;
  onPairApproved?: (client: { approvalCode: string; clientName?: string }) => void;
  onPairingsCleared?: (result: { pendingPairingsCleared: number; sessionsCleared: number }) => void;
  onTokenRefreshed?: (client: { clientName?: string; tokenCount: number }) => void;
};

type ThreadMetadata = ThreadSummary;
type RuntimeOptionSubset = {
  approvalPolicy?: string;
  collaborationMode?: ThreadCollaborationMode;
  model?: string;
  serviceTier?: string;
  reasoningEffort?: string;
  runtimeMode?: RuntimeMode;
  sandboxMode?: string;
};

const PairApproveRequestSchema = z.object({
  approvalCode: z.string().trim().min(1),
});

type PendingApproval = {
  appServer: CodexAppServerClient;
  kind:
    | "commandExecution"
    | "fileChange"
    | "permissions"
    | "structuredUserInput"
    | "mcpElicitation";
  messageId?: string;
  method: string;
  questions?: PendingInputRequestQuestion[];
  requestId: number;
  threadId: string;
  turnId?: string;
};

type ResolvedApproval = {
  promise: Promise<void>;
};

const maxResolvedApprovals = 100;

type SecureSessionHandle = {
  persist: () => Promise<void>;
  session: SecureSession;
  tokenHash: string;
};

type QueuedThreadInput = {
  attachments: PromptAttachment[];
  id: string;
  prompt: string;
  runOptions: {
    model?: string;
    serviceTier?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
    runtimeMode?: RuntimeMode;
    reasoningEffort?: string;
    collaborationMode?: ThreadCollaborationMode;
  };
  skills: PromptSkill[];
  workspacePath: string;
};

type WorkspaceTerminalOutputChunk = {
  data: string;
  seq: number;
};

type WorkspaceTerminalOutputSubscriber = (response: WorkspaceTerminalOutputResponse) => void;

type WorkspaceTerminalSession = {
  child: pty.IPty;
  cols: number;
  exitCode?: number | null;
  exitedAt?: string;
  output: WorkspaceTerminalOutputChunk[];
  rows: number;
  seq: number;
  sessionId: string;
  startedAt: string;
  subscribers: Set<WorkspaceTerminalOutputSubscriber>;
  workspacePath: string;
};

const maxWorkspaceTerminalOutputChunks = 2000;

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  const appServer =
    options.appServer === undefined
      ? process.env.VITEST
        ? null
        : new CodexAppServerClient()
      : options.appServer;
  const codex = options.codex ?? createCodexClient();
  const preferences = options.preferences ?? createMemoryRuntimePreferencesStore();
  const workspacePath = resolve(
    options.workspacePath ?? process.env.CODEX_RELAY_WORKSPACE_PATH ?? defaultWorkspacePath,
  );
  const threads = new Map<string, ThreadMetadata>();
  const messagesByThreadId = new Map<string, ChatMessage[]>();
  const liveThreads = new Map<string, ReturnType<CodexClient["startThread"]>>();
  const pendingApprovals = new Map<string, PendingApproval>();
  const resolvedApprovals = new Map<string, ResolvedApproval>();
  const queuedInputsByThreadId = new Map<string, QueuedThreadInput[]>();
  const workspaceTerminalSessions = new Map<string, WorkspaceTerminalSession>();
  const activeAppServerTurnIdsByThreadId = new Map<string, string>();
  const appServerHistoryLoadsByThreadId = new Map<string, Promise<void>>();
  const steeringThreads = new Set<string>();
  const secureSessionsByTokenHash = new Map<string, SecureSession>();
  const activeStreamControllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const threadOptions = { workingDirectory: workspacePath };
  const scheduleAppServerHistoryLoad = (threadId: string, cachedMessages: ChatMessage[]) => {
    if (!appServer || appServerHistoryLoadsByThreadId.has(threadId)) {
      return;
    }
    const startedAt = Date.now();
    relayDebugLog("thread.detail.history.background_started", {
      cachedMessageCount: cachedMessages.length,
      threadId,
    });
    const load = appServer
      .readThread(threadId, { includeTurns: true })
      .then((threadWithTurns) => {
        const mappedThread = rememberAppServerThread(threads, threadWithTurns);
        const messages = mergeAppServerMessagesWithLocalStatus(
          mapAppServerMessages(threadWithTurns),
          messagesByThreadId.get(threadId) ?? cachedMessages,
        );
        messagesByThreadId.set(threadId, messages);
        relayDebugLog("thread.detail.history.background_completed", {
          durationMs: Date.now() - startedAt,
          messageCount: messages.length,
          state: mappedThread.state,
          threadId,
        });
      })
      .catch((error) => {
        relayDebugLog("thread.detail.history.background_failed", {
          durationMs: Date.now() - startedAt,
          error: errorMessage(error),
          threadId,
        });
      })
      .finally(() => {
        appServerHistoryLoadsByThreadId.delete(threadId);
      });
    appServerHistoryLoadsByThreadId.set(threadId, load);
  };

  app.use("*", cors());
  app.use("*", async (c, next) => {
    if (
      !options.pairing ||
      c.req.method === "OPTIONS" ||
      c.req.path === apiPaths.version ||
      c.req.path.startsWith(`${apiPaths.imageAttachments}/`) ||
      c.req.path === apiPaths.sessionsClear ||
      c.req.path.startsWith(apiPaths.pair)
    ) {
      await next();
      return;
    }

    const token = parseBearerToken(c.req.header("authorization"));
    const tokenHash = token ? options.pairing.hashClientToken(token) : undefined;
    const validSession = tokenHash
      ? await options.pairing.sessions.getValidSession(tokenHash, Date.now())
      : undefined;
    if (!tokenHash || !validSession) {
      return c.json(apiError("unauthorized", "Pair this device with the Codex Relay server."), 401);
    }
    if (options.pairing.serverIdentity && !secureSessionsByTokenHash.has(tokenHash)) {
      if (validSession.secureSession) {
        secureSessionsByTokenHash.set(tokenHash, validSession.secureSession);
      } else {
        return c.json(
          apiError("secure_session_required", "Secure session expired. Pair this device again."),
          401,
        );
      }
    }

    await next();
  });

  app.get(apiPaths.version, async (c) => {
    const response: VersionResponse = VersionResponseSchema.parse({
      ok: true,
      service: "codex-relay-server",
      packageName: "codex-relay",
      packageVersion: relayPackage.version,
    });

    return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
  });

  app.post(apiPaths.pair, async (c) => {
    if (!options.pairing) {
      return c.json(apiError("pairing_disabled", "Pairing is not enabled on this server."), 404);
    }

    options.pairing.onPairAttempt?.({
      remoteAddress:
        c.req.header("x-forwarded-for") ??
        c.req.header("x-real-ip") ??
        c.req.header("cf-connecting-ip"),
    });
    const parsed = await parsePlainJson(c.req.raw, PairRequestSchema);
    if (!parsed.success) {
      return c.json(validationError(parsed.error), 400);
    }

    if (!parsed.data.secure || !options.pairing.serverIdentity) {
      return c.json(
        apiError("secure_pairing_required", "Pairing requires the secure QR approval flow."),
        400,
      );
    }

    await options.pairing.sessions.pruneExpired(Date.now());
    const approvalCode = await createApprovalCode(options.pairing.sessions);
    const expiresAt = Date.now() + (options.pairing.approvalTtlMs ?? 5 * 60 * 1000);
    const requestOrigin = externalRequestOrigin(c.req.url, (name) => c.req.header(name));
    const shouldAutoApprove = Boolean(options.pairing.dangerouslyAutoApprove);
    await options.pairing.sessions.createPendingPairing({
      approved: shouldAutoApprove,
      approvalCode,
      clientEphemeralPublicKey: parsed.data.secure.clientEphemeralPublicKey,
      clientSessionId: parsed.data.clientSessionId,
      clientName: parsed.data.clientName,
      clientNonce: parsed.data.secure.clientNonce,
      expiresAt,
      serverUrl: requestOrigin,
    });
    if (shouldAutoApprove) {
      options.pairing.onPairApproved?.({ approvalCode, clientName: parsed.data.clientName });
    } else {
      options.pairing.onPairApprovalRequested?.({
        approvalCode,
        clientName: parsed.data.clientName,
      });
    }
    const response = PairResponseSchema.parse({
      approvalCode,
      approvalExpiresAt: new Date(expiresAt).toISOString(),
    });
    return c.json(response, 202);
  });

  app.get("/v1/pair/:approvalCode", async (c) => {
    if (!options.pairing?.serverIdentity) {
      return c.json(apiError("pairing_disabled", "Pairing is not enabled on this server."), 404);
    }

    const approvalCode = normalizeApprovalCode(c.req.param("approvalCode"));
    const pending = await options.pairing.sessions.getPendingPairing(approvalCode, Date.now());
    if (!pending) {
      return c.json(apiError("pairing_expired", "The pairing approval code has expired."), 410);
    }
    if (!pending.approved) {
      return c.json(
        PairResponseSchema.parse({
          approvalCode,
          approvalExpiresAt: new Date(pending.expiresAt).toISOString(),
        }),
        202,
      );
    }

    await options.pairing.sessions.pruneExpired(Date.now());
    const clientToken = options.pairing.createClientToken();
    const expiresAt = Date.now() + options.pairing.tokenTtlMs;
    const tokenHash = options.pairing.hashClientToken(clientToken);
    const clientTokenExpiresAt = new Date(expiresAt).toISOString();
    const pairing = createSecurePairing({
      approvalCode,
      clientEphemeralPublicKey: pending.clientEphemeralPublicKey,
      clientNonce: pending.clientNonce,
      clientToken,
      clientTokenExpiresAt,
      keyEpoch: 1,
      serverIdentity: options.pairing.serverIdentity,
      serverUrl: pending.serverUrl,
    });
    const tokenCount = await options.pairing.sessions.createSession(tokenHash, {
      clientSessionId: pending.clientSessionId,
      clientName: pending.clientName,
      expiresAt,
      secureSession: pairing.session,
    });
    await options.pairing.sessions.deletePendingPairing(approvalCode);
    options.pairing.onPaired?.({ clientName: pending.clientName, tokenCount });
    secureSessionsByTokenHash.set(tokenHash, pairing.session);
    return c.json(PairResponseSchema.parse({ secure: pairing.response }), 201);
  });

  app.post(apiPaths.pairApprove, async (c) => {
    if (!options.pairing) {
      return c.json(apiError("pairing_disabled", "Pairing is not enabled on this server."), 404);
    }
    if (
      options.pairing.approvalSecret &&
      c.req.header("x-codex-relay-approve-secret") !== options.pairing.approvalSecret
    ) {
      return c.json(apiError("unauthorized", "Pairing approval must come from this machine."), 401);
    }

    const parsed = await parsePlainJson(c.req.raw, PairApproveRequestSchema);
    if (!parsed.success) {
      return c.json(validationError(parsed.error), 400);
    }

    const approvalCode = normalizeApprovalCode(parsed.data.approvalCode);
    const pending = await options.pairing.sessions.approvePendingPairing(approvalCode, Date.now());
    if (!pending) {
      return c.json(apiError("not_found", "No pending pairing request matches that code."), 404);
    }

    options.pairing.onPairApproved?.({ approvalCode, clientName: pending.clientName });
    return c.json({ ok: true });
  });

  app.post(apiPaths.sessionsClear, async (c) => {
    if (!options.pairing) {
      return c.json(apiError("pairing_disabled", "Pairing is not enabled on this server."), 404);
    }
    if (
      options.pairing.approvalSecret &&
      c.req.header("x-codex-relay-approve-secret") !== options.pairing.approvalSecret
    ) {
      return c.json(apiError("unauthorized", "Pairing clear must come from this machine."), 401);
    }

    const result = await options.pairing.sessions.clearAll();
    secureSessionsByTokenHash.clear();
    closeActiveStreamControllers(activeStreamControllers);
    options.pairing.onPairingsCleared?.(result);
    return c.json({ ok: true, ...result });
  });

  app.post(apiPaths.sessionRefresh, async (c) => {
    if (!options.pairing) {
      return c.json(apiError("pairing_disabled", "Pairing is not enabled on this server."), 404);
    }

    const oldToken = parseBearerToken(c.req.header("authorization"));
    const oldSession = oldToken
      ? await getValidClientSession(options.pairing, oldToken)
      : undefined;
    if (!oldToken || !oldSession) {
      return c.json(apiError("unauthorized", "Pair this device with the Codex Relay server."), 401);
    }

    const clientToken = options.pairing.createClientToken();
    const expiresAt = Date.now() + options.pairing.tokenTtlMs;
    const oldTokenHash = options.pairing.hashClientToken(oldToken);
    const newTokenHash = options.pairing.hashClientToken(clientToken);
    const clientSessionId =
      normalizeClientSessionId(c.req.header("x-codex-relay-client-session-id")) ??
      oldSession.clientSessionId;
    const tokenCount = await options.pairing.sessions.rotateSession(oldTokenHash, newTokenHash, {
      clientSessionId,
      clientName: oldSession.clientName,
      expiresAt,
      secureSession: secureSessionsByTokenHash.get(oldTokenHash) ?? oldSession.secureSession,
    });
    const secureSession = secureSessionsByTokenHash.get(oldTokenHash) ?? oldSession.secureSession;
    if (secureSession) {
      secureSessionsByTokenHash.set(oldTokenHash, secureSession);
    }
    options.pairing.onTokenRefreshed?.({
      clientName: oldSession.clientName,
      tokenCount,
    });

    const response: PairResponse = PairResponseSchema.parse({
      clientToken,
      clientTokenExpiresAt: new Date(expiresAt).toISOString(),
    });
    const jsonResponse = await secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      response,
      201,
    );
    if (secureSession) {
      secureSessionsByTokenHash.delete(oldTokenHash);
      secureSessionsByTokenHash.set(newTokenHash, secureSession);
      await options.pairing.sessions.updateSecureSession(newTokenHash, secureSession);
    }
    return jsonResponse;
  });

  app.get(apiPaths.status, async (c) => {
    const response: StatusResponse = StatusResponseSchema.parse({
      ok: true,
      service: "codex-relay-server",
      sdkAvailable: Boolean(codex),
      machineName: hostname(),
      workspacePath,
      threadCount: threads.size,
      appServerAvailable: Boolean(appServer),
      preferences: await preferences.read(workspacePath),
      runtimePreferencesByWorkspacePath: await preferences.readByWorkspacePath(),
    });

    return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
  });

  app.patch(apiPaths.preferences, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      UpdateRuntimePreferencesRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const targetThread = parsed.data.threadId
      ? await ensureKnownThread({
          appServer,
          threadId: parsed.data.threadId,
          messagesByThreadId,
          threads,
        })
      : undefined;
    if (parsed.data.threadId && !targetThread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${parsed.data.threadId} is not known to this server.`),
        404,
      );
    }

    if (parsed.data.threadId || parsed.data.workspacePath) {
      const targetWorkspacePath = parsed.data.workspacePath ?? targetThread?.cwd ?? workspacePath;
      const response = RuntimePreferencesResponseSchema.parse({
        preferences: await preferences.update(parsed.data, targetWorkspacePath),
        runtimePreferencesByWorkspacePath: await preferences.readByWorkspacePath(),
        workspacePath: targetWorkspacePath,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    }

    const response = RuntimePreferencesResponseSchema.parse({
      preferences: await preferences.update(parsed.data, workspacePath),
      runtimePreferencesByWorkspacePath: await preferences.readByWorkspacePath(),
      workspacePath,
    });
    return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
  });

  app.get(apiPaths.workspaceDirectories, async (c) => {
    const requestedPath = c.req.query("path");
    const targetPath = resolve(requestedPath ?? workspacePath);

    try {
      const targetStat = await stat(targetPath);
      if (!targetStat.isDirectory()) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", "Workspace path must be a directory."),
          400,
        );
      }

      const entries = await readdir(targetPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => ({
          name: entry.name,
          path: resolve(targetPath, entry.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      const response: ListWorkspaceDirectoriesResponse =
        ListWorkspaceDirectoriesResponseSchema.parse({
          rootPath: workspacePath,
          path: targetPath,
          parentPath: dirname(targetPath) === targetPath ? null : dirname(targetPath),
          directories,
        });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_unavailable", errorMessage(error)),
        400,
      );
    }
  });

  app.get(apiPaths.workspaceChanges, async (c) => {
    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        c.req.query("workspacePath"),
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      const changes = await readWorkspaceChanges(selectedWorkspacePath.path);
      const response = WorkspaceChangesResponseSchema.parse({
        workspacePath: selectedWorkspacePath.path,
        ...changes,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_changes_unavailable", errorMessage(error)),
        400,
      );
    }
  });

  app.post(apiPaths.workspaceCheckout, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      CheckoutWorkspaceBranchRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        parsed.data.workspacePath,
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      const branchExists = await localGitBranchExists(
        selectedWorkspacePath.path,
        parsed.data.branch,
      );
      const output = branchExists
        ? await git(selectedWorkspacePath.path, ["checkout", parsed.data.branch])
        : await git(selectedWorkspacePath.path, ["checkout", "-b", parsed.data.branch]);
      const response: WorkspaceGitActionResponse = WorkspaceGitActionResponseSchema.parse({
        branch: await currentGitBranch(selectedWorkspacePath.path),
        message: branchExists
          ? `Checked out ${parsed.data.branch}.`
          : `Created and checked out ${parsed.data.branch}.`,
        output,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_checkout_failed", errorMessage(error)),
        400,
      );
    }
  });

  app.post(apiPaths.workspaceCommitPush, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      CommitPushWorkspaceRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        parsed.data.workspacePath,
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      await git(selectedWorkspacePath.path, ["add", "--all"]);
      const commitOutput = await git(selectedWorkspacePath.path, [
        "commit",
        "-m",
        parsed.data.message,
      ]);
      const branch = await currentGitBranch(selectedWorkspacePath.path);
      const upstream = await git(selectedWorkspacePath.path, [
        "rev-parse",
        "--abbrev-ref",
        "@{upstream}",
      ]).catch(() => null);
      const pushOutput = upstream
        ? await git(selectedWorkspacePath.path, ["push"])
        : branch
          ? await git(selectedWorkspacePath.path, ["push", "-u", "origin", branch])
          : await git(selectedWorkspacePath.path, ["push"]);
      const response: WorkspaceGitActionResponse = WorkspaceGitActionResponseSchema.parse({
        branch,
        message: "Committed and pushed workspace changes.",
        output: [commitOutput, pushOutput].filter(Boolean).join("\n"),
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_commit_push_failed", errorMessage(error)),
        400,
      );
    }
  });

  app.post(apiPaths.workspaceTerminalSessions, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      WorkspaceTerminalStartRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const selectedWorkspacePath = await validateThreadWorkspacePath(
      workspacePath,
      parsed.data.workspacePath,
    );
    if (!selectedWorkspacePath.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("invalid_workspace_path", selectedWorkspacePath.error),
        400,
      );
    }

    try {
      const session = createWorkspaceTerminalSession({
        cols: parsed.data.cols,
        cwd: selectedWorkspacePath.path,
        rows: parsed.data.rows,
      });
      workspaceTerminalSessions.set(session.sessionId, session);
      const response: WorkspaceTerminalSessionResponse =
        WorkspaceTerminalSessionResponseSchema.parse({
          cols: session.cols,
          rows: session.rows,
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          workspacePath: session.workspacePath,
        });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_start_failed", errorMessage(error)),
        400,
      );
    }
  });

  app.get("/v1/workspace/terminal/sessions/:sessionId/output", async (c) => {
    const session = workspaceTerminalSessions.get(c.req.param("sessionId"));
    if (!session) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_not_found", "Terminal session was not found."),
        404,
      );
    }

    const since = Number(c.req.query("since") ?? "0");
    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      workspaceTerminalOutputResponse(session, since),
    );
  });

  app.get("/v1/workspace/terminal/sessions/:sessionId/output/stream", async (c) => {
    const session = workspaceTerminalSessions.get(c.req.param("sessionId"));
    if (!session) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_not_found", "Terminal session was not found."),
        404,
      );
    }

    const since = Number(c.req.query("since") ?? "0");
    const encoder = new TextEncoder();
    const secureSession = getSecureSessionForRequest(c, options.pairing, secureSessionsByTokenHash);
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    let stopHeartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => {};

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (stopHeartbeat) {
        clearInterval(stopHeartbeat);
        stopHeartbeat = undefined;
      }
      unsubscribe();
      if (streamController) {
        activeStreamControllers.delete(streamController);
        closeSseController(streamController);
      }
    };

    const send = (response: WorkspaceTerminalOutputResponse) => {
      if (closed || !streamController) {
        return;
      }
      if (!sendTerminalOutputSse(streamController, encoder, secureSession, response)) {
        closeStream();
        return;
      }
      if (response.exitedAt) {
        closeStream();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        activeStreamControllers.add(controller);
        send(workspaceTerminalOutputResponse(session, since));
        if (session.exitedAt) {
          return;
        }
        unsubscribe = subscribeWorkspaceTerminalOutput(session, send);
        stopHeartbeat = setInterval(() => {
          if (!closed && streamController) {
            enqueueSseChunk(streamController, encoder.encode(": keep-alive\n\n"));
          }
        }, 30000);
      },
      cancel() {
        closeStream();
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream",
        "x-accel-buffering": "no",
      },
    });
  });

  app.post("/v1/workspace/terminal/sessions/:sessionId/input", async (c) => {
    const session = workspaceTerminalSessions.get(c.req.param("sessionId"));
    if (!session) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_not_found", "Terminal session was not found."),
        404,
      );
    }

    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      WorkspaceTerminalInputRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    if (session.exitedAt) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_closed", "Terminal session is closed."),
        409,
      );
    }

    session.child.write(parsed.data.data);
    return new Response(null, { status: 204 });
  });

  app.post("/v1/workspace/terminal/sessions/:sessionId/resize", async (c) => {
    const session = workspaceTerminalSessions.get(c.req.param("sessionId"));
    if (!session) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_terminal_not_found", "Terminal session was not found."),
        404,
      );
    }

    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      WorkspaceTerminalResizeRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    session.cols = parsed.data.cols;
    session.rows = parsed.data.rows;
    if (!session.exitedAt) {
      session.child.resize(parsed.data.cols, parsed.data.rows);
    }
    return new Response(null, { status: 204 });
  });

  app.delete("/v1/workspace/terminal/sessions/:sessionId", async (c) => {
    const session = workspaceTerminalSessions.get(c.req.param("sessionId"));
    if (session) {
      closeWorkspaceTerminalSession(session);
      workspaceTerminalSessions.delete(session.sessionId);
    }
    return new Response(null, { status: 204 });
  });

  app.get(apiPaths.models, async (c) => {
    try {
      const models = appServer ? await appServer.listModels() : fallbackModels();
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        ListModelsResponseSchema.parse({ models: models.map(mapAppServerModel) }),
      );
    } catch {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        ListModelsResponseSchema.parse({ models: fallbackModels().map(mapAppServerModel) }),
      );
    }
  });

  app.get(apiPaths.skills, async (c) => {
    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        c.req.query("workspacePath"),
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        ListSkillsResponseSchema.parse({
          skills: await listAvailableSkills({ workspacePath: selectedWorkspacePath.path }),
        }),
      );
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("skills_unavailable", errorMessage(error)),
        502,
      );
    }
  });

  app.get(apiPaths.workspaceFiles, async (c) => {
    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        c.req.query("workspacePath"),
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      const query = c.req.query("query")?.trim() ?? "";
      const directoryPath = normalizeWorkspaceDirectoryPath(c.req.query("directory") ?? "");
      if (!directoryPath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_file_path", directoryPath.error),
          400,
        );
      }
      const response: ListWorkspaceFilesResponse = ListWorkspaceFilesResponseSchema.parse({
        directory: directoryPath.path,
        files: await listWorkspaceFiles(selectedWorkspacePath.path, query, directoryPath.path),
        parentDirectory: parentWorkspaceDirectory(directoryPath.path),
        query,
        workspacePath: selectedWorkspacePath.path,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_files_unavailable", errorMessage(error)),
        502,
      );
    }
  });

  app.get(apiPaths.workspaceFileContent, async (c) => {
    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        c.req.query("workspacePath"),
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      const requestedPath = c.req.query("path")?.trim();
      if (!requestedPath) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("missing_workspace_file_path", "Workspace file path is required."),
          400,
        );
      }

      const file = await readWorkspaceFileContent(selectedWorkspacePath.path, requestedPath);
      if (!file.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError(file.code, file.error),
          file.status,
        );
      }

      const response: WorkspaceFileContentResponse = WorkspaceFileContentResponseSchema.parse({
        workspacePath: selectedWorkspacePath.path,
        ...file.content,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_file_unavailable", errorMessage(error)),
        502,
      );
    }
  });

  app.put(apiPaths.workspaceFileContent, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      UpdateWorkspaceFileContentRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    try {
      const selectedWorkspacePath = await validateThreadWorkspacePath(
        workspacePath,
        parsed.data.workspacePath,
      );
      if (!selectedWorkspacePath.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError("invalid_workspace_path", selectedWorkspacePath.error),
          400,
        );
      }

      const file = await updateWorkspaceFileContent(selectedWorkspacePath.path, parsed.data);
      if (!file.success) {
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError(file.code, file.error),
          file.status,
        );
      }

      const response: WorkspaceFileContentResponse = WorkspaceFileContentResponseSchema.parse({
        workspacePath: selectedWorkspacePath.path,
        ...file.content,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("workspace_file_update_unavailable", errorMessage(error)),
        502,
      );
    }
  });

  app.get(apiPaths.rateLimits, async (c) => {
    if (!appServer) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        RateLimitsResponseSchema.parse({ buckets: [] }),
      );
    }

    try {
      const rateLimits = await appServer.readRateLimits();
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        RateLimitsResponseSchema.parse({ buckets: normalizeRateLimitBuckets(rateLimits) }),
      );
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("rate_limits_unavailable", errorMessage(error)),
        502,
      );
    }
  });

  app.post(apiPaths.imageAttachments, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("invalid_multipart", errorMessage(error)),
        400,
      );
    }

    const files = Object.values(body).flatMap((value) =>
      Array.isArray(value) ? value : value ? [value] : [],
    );
    const imageFiles = files.filter(isUploadedFile).slice(0, 6);
    if (imageFiles.length === 0) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("missing_image", "Upload at least one image file."),
        400,
      );
    }

    try {
      const attachments = await Promise.all(imageFiles.map(saveUploadedImageAttachment));
      relayDebugLog("image_attachment.uploaded", {
        count: attachments.length,
        names: attachments.map((attachment) => attachment.name),
      });
      const response: ImageAttachmentUploadResponse = ImageAttachmentUploadResponseSchema.parse({
        attachments,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response, 201);
    } catch (error) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("image_upload_failed", errorMessage(error)),
        400,
      );
    }
  });

  app.get("/v1/attachments/images/:attachmentId", async (c) => {
    const attachmentId = c.req.param("attachmentId");
    const filePath = uploadedImagePathFromId(attachmentId);
    if (!filePath) {
      relayDebugLog("image_attachment.rejected", {
        attachmentId,
        reason: "invalid_id",
        userAgent: c.req.header("user-agent"),
      });
      return c.json(apiError("not_found", "Image attachment not found."), 404);
    }

    if (!existsSync(filePath)) {
      relayDebugLog("image_attachment.rejected", {
        attachmentId,
        reason: "missing_file",
        userAgent: c.req.header("user-agent"),
      });
      return c.json(apiError("not_found", "Image attachment not found."), 404);
    }

    const fileStat = statSync(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) {
      relayDebugLog("image_attachment.rejected", {
        attachmentId,
        reason: fileStat.isFile() ? "empty_file" : "not_file",
        userAgent: c.req.header("user-agent"),
      });
      return c.json(apiError("not_found", "Image attachment not found."), 404);
    }
    const imageBytes = await readFile(filePath);
    relayDebugLog("image_attachment.served", {
      attachmentId,
      mimeType: imageMimeType(filePath),
      size: imageBytes.length,
      userAgent: c.req.header("user-agent"),
    });
    return new Response(imageBytes, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-length": String(imageBytes.length),
        "content-type": imageMimeType(filePath),
      },
    });
  });

  app.get(apiPaths.threads, async (c) => {
    if (appServer) {
      try {
        const appServerThreads = await appServer.listThreads();
        const response: ListThreadsResponse = ListThreadsResponseSchema.parse({
          threads: appServerThreads.map((thread) => rememberAppServerThread(threads, thread)),
          source: "app-server",
        });
        return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
      } catch {
        // Fall through to in-memory threads so tests and offline development keep working.
      }
    }

    const response: ListThreadsResponse = ListThreadsResponseSchema.parse({
      threads: sortedThreads(threads),
      source: "memory",
    });

    return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
  });

  app.delete("/v1/threads/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    if (appServer) {
      try {
        await appServer.archiveThread({ threadId });
        threads.delete(threadId);
        messagesByThreadId.delete(threadId);
        activeAppServerTurnIdsByThreadId.delete(threadId);
        queuedInputsByThreadId.delete(threadId);
        steeringThreads.delete(threadId);

        const appServerThreads = await appServer.listThreads();
        const response: ArchiveThreadResponse = ArchiveThreadResponseSchema.parse({
          archivedThreadId: threadId,
          threads: appServerThreads.map((thread) => rememberAppServerThread(threads, thread)),
          source: "app-server",
        });
        return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
      } catch (error) {
        const message = errorMessage(error);
        const status = /not found|no rollout found/i.test(message) ? 404 : 502;
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          apiError(status === 404 ? "not_found" : "archive_unavailable", message),
          status,
        );
      }
    }

    if (!threads.has(threadId)) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    threads.delete(threadId);
    liveThreads.delete(threadId);
    messagesByThreadId.delete(threadId);
    queuedInputsByThreadId.delete(threadId);
    steeringThreads.delete(threadId);
    const response: ArchiveThreadResponse = ArchiveThreadResponseSchema.parse({
      archivedThreadId: threadId,
      threads: sortedThreads(threads),
      source: "memory",
    });
    return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
  });

  app.get("/v1/threads/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    const detailStartedAt = Date.now();
    relayDebugLog("thread.detail.requested", {
      threadId,
    });
    const knownThread = threads.get(threadId);
    const wasKnownRunning =
      knownThread?.state === "running" || activeAppServerTurnIdsByThreadId.has(threadId);
    if (appServer) {
      try {
        const thread = await appServer.readThread(threadId, {
          includeTurns: false,
        });
        const mappedThread = rememberAppServerThread(threads, thread);
        const cachedMessages = messagesByThreadId.get(threadId) ?? [];
        let loadedMessages = false;
        let messages = cachedMessages;
        let responseThread = preserveKnownRunningThreadState(mappedThread, wasKnownRunning);

        const rolloutHistory = readRolloutThreadMessages(threadId, workspacePath);
        if (rolloutHistory.messages.length > 0) {
          messages = mergeThreadMessagePages(rolloutHistory.messages, cachedMessages);
          responseThread = rememberRolloutThreadMessages(
            threads,
            responseThread,
            messages,
            rolloutHistory.messageCountLowerBound,
          );
          responseThread = preserveKnownRunningThreadState(responseThread, wasKnownRunning);
          messagesByThreadId.set(threadId, messages);
          loadedMessages = true;
        } else if (cachedMessages.length > 0) {
          messages = dedupeThreadMessages(cachedMessages);
          if (messages.length !== cachedMessages.length) {
            messagesByThreadId.set(threadId, messages);
          }
          loadedMessages = true;
        }

        if (!loadedMessages && responseThread.state !== "running") {
          const threadWithTurns = await appServer.readThread(threadId, {
            includeTurns: true,
          });
          responseThread = rememberAppServerThread(threads, threadWithTurns);
          messages = mergeAppServerMessagesWithLocalStatus(
            mapAppServerMessages(threadWithTurns),
            cachedMessages,
          );
          messagesByThreadId.set(threadId, messages);
          loadedMessages = true;
        } else if (!loadedMessages) {
          scheduleAppServerHistoryLoad(threadId, cachedMessages);
        }

        const response = threadDetailResponse({
          thread: responseThread,
          messages,
          pendingInputRequests: pendingInputRequestsForThread(pendingApprovals, threadId),
        });
        relayDebugLog("thread.detail.responded", {
          durationMs: Date.now() - detailStartedAt,
          loadedMessages,
          messageCount: messages.length,
          state: responseThread.state,
          threadId,
        });
        return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
      } catch (caught) {
        relayDebugLog("thread.detail.app_server_failed", {
          error: caught instanceof Error ? caught.message : String(caught),
          threadId,
        });
        // Fall through to active in-memory threads.
      }
    }

    const cachedMessages = messagesByThreadId.get(threadId) ?? [];
    const rolloutHistory = readRolloutThreadMessages(threadId, workspacePath);
    const baseThread =
      threads.get(threadId) ??
      knownThread ??
      (rolloutHistory.rolloutPath
        ? rolloutThreadMetadata(threadId, workspacePath, rolloutHistory.rolloutPath, [
            ...rolloutHistory.messages,
            ...cachedMessages,
          ])
        : undefined);
    if (baseThread && (cachedMessages.length > 0 || rolloutHistory.messages.length > 0)) {
      const messages =
        rolloutHistory.messages.length > 0
          ? mergeThreadMessagePages(rolloutHistory.messages, cachedMessages)
          : dedupeThreadMessages(cachedMessages);
      const responseThread = rememberRolloutThreadMessages(
        threads,
        baseThread,
        messages,
        rolloutHistory.messageCountLowerBound,
      );
      messagesByThreadId.set(threadId, messages);
      const response = threadDetailResponse({
        thread: responseThread,
        messages,
        pendingInputRequests: pendingInputRequestsForThread(pendingApprovals, threadId),
      });
      relayDebugLog("thread.detail.responded", {
        durationMs: Date.now() - detailStartedAt,
        fastPath: "rollout",
        loadedMessages: true,
        messageCount: messages.length,
        state: responseThread.state,
        threadId,
      });
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response);
    }

    const thread = threads.get(threadId);
    if (!thread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      threadDetailResponse({
        thread,
        messages: messagesByThreadId.get(threadId) ?? [],
        pendingInputRequests: pendingInputRequestsForThread(pendingApprovals, threadId),
      }),
    );
  });

  app.get("/v1/threads/:threadId/messages/:messageId/details/:field", async (c) => {
    const threadId = c.req.param("threadId");
    const messageId = c.req.param("messageId");
    const parsedField = ThreadMessageDetailFieldSchema.safeParse(c.req.param("field"));
    if (!parsedField.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("invalid_request", "Message detail field must be output or patch."),
        400,
      );
    }

    let appServerThreadFound = false;
    if (appServer) {
      try {
        const thread = await appServer.readThread(threadId);
        appServerThreadFound = true;
        const detail = appServerThreadMessageDetail(thread, messageId, parsedField.data);
        if (detail.found) {
          return secureJson(
            c,
            options.pairing,
            secureSessionsByTokenHash,
            threadMessageDetailResponse(messageId, parsedField.data, detail.value),
          );
        }
      } catch {
        // Fall through to active in-memory threads.
      }
    }

    const localDetail = threads.has(threadId)
      ? localThreadMessageDetail(
          messagesByThreadId.get(threadId) ?? [],
          messageId,
          parsedField.data,
        )
      : { found: false as const };
    if (localDetail.found) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        threadMessageDetailResponse(messageId, parsedField.data, localDetail.value),
      );
    }

    if (!appServerThreadFound && !threads.has(threadId)) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      apiError("not_found", `Message detail ${parsedField.data} is not available.`),
      404,
    );
  });

  app.get("/v1/threads/:threadId/input", async (c) => {
    const threadId = c.req.param("threadId");
    const thread = threads.get(threadId);
    if (!thread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    const inputs = (queuedInputsByThreadId.get(threadId) ?? []).map(queuedThreadInputSummary);
    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      ListQueuedThreadInputsResponseSchema.parse({
        inputs,
        queueLength: inputs.length,
      }),
    );
  });

  app.get("/v1/threads/:threadId/context-window", async (c) => {
    const threadId = c.req.param("threadId");
    const result = readLatestContextWindowUsage({ threadId });
    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      ThreadContextWindowResponseSchema.parse({
        rolloutPath: result.rolloutPath,
        threadId,
        usage: result.usage,
      }),
    );
  });

  app.get("/openapi.json", (c) =>
    secureJson(c, options.pairing, secureSessionsByTokenHash, createOpenApiDocument()),
  );

  app.post("/v1/approvals/:approvalId", async (c) => {
    const approvalId = c.req.param("approvalId");
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      ResolveApprovalRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const pending = pendingApprovals.get(approvalId);
    if (!pending) {
      const resolved = resolvedApprovals.get(approvalId);
      if (resolved) {
        await resolved.promise;
        return secureJson(
          c,
          options.pairing,
          secureSessionsByTokenHash,
          ResolveApprovalResponseSchema.parse({ ok: true }),
        );
      }
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", "This approval request is no longer pending."),
        404,
      );
    }

    pendingApprovals.delete(approvalId);
    const resolution = resolveAppServerRequest(
      pending,
      parsed.data.decision,
      parsed.data.answers ?? [],
    )
      .then(() => {
        if (pending.messageId) {
          markApprovalMessageResolved(
            messagesByThreadId,
            pending.threadId,
            pending.messageId,
            parsed.data.decision,
          );
        }
        trimResolvedApprovals(resolvedApprovals);
      })
      .catch((error: unknown) => {
        resolvedApprovals.delete(approvalId);
        pendingApprovals.set(approvalId, pending);
        throw error;
      });
    resolvedApprovals.set(approvalId, { promise: resolution });
    await resolution;
    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      ResolveApprovalResponseSchema.parse({ ok: true }),
    );
  });

  app.post(apiPaths.threads, async (c) => {
    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      CreateThreadRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const selectedWorkspacePath = await validateThreadWorkspacePath(
      workspacePath,
      parsed.data.workspacePath,
    );
    if (!selectedWorkspacePath.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("invalid_workspace_path", selectedWorkspacePath.error),
        400,
      );
    }

    const hasRequestRuntimeOptions = hasExplicitRunOptions(parsed.data);
    const runOptions =
      parsed.data.prompt || hasRequestRuntimeOptions
        ? withRuntimePreferences(await preferences.read(selectedWorkspacePath.path), parsed.data)
        : parsed.data;
    const { threadId } = appServer
      ? await createAppServerThreadRecord({
          appServer,
          messagesByThreadId,
          options: runOptions,
          persistRuntimeOptions: Boolean(runOptions.prompt) || hasRequestRuntimeOptions,
          threads,
          title: runOptions.title,
          workspacePath: selectedWorkspacePath.path,
        })
      : createThreadRecord({
          codex,
          liveThreads,
          messagesByThreadId,
          threads,
          title: runOptions.title,
          prompt: runOptions.prompt,
          runOptions,
          threadOptions: buildThreadOptions(
            { ...threadOptions, workingDirectory: selectedWorkspacePath.path },
            runOptions,
          ),
        });

    const skills = runOptions.skills ?? [];
    const prompt = runOptions.prompt;

    if (!prompt) {
      const response: CreateThreadResponse = {
        thread: threads.get(threadId)!,
        messages: messagesByThreadId.get(threadId) ?? [],
      };
      return secureJson(c, options.pairing, secureSessionsByTokenHash, response, 201);
    }

    const response = await runPromptBuffered({
      codex,
      liveThreads,
      messagesByThreadId,
      prompt,
      attachments: runOptions.attachments ?? [],
      threadId,
      threadOptions: { ...threadOptions, workingDirectory: selectedWorkspacePath.path },
      runOptions,
      skills,
      threads,
    });

    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      response.body,
      response.status,
    );
  });

  app.post("/v1/threads/:threadId/runs", async (c) => {
    const threadId = c.req.param("threadId");
    const knownThread = await ensureKnownThread({
      appServer,
      threadId,
      messagesByThreadId,
      threads,
    });
    if (!knownThread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      RunThreadRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const runOptions = withRuntimePreferences(
      await preferences.read(knownThread.cwd ?? workspacePath),
      parsed.data,
    );
    const skills = runOptions.skills ?? [];
    const prompt = runOptions.prompt;
    const response = await runPromptBuffered({
      codex,
      liveThreads,
      messagesByThreadId,
      prompt,
      attachments: runOptions.attachments ?? [],
      threadId,
      threadOptions: { ...threadOptions, workingDirectory: knownThread.cwd ?? workspacePath },
      runOptions,
      skills,
      threads,
    });

    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      response.body,
      response.status,
    );
  });

  app.post("/v1/threads/:threadId/input", async (c) => {
    const threadId = c.req.param("threadId");
    const knownThread = await ensureKnownThread({
      appServer,
      threadId,
      messagesByThreadId,
      threads,
    });
    if (!knownThread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }
    if (!appServer) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("unsupported", "Running-thread input requires the Codex app-server."),
        409,
      );
    }
    if (knownThread.state !== "running") {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("thread_not_running", `Thread ${threadId} is not currently running.`),
        409,
      );
    }

    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      RunThreadRequestSchema,
    );
    if (!parsed.success) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }

    const runOptions = withRuntimePreferences(
      await preferences.read(knownThread.cwd ?? workspacePath),
      parsed.data,
    );
    const skills = runOptions.skills ?? [];
    const prompt = runOptions.prompt;
    const queuedInputs = queuedInputsByThreadId.get(threadId) ?? [];
    const queuedInput: QueuedThreadInput = {
      attachments: runOptions.attachments ?? [],
      id: randomUUID(),
      prompt,
      runOptions,
      skills,
      workspacePath: knownThread.cwd ?? workspacePath,
    };
    queuedInputs.push(queuedInput);
    queuedInputsByThreadId.set(threadId, queuedInputs);

    const thread = updateThread(threads, messagesByThreadId, threadId, {
      state: "running",
      lastPrompt: promptWithAttachmentReferences(prompt, runOptions.attachments ?? []),
      lastError: undefined,
      ...runtimeMetadataFromOptions(runOptions),
    });
    const response: SubmitThreadInputResponse = SubmitThreadInputResponseSchema.parse({
      acceptedAs: "queued",
      input: queuedThreadInputSummary(queuedInput),
      queueLength: queuedInputsByThreadId.get(threadId)?.length ?? 0,
      thread,
    });
    return secureJson(c, options.pairing, secureSessionsByTokenHash, response, 202);
  });

  app.delete("/v1/threads/:threadId/input/:inputId", async (c) => {
    const threadId = c.req.param("threadId");
    const inputId = c.req.param("inputId");
    const queuedInput = removeQueuedInput(queuedInputsByThreadId, threadId, inputId);
    if (!queuedInput) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Queued input ${inputId} is not known to this thread.`),
        404,
      );
    }
    const thread = threads.get(threadId);
    if (!thread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }
    const response = QueuedThreadInputActionResponseSchema.parse({
      input: queuedThreadInputSummary(queuedInput),
      queueLength: queuedInputsByThreadId.get(threadId)?.length ?? 0,
      thread,
    });
    return secureJson(c, options.pairing, secureSessionsByTokenHash, response, 200);
  });

  app.post("/v1/threads/:threadId/input/:inputId/steer", async (c) => {
    const threadId = c.req.param("threadId");
    const inputId = c.req.param("inputId");
    const knownThread = await ensureKnownThread({
      appServer,
      threadId,
      messagesByThreadId,
      threads,
    });
    if (!knownThread) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }
    if (!appServer) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("unsupported", "Running-thread input requires the Codex app-server."),
        409,
      );
    }
    if (knownThread.state !== "running") {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("thread_not_running", `Thread ${threadId} is not currently running.`),
        409,
      );
    }
    const queuedInput = removeQueuedInput(queuedInputsByThreadId, threadId, inputId);
    if (!queuedInput) {
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Queued input ${inputId} is not known to this thread.`),
        404,
      );
    }

    steeringThreads.add(threadId);
    await startAppServerTurn(appServer, threadId, queuedInput);
    const thread = updateThread(threads, messagesByThreadId, threadId, {
      state: "running",
      lastPrompt: promptWithAttachmentReferences(queuedInput.prompt, queuedInput.attachments),
      lastError: undefined,
    });
    const response = QueuedThreadInputActionResponseSchema.parse({
      input: queuedThreadInputSummary(queuedInput),
      queueLength: queuedInputsByThreadId.get(threadId)?.length ?? 0,
      thread,
    });
    return secureJson(c, options.pairing, secureSessionsByTokenHash, response, 202);
  });

  app.post("/v1/threads/:threadId/runs/interrupt", async (c) => {
    const threadId = c.req.param("threadId");
    const knownThread = await ensureKnownThread({
      appServer,
      threadId,
      messagesByThreadId,
      threads,
    });
    relayDebugLog("thread.interrupt.requested", {
      knownState: knownThread?.state,
      path: c.req.path,
      threadId,
    });
    if (!knownThread) {
      relayDebugLog("thread.interrupt.rejected", {
        reason: "unknown_thread",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }
    if (!appServer) {
      relayDebugLog("thread.interrupt.rejected", {
        reason: "app_server_unavailable",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("unsupported", "Running-thread interrupt requires the Codex app-server."),
        409,
      );
    }

    let turnId = activeAppServerTurnIdsByThreadId.get(threadId);
    if (!turnId && typeof appServer.readThread === "function") {
      try {
        turnId = latestRunningTurnId(await appServer.readThread(threadId));
      } catch {}
    }
    if (!turnId) {
      relayDebugLog("thread.interrupt.rejected", {
        reason: "no_active_turn",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("no_active_turn", `Thread ${threadId} does not have an active turn.`),
        409,
      );
    }

    try {
      await appServer.interruptTurn({ threadId, turnId });
    } catch (error) {
      relayDebugLog("thread.interrupt.failed", {
        error: errorMessage(error),
        threadId,
        turnId,
      });
      throw error;
    }
    relayDebugLog("thread.interrupt.completed", { threadId, turnId });
    activeAppServerTurnIdsByThreadId.delete(threadId);
    queuedInputsByThreadId.delete(threadId);
    steeringThreads.delete(threadId);
    const thread = updateThread(threads, messagesByThreadId, threadId, {
      state: "completed",
      lastError: undefined,
    });
    return secureJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      InterruptThreadRunResponseSchema.parse({ thread }),
      200,
    );
  });

  app.post("/v1/threads/:threadId/runs/stream", async (c) => {
    const threadId = c.req.param("threadId");
    const knownThread = await ensureKnownThread({
      appServer,
      threadId,
      messagesByThreadId,
      threads,
    });
    relayDebugLog("thread.stream.requested", {
      knownState: knownThread?.state,
      path: c.req.path,
      threadId,
    });
    if (!knownThread) {
      relayDebugLog("thread.stream.rejected", {
        reason: "unknown_thread",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("not_found", `Thread ${threadId} is not known to this server.`),
        404,
      );
    }

    const parsed = await parseRequestJson(
      c,
      options.pairing,
      secureSessionsByTokenHash,
      StreamThreadRunRequestSchema,
    );
    if (!parsed.success) {
      relayDebugLog("thread.stream.rejected", {
        reason: "invalid_request",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        validationError(parsed.error),
        400,
      );
    }
    if (!parsed.data.prompt && !appServer) {
      relayDebugLog("thread.stream.rejected", {
        reason: "attach_requires_app_server",
        threadId,
      });
      return secureJson(
        c,
        options.pairing,
        secureSessionsByTokenHash,
        apiError("unsupported", "Running-thread stream attachment requires the Codex app-server."),
        409,
      );
    }

    const runOptions = withRuntimePreferences(
      await preferences.read(knownThread.cwd ?? workspacePath),
      parsed.data,
    );
    relayDebugLog("thread.stream.accepted", {
      hasPrompt: Boolean(runOptions.prompt),
      source: knownThread.source,
      threadId,
      workspacePath: knownThread.cwd ?? workspacePath,
    });
    const encoder = new TextEncoder();
    const secureSession = getSecureSessionForRequest(c, options.pairing, secureSessionsByTokenHash);
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamSettled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        activeStreamControllers.add(controller);
        relayDebugLog("thread.stream.started", {
          mode: !runOptions.prompt && appServer ? "attach" : "run",
          threadId,
        });
        const stopPreviewMonitor = startWebPreviewTargetMonitor({
          bridgeUrl: c.req.url,
          send(target) {
            sendSse(controller, encoder, secureSession, {
              type: "thread.preview_target.detected",
              threadId,
              target,
            });
          },
        });
        if (!runOptions.prompt && appServer) {
          void streamRunningAppServerThread({
            appServer,
            controller,
            encoder,
            messagesByThreadId,
            pendingApprovals,
            secureSession,
            threadId,
            threads,
          }).finally(() => {
            streamSettled = true;
            relayDebugLog("thread.stream.finished", { mode: "attach", threadId });
            activeStreamControllers.delete(controller);
            stopPreviewMonitor();
          });
          return;
        }
        const rawPrompt = runOptions.prompt;
        if (!rawPrompt) {
          sendSse(controller, encoder, secureSession, {
            type: "thread.error",
            thread: knownThread,
            error: apiError(
              "unsupported",
              "Running-thread stream attachment requires the Codex app-server.",
            ).error,
          });
          closeSseController(controller);
          streamSettled = true;
          relayDebugLog("thread.stream.finished", { mode: "unsupported", threadId });
          activeStreamControllers.delete(controller);
          stopPreviewMonitor();
          return;
        }
        const skills = runOptions.skills ?? [];
        const prompt = rawPrompt;
        void runPromptStreamed({
          appServer,
          activeAppServerTurnIdsByThreadId,
          controller,
          codex,
          encoder,
          liveThreads,
          messagesByThreadId,
          pendingApprovals,
          queuedInputsByThreadId,
          prompt,
          attachments: runOptions.attachments ?? [],
          secureSession,
          skills,
          steeringThreads,
          threadId,
          threadOptions: { ...threadOptions, workingDirectory: knownThread.cwd ?? workspacePath },
          runOptions,
          threads,
        }).finally(() => {
          streamSettled = true;
          relayDebugLog("thread.stream.finished", { mode: "run", threadId });
          activeStreamControllers.delete(controller);
          stopPreviewMonitor();
        });
      },
      cancel(reason) {
        if (streamController) {
          activeStreamControllers.delete(streamController);
        }
        relayDebugLog("thread.stream.cancelled_by_client", {
          reason: debugReason(reason),
          settled: streamSettled,
          threadId,
        });
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      },
    });
  });

  return app;
}

function parseBearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function normalizeApprovalCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replaceAll("O", "0")
    .replaceAll("I", "1");
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

function normalizeClientSessionId(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

async function validateThreadWorkspacePath(rootPath: string, requestedPath: string | undefined) {
  const resolved = resolve(requestedPath ?? rootPath);

  try {
    const workspaceStat = await stat(resolved);
    if (!workspaceStat.isDirectory()) {
      return { success: false as const, error: "New chat workspace must be a directory." };
    }
  } catch (error) {
    return { success: false as const, error: errorMessage(error) };
  }

  return { success: true as const, path: resolved };
}

async function createApprovalCode(sessions: PairingSessionStore) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = normalizeApprovalCode(crypto.randomUUID().replace(/-/g, "").slice(0, 8));
    if (!(await sessions.getPendingPairing(code, Date.now()))) {
      return code;
    }
  }

  throw new Error("Unable to allocate a pairing approval code.");
}

async function getValidClientSession(pairing: PairingOptions, token: string) {
  return pairing.sessions.getValidSession(pairing.hashClientToken(token), Date.now());
}

function externalRequestOrigin(requestUrl: string, header: (name: string) => string | undefined) {
  const request = new URL(requestUrl);
  const forwardedProto = header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || header("host");
  const protocol = forwardedProto || request.protocol.replace(":", "");

  if (host) {
    return `${protocol}://${host}`;
  }

  return request.origin;
}

function createThreadRecord(input: {
  codex: CodexClient;
  liveThreads: Map<string, ReturnType<CodexClient["startThread"]>>;
  messagesByThreadId: Map<string, ChatMessage[]>;
  prompt?: string;
  runOptions?: RuntimeOptionSubset;
  threadOptions: Parameters<CodexClient["startThread"]>[0];
  threads: Map<string, ThreadMetadata>;
  title?: string;
}) {
  const now = new Date().toISOString();
  const thread = input.codex.startThread(input.threadOptions);
  const threadId = getThreadId(thread) ?? `local-${crypto.randomUUID()}`;
  const metadata: ThreadMetadata = ThreadSummarySchema.parse({
    id: threadId,
    title: input.title ?? titleFromPrompt(input.prompt) ?? "New Codex thread",
    createdAt: now,
    updatedAt: now,
    state: "idle",
    cwd: input.threadOptions?.workingDirectory,
    messageCount: 0,
    ...(input.prompt || hasExplicitRunOptions(input.runOptions ?? {})
      ? runtimeMetadataFromOptions(input.runOptions ?? {})
      : {}),
  });

  input.threads.set(threadId, metadata);
  input.messagesByThreadId.set(threadId, []);
  input.liveThreads.set(threadId, thread);

  return { threadId };
}

async function createAppServerThreadRecord(input: {
  appServer: CodexAppServerClient;
  messagesByThreadId: Map<string, ChatMessage[]>;
  options: {
    approvalPolicy?: string;
    collaborationMode?: ThreadCollaborationMode;
    model?: string;
    serviceTier?: string;
    reasoningEffort?: string;
    runtimeMode?: RuntimeMode;
    sandboxMode?: string;
  };
  persistRuntimeOptions?: boolean;
  threads: Map<string, ThreadMetadata>;
  title?: string;
  workspacePath: string;
}) {
  const runtime = resolveAppServerRuntime(input.options, input.workspacePath);
  const thread = await input.appServer.startThread({
    approvalPolicy: runtime.approvalPolicy,
    cwd: input.workspacePath,
    experimentalRawEvents: false,
    model: input.options.model ?? null,
    persistExtendedHistory: true,
    sandbox: runtime.sandbox,
    serviceTier: input.options.serviceTier ?? null,
  });
  const metadata = ThreadSummarySchema.parse({
    ...mapAppServerThread({
      ...thread,
      name: input.title ?? thread.name,
      preview: input.title ?? thread.preview,
    }),
    ...(input.persistRuntimeOptions ? runtimeMetadataFromOptions(input.options) : {}),
  });
  input.threads.set(thread.id, metadata);
  input.messagesByThreadId.set(thread.id, []);
  return { threadId: thread.id };
}

async function runPromptBuffered(input: {
  attachments: PromptAttachment[];
  codex: CodexClient;
  liveThreads: Map<string, ReturnType<CodexClient["startThread"]>>;
  messagesByThreadId: Map<string, ChatMessage[]>;
  prompt: string;
  runOptions: {
    model?: string;
    serviceTier?: string;
    runtimeMode?: RuntimeMode;
    approvalPolicy?: string;
    sandboxMode?: string;
    reasoningEffort?: string;
    collaborationMode?: ThreadCollaborationMode;
  };
  skills: PromptSkill[];
  threadId: string;
  threadOptions: Parameters<CodexClient["startThread"]>[0];
  threads: Map<string, ThreadMetadata>;
}): Promise<{ status: 200 | 500; body: RunThreadResponse | ErrorResponse }> {
  if (input.skills.length > 0) {
    return {
      status: 500,
      body: apiError("skills_require_app_server", "Skill mentions require the Codex app-server."),
    };
  }
  const displayPrompt = promptWithAttachments(input.prompt, input.attachments);
  const runPrompt = promptWithAttachments(
    promptForCollaborationMode(input.prompt, input.runOptions.collaborationMode),
    input.attachments,
  );
  const userMessage = appendMessage(input.messagesByThreadId, input.threadId, {
    role: "user",
    content: displayPrompt,
    details: chatMessageDetailsFromPromptContext(input),
  });
  updateThread(input.threads, input.messagesByThreadId, input.threadId, {
    state: "running",
    lastPrompt: displayPrompt,
    lastError: undefined,
    title: maybeReplaceDefaultTitle(input.threads.get(input.threadId)?.title, displayPrompt),
    ...runtimeMetadataFromOptions(input.runOptions),
  });

  try {
    const options = buildThreadOptions(input.threadOptions, input.runOptions);
    const thread = hasExplicitRunOptions(input.runOptions)
      ? input.codex.resumeThread(input.threadId, options)
      : (input.liveThreads.get(input.threadId) ??
        input.codex.resumeThread(input.threadId, options));
    input.liveThreads.set(input.threadId, thread);
    const result = stringifyRunResult(await thread.run(runPrompt));
    const planContent =
      input.runOptions.collaborationMode === "plan" ? proposedPlanContent(result) : undefined;
    const actualThreadId = replaceLocalThreadId(
      input.threads,
      input.messagesByThreadId,
      input.liveThreads,
      input.threadId,
      getThreadId(thread),
    );

    const assistantMessage = appendMessage(input.messagesByThreadId, actualThreadId, {
      role: "assistant",
      kind: input.runOptions.collaborationMode === "plan" ? "plan" : undefined,
      content: planContent ?? result,
      details: planContent ? { raw: result } : undefined,
      state: "completed",
    });
    const threadSummary = updateThread(input.threads, input.messagesByThreadId, actualThreadId, {
      state: "completed",
      lastResult: result,
      lastError: undefined,
    });

    return {
      status: 200,
      body: {
        thread: threadSummary,
        messages: [userMessage, assistantMessage],
        result,
      },
    };
  } catch (error) {
    const failed = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
      state: "failed",
      lastError: errorMessage(error),
    });
    appendMessage(input.messagesByThreadId, input.threadId, {
      role: "error",
      content: failed.lastError ?? "Codex run failed.",
      state: "failed",
    });

    return {
      status: 500,
      body: apiError("codex_run_failed", failed.lastError ?? "Codex run failed."),
    };
  }
}

async function runPromptStreamed(input: {
  activeAppServerTurnIdsByThreadId: Map<string, string>;
  appServer: CodexAppServerClient | null;
  attachments: PromptAttachment[];
  controller: ReadableStreamDefaultController<Uint8Array>;
  codex: CodexClient;
  encoder: TextEncoder;
  liveThreads: Map<string, ReturnType<CodexClient["startThread"]>>;
  messagesByThreadId: Map<string, ChatMessage[]>;
  pendingApprovals: Map<string, PendingApproval>;
  queuedInputsByThreadId: Map<string, QueuedThreadInput[]>;
  prompt: string;
  secureSession?: SecureSessionHandle;
  steeringThreads: Set<string>;
  runOptions: {
    model?: string;
    serviceTier?: string;
    runtimeMode?: RuntimeMode;
    approvalPolicy?: string;
    sandboxMode?: string;
    reasoningEffort?: string;
    collaborationMode?: ThreadCollaborationMode;
  };
  skills: PromptSkill[];
  threadId: string;
  threadOptions: Parameters<CodexClient["startThread"]>[0];
  threads: Map<string, ThreadMetadata>;
}) {
  if (input.appServer) {
    await runAppServerPromptStreamed({
      appServer: input.appServer,
      attachments: input.attachments,
      activeAppServerTurnIdsByThreadId: input.activeAppServerTurnIdsByThreadId,
      controller: input.controller,
      encoder: input.encoder,
      messagesByThreadId: input.messagesByThreadId,
      pendingApprovals: input.pendingApprovals,
      queuedInputsByThreadId: input.queuedInputsByThreadId,
      prompt: input.prompt,
      runOptions: input.runOptions,
      secureSession: input.secureSession,
      skills: input.skills,
      steeringThreads: input.steeringThreads,
      threadId: input.threadId,
      threads: input.threads,
      workspacePath: input.threadOptions?.workingDirectory ?? defaultWorkspacePath,
    });
    return;
  }

  let activeThreadId = input.threadId;
  let assistantMessage: ChatMessage | undefined;

  try {
    if (input.skills.length > 0) {
      throw new Error("Skill mentions require the Codex app-server.");
    }
    const displayPrompt = promptWithAttachments(input.prompt, input.attachments);
    const runPrompt = promptWithAttachments(
      promptForCollaborationMode(input.prompt, input.runOptions.collaborationMode),
      input.attachments,
    );
    const userMessage = appendMessage(input.messagesByThreadId, activeThreadId, {
      role: "user",
      content: displayPrompt,
      details: chatMessageDetailsFromPromptContext(input),
    });
    let threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "running",
      lastPrompt: displayPrompt,
      lastError: undefined,
      title: maybeReplaceDefaultTitle(input.threads.get(activeThreadId)?.title, displayPrompt),
      ...runtimeMetadataFromOptions(input.runOptions),
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.message.created",
      thread: threadSummary,
      message: userMessage,
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.state.changed",
      thread: threadSummary,
    });

    const options = buildThreadOptions(input.threadOptions, input.runOptions);
    const thread = hasExplicitRunOptions(input.runOptions)
      ? input.codex.resumeThread(activeThreadId, options)
      : (input.liveThreads.get(activeThreadId) ??
        input.codex.resumeThread(activeThreadId, options));
    input.liveThreads.set(activeThreadId, thread);

    if (!thread.runStreamed) {
      const result = stringifyRunResult(await thread.run(runPrompt));
      const planContent =
        input.runOptions.collaborationMode === "plan" ? proposedPlanContent(result) : undefined;
      activeThreadId = replaceLocalThreadId(
        input.threads,
        input.messagesByThreadId,
        input.liveThreads,
        activeThreadId,
        getThreadId(thread),
      );
      assistantMessage = appendMessage(input.messagesByThreadId, activeThreadId, {
        role: "assistant",
        kind: input.runOptions.collaborationMode === "plan" ? "plan" : undefined,
        content: planContent ?? result,
        details: planContent ? { raw: result } : undefined,
        state: "completed",
      });
      threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
        state: "completed",
        lastResult: result,
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.message.completed",
        thread: threadSummary,
        message: assistantMessage,
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.state.changed",
        thread: threadSummary,
      });
      return;
    }

    const streamed = await thread.runStreamed(runPrompt);
    activeThreadId = replaceLocalThreadId(
      input.threads,
      input.messagesByThreadId,
      input.liveThreads,
      activeThreadId,
      getThreadId(thread),
    );
    assistantMessage = appendMessage(input.messagesByThreadId, activeThreadId, {
      role: "assistant",
      kind: input.runOptions.collaborationMode === "plan" ? "plan" : undefined,
      content: "",
      state: "streaming",
    });
    threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "running",
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.message.created",
      thread: threadSummary,
      message: assistantMessage,
    });

    for await (const event of streamed.events) {
      const kind = classifyStreamEvent(event);
      const text = extractStreamText(event);

      if (kind === "error") {
        throw new Error(text ?? "Codex run failed.");
      }

      if (!text) {
        continue;
      }

      if (kind === "assistant") {
        const assistantPatch = appendMessageDelta(
          input.messagesByThreadId,
          activeThreadId,
          assistantMessage.id,
          text,
        );
        assistantMessage = assistantPatch.message;
        updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
          state: "running",
          lastResult: assistantMessage.content,
        });
        if (assistantPatch.delta) {
          sendSse(input.controller, input.encoder, input.secureSession, {
            type: "thread.message.delta",
            threadId: activeThreadId,
            messageId: assistantMessage.id,
            delta: assistantPatch.delta,
          });
        }
      } else {
        const structured = structuredStreamMessage(kind, event, text);
        const statusMessage = appendMessage(input.messagesByThreadId, activeThreadId, {
          role: kind,
          kind: structured.kind,
          content: structured.content,
          details: structured.details,
          state: "completed",
        });
        threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
          state: "running",
        });
        sendSse(input.controller, input.encoder, input.secureSession, {
          type: "thread.message.created",
          thread: threadSummary,
          message: statusMessage,
        });
      }
    }

    assistantMessage = updateMessage(
      input.messagesByThreadId,
      activeThreadId,
      assistantMessage.id,
      {
        ...(assistantMessage.kind === "plan" && proposedPlanContent(assistantMessage.content)
          ? {
              content: proposedPlanContent(assistantMessage.content),
              details: { raw: assistantMessage.content },
            }
          : {}),
        state: "completed",
      },
    );
    threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "completed",
      lastResult: assistantMessage.content,
      lastError: undefined,
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.message.completed",
      thread: threadSummary,
      message: assistantMessage,
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.state.changed",
      thread: threadSummary,
    });
  } catch (error) {
    input.steeringThreads.delete(activeThreadId);
    const threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "failed",
      lastError: errorMessage(error),
    });
    const errorBody = apiError("codex_run_failed", threadSummary.lastError ?? "Codex run failed.");
    appendMessage(input.messagesByThreadId, activeThreadId, {
      role: "error",
      content: errorBody.error.message,
      state: "failed",
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.error",
      thread: threadSummary,
      error: errorBody.error,
    });
  } finally {
    closeSseController(input.controller);
  }
}

async function startAppServerTurn(
  appServer: CodexAppServerClient,
  threadId: string,
  input: QueuedThreadInput,
) {
  const runtime = resolveAppServerRuntime(input.runOptions, input.workspacePath);
  const params: AppServerTurnStartParams = {
    approvalPolicy: runtime.approvalPolicy,
    collaborationMode: appServerCollaborationMode(input.runOptions),
    cwd: input.workspacePath,
    effort: input.runOptions.reasoningEffort ?? null,
    input: appServerTurnInput(input.prompt, input.attachments, input.skills),
    model: input.runOptions.model ?? null,
    sandboxPolicy: runtime.sandboxPolicy,
    serviceTier: input.runOptions.serviceTier ?? null,
    threadId,
  };

  await resumeAppServerThreadIfNeeded(appServer, threadId, input, runtime);
  try {
    return await appServer.startTurn(params);
  } catch (error) {
    if (!isAppServerThreadNotLoadedError(error)) {
      throw error;
    }
    await resumeAppServerThread(appServer, threadId, input, runtime);
    return appServer.startTurn(params);
  }
}

async function resumeAppServerThreadIfNeeded(
  appServer: CodexAppServerClient,
  threadId: string,
  input: QueuedThreadInput,
  runtime: ReturnType<typeof resolveAppServerRuntime>,
) {
  if (typeof appServer.readThread !== "function") {
    return;
  }

  let thread: AppServerThread;
  try {
    thread = await appServer.readThread(threadId, { includeTurns: false });
  } catch {
    return;
  }
  if (!isAppServerThreadNotLoaded(thread)) {
    return;
  }
  await resumeAppServerThread(appServer, threadId, input, runtime);
}

async function resumeAppServerThread(
  appServer: CodexAppServerClient,
  threadId: string,
  input: QueuedThreadInput,
  runtime: ReturnType<typeof resolveAppServerRuntime>,
) {
  if (typeof appServer.resumeThread !== "function") {
    return;
  }
  await appServer.resumeThread({
    approvalPolicy: runtime.approvalPolicy,
    cwd: input.workspacePath,
    excludeTurns: false,
    model: input.runOptions.model ?? null,
    persistExtendedHistory: true,
    sandbox: runtime.sandbox,
    serviceTier: input.runOptions.serviceTier ?? null,
    threadId,
  });
}

function isAppServerThreadNotLoaded(thread: AppServerThread) {
  const status = thread.status;
  return Boolean(
    status && typeof status === "object" && "type" in status && status.type === "notLoaded",
  );
}

function latestRunningTurnId(thread: AppServerThread) {
  return [...(thread.turns ?? [])]
    .reverse()
    .find((turn) => mapAppServerThreadState(turn.status) === "running")?.id;
}

function isAppServerThreadNotLoadedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("thread not found") || message.includes("not loaded");
}

function shiftQueuedInput(
  queuedInputsByThreadId: Map<string, QueuedThreadInput[]>,
  threadId: string,
) {
  const queuedInputs = queuedInputsByThreadId.get(threadId);
  const nextInput = queuedInputs?.shift();
  if (!queuedInputs || queuedInputs.length === 0) {
    queuedInputsByThreadId.delete(threadId);
  }
  return nextInput;
}

function removeQueuedInput(
  queuedInputsByThreadId: Map<string, QueuedThreadInput[]>,
  threadId: string,
  inputId: string,
) {
  const queuedInputs = queuedInputsByThreadId.get(threadId);
  if (!queuedInputs) {
    return undefined;
  }
  const index = queuedInputs.findIndex((input) => input.id === inputId);
  if (index === -1) {
    return undefined;
  }
  const [input] = queuedInputs.splice(index, 1);
  if (queuedInputs.length === 0) {
    queuedInputsByThreadId.delete(threadId);
  }
  return input;
}

function queuedThreadInputSummary(input: QueuedThreadInput) {
  const context = normalizePromptContext(input);
  return {
    attachments: context.attachments,
    id: input.id,
    prompt: input.prompt,
    skills: context.skills,
  };
}

async function streamRunningAppServerThread(input: {
  appServer: CodexAppServerClient;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  messagesByThreadId: Map<string, ChatMessage[]>;
  pendingApprovals: Map<string, PendingApproval>;
  secureSession?: SecureSessionHandle;
  threadId: string;
  threads: Map<string, ThreadMetadata>;
}) {
  let activeTurnId: string | undefined;
  let assistantMessageId: string | undefined;
  let observedTurnActivity = false;
  let threadSummary = input.threads.get(input.threadId);

  const cleanupRequestHandler = input.appServer.onRequest((request) => {
    if (!isApprovalServerRequest(request.method)) {
      void input.appServer.rejectRequest(
        request.id,
        -32601,
        `${request.method} is not supported by Codex Relay mobile yet.`,
      );
      return;
    }

    const approval = approvalMessageFromRequest(request);
    if (!approval || approval.threadId !== input.threadId) {
      void input.appServer.rejectRequest(request.id, -32602, "Approval request is malformed.");
      return;
    }

    if (approval.kind === "structuredUserInput") {
      const pending = {
        appServer: input.appServer,
        kind: approval.kind,
        method: request.method,
        questions: approval.questions,
        requestId: request.id,
        threadId: input.threadId,
        turnId: approval.turnId,
      } satisfies PendingApproval;
      input.pendingApprovals.set(approval.approvalId, pending);
      threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
        state: "running",
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.input_request.created",
        thread: threadSummary,
        request: pendingInputRequestFromApproval(approval, input.threadId),
      });
      return;
    }

    const message = appendMessage(input.messagesByThreadId, input.threadId, {
      role: "status",
      kind: "approvalRequest",
      content: approval.content,
      details: approval.details,
      state: "completed",
      turnId: approval.turnId,
    });
    input.pendingApprovals.set(approval.approvalId, {
      appServer: input.appServer,
      kind: approval.kind,
      messageId: message.id,
      method: request.method,
      requestId: request.id,
      threadId: input.threadId,
    });
    threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
      state: "running",
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.message.created",
      thread: threadSummary,
      message,
    });
  });

  let cleanupNotificationHandler = (): void => undefined;
  const completed = new Promise<void>((resolve, reject) => {
    cleanupNotificationHandler = input.appServer.onNotification((notification) => {
      const params = recordParams(notification);
      const notificationThreadId = firstString(params, ["threadId"]);
      if (notificationThreadId && notificationThreadId !== input.threadId) {
        return;
      }

      try {
        switch (notification.method) {
          case "thread/status/changed": {
            const state = mapAppServerThreadState(params?.status);
            if (state !== "running" && observedTurnActivity) {
              return;
            }
            threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
              state,
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.state.changed",
              thread: threadSummary,
            });
            if (state !== "running") {
              cleanupNotificationHandler();
              resolve();
            }
            return;
          }
          case "turn/started":
            observedTurnActivity = true;
            activeTurnId = firstString(params, ["turnId"]) ?? turnIdFromParams(params);
            return;
          case "item/started":
          case "item/completed": {
            observedTurnActivity = true;
            const item = params?.item;
            if (!item || typeof item !== "object") {
              return;
            }
            const message = upsertAppServerItemMessage(
              input.messagesByThreadId,
              input.threadId,
              firstString(params, ["turnId"]) ?? activeTurnId,
              item as AppServerThreadItem,
            );
            if (!message) {
              return;
            }
            if (message.role === "assistant") {
              assistantMessageId = message.id;
            }
            threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
              state: "running",
              lastResult: message.role === "assistant" ? message.content : undefined,
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type:
                notification.method === "item/completed" && message.role === "assistant"
                  ? "thread.message.completed"
                  : "thread.message.created",
              thread: threadSummary,
              message,
            });
            return;
          }
          case "item/agentMessage/delta": {
            observedTurnActivity = true;
            const itemId = firstString(params, ["itemId"]);
            const delta = firstString(params, ["delta"]);
            if (!itemId || !delta) {
              return;
            }
            if (!input.messagesByThreadId.get(input.threadId)?.some((item) => item.id === itemId)) {
              appendMessageWithId(input.messagesByThreadId, input.threadId, itemId, {
                role: "assistant",
                content: "",
                state: "streaming",
                turnId: firstString(params, ["turnId"]) ?? activeTurnId,
              });
            }
            assistantMessageId = itemId;
            const patch = appendMessageDelta(
              input.messagesByThreadId,
              input.threadId,
              itemId,
              delta,
            );
            const message = patch.message;
            updateThread(input.threads, input.messagesByThreadId, input.threadId, {
              state: "running",
              lastResult: message.content,
            });
            if (patch.delta) {
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.message.delta",
                threadId: input.threadId,
                messageId: itemId,
                delta: patch.delta,
              });
            }
            return;
          }
          case "turn/plan/updated": {
            observedTurnActivity = true;
            const content = planContentFromRecord(params);
            const message = appendMessage(input.messagesByThreadId, input.threadId, {
              role: "status",
              kind: "plan",
              content: content || "Plan updated",
              details: planDetailsFromRecord(params),
              state: "completed",
              turnId: firstString(params, ["turnId"]) ?? activeTurnId,
            });
            threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
              state: "running",
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.message.created",
              thread: threadSummary,
              message,
            });
            return;
          }
          case "turn/aborted":
          case "turn/cancelled":
          case "turn/completed":
          case "turn/failed": {
            observedTurnActivity = true;
            const state = terminalTurnState(notification.method, params);
            relayDebugLog("app_server.turn.terminal", {
              method: notification.method,
              state,
              threadId: input.threadId,
              turnId: firstString(params, ["turnId"]) ?? activeTurnId,
            });
            if (assistantMessageId) {
              const completedMessage = updateMessage(
                input.messagesByThreadId,
                input.threadId,
                assistantMessageId,
                { state: "completed" },
              );
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.message.completed",
                thread: threadSummary ?? input.threads.get(input.threadId)!,
                message: completedMessage,
              });
            }
            threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
              state,
              lastError: state === "failed" ? turnErrorMessage(params) : undefined,
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.state.changed",
              thread: threadSummary,
            });
            if (state === "failed") {
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.error",
                thread: threadSummary,
                error: apiError(
                  "codex_run_failed",
                  threadSummary.lastError ?? "Codex turn did not complete.",
                ).error,
              });
            }
            cleanupNotificationHandler();
            resolve();
            return;
          }
        }
      } catch (error) {
        cleanupNotificationHandler();
        reject(error);
      }
    });
  });

  try {
    const appServerThread = await input.appServer.readThread(input.threadId, {
      includeTurns: false,
    });
    threadSummary = rememberAppServerThread(input.threads, appServerThread);
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.state.changed",
      thread: threadSummary,
    });
    if (threadSummary.state !== "running") {
      return;
    }
    await completed;
  } catch (error) {
    threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
      state: "failed",
      lastError: errorMessage(error),
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.error",
      thread: threadSummary,
      error: apiError("codex_run_failed", threadSummary.lastError ?? "Codex run failed.").error,
    });
  } finally {
    cleanupRequestHandler();
    cleanupNotificationHandler();
    closeSseController(input.controller);
  }
}

async function runAppServerPromptStreamed(input: {
  activeAppServerTurnIdsByThreadId: Map<string, string>;
  appServer: CodexAppServerClient;
  attachments: PromptAttachment[];
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  messagesByThreadId: Map<string, ChatMessage[]>;
  pendingApprovals: Map<string, PendingApproval>;
  queuedInputsByThreadId: Map<string, QueuedThreadInput[]>;
  prompt: string;
  runOptions: {
    model?: string;
    serviceTier?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
    runtimeMode?: RuntimeMode;
    reasoningEffort?: string;
    collaborationMode?: ThreadCollaborationMode;
  };
  secureSession?: SecureSessionHandle;
  skills: PromptSkill[];
  steeringThreads: Set<string>;
  threadId: string;
  threads: Map<string, ThreadMetadata>;
  workspacePath: string;
}) {
  let activeThreadId = input.threadId;
  let activeTurnId: string | undefined;
  let assistantMessageId: string | undefined;
  let waitingForActiveTurnMessageId: string | undefined;
  const displayPrompt = promptMarkdownWithSkills(
    promptWithAttachmentReferences(input.prompt, input.attachments),
    input.skills,
  );
  const prompt = input.prompt;
  let handedOffToQueuedTurn = false;
  let producedTurnOutput = false;

  let userMessage = appendMessage(input.messagesByThreadId, activeThreadId, {
    role: "user",
    content: displayPrompt,
    details: chatMessageDetailsFromPromptContext(input),
  });
  let threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
    state: "running",
    lastPrompt: displayPrompt,
    lastError: undefined,
    title: maybeReplaceDefaultTitle(input.threads.get(activeThreadId)?.title, displayPrompt),
    ...runtimeMetadataFromOptions(input.runOptions),
  });
  sendSse(input.controller, input.encoder, input.secureSession, {
    type: "thread.message.created",
    thread: threadSummary,
    message: userMessage,
  });
  sendSse(input.controller, input.encoder, input.secureSession, {
    type: "thread.state.changed",
    thread: threadSummary,
  });
  debugStream("initial event sent", activeThreadId);

  const cleanupRequestHandler = input.appServer.onRequest((request) => {
    if (!isApprovalServerRequest(request.method)) {
      void input.appServer.rejectRequest(
        request.id,
        -32601,
        `${request.method} is not supported by Codex Relay mobile yet.`,
      );
      return;
    }

    const approval = approvalMessageFromRequest(request);
    if (!approval || approval.threadId !== activeThreadId) {
      void input.appServer.rejectRequest(request.id, -32602, "Approval request is malformed.");
      return;
    }

    if (approval.kind === "structuredUserInput") {
      const pending = {
        appServer: input.appServer,
        kind: approval.kind,
        method: request.method,
        questions: approval.questions,
        requestId: request.id,
        threadId: activeThreadId,
        turnId: approval.turnId,
      } satisfies PendingApproval;
      input.pendingApprovals.set(approval.approvalId, pending);
      threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
        state: "running",
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.input_request.created",
        thread: threadSummary,
        request: pendingInputRequestFromApproval(approval, activeThreadId),
      });
      return;
    }

    const message = appendMessage(input.messagesByThreadId, activeThreadId, {
      role: "status",
      kind: "approvalRequest",
      content: approval.content,
      details: approval.details,
      state: "completed",
      turnId: approval.turnId,
    });
    input.pendingApprovals.set(approval.approvalId, {
      appServer: input.appServer,
      kind: approval.kind,
      messageId: message.id,
      method: request.method,
      requestId: request.id,
      threadId: activeThreadId,
    });
    threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "running",
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.message.created",
      thread: threadSummary,
      message,
    });
  });

  let cleanupNotificationHandler = (): void => undefined;
  const completed = new Promise<void>((resolve, reject) => {
    cleanupNotificationHandler = input.appServer.onNotification((notification) => {
      const params = recordParams(notification);
      const threadId = firstString(params, ["threadId"]);
      if (threadId && threadId !== activeThreadId) {
        return;
      }

      try {
        switch (notification.method) {
          case "thread/status/changed": {
            const status = params?.status;
            const state = mapAppServerThreadState(status);
            if (state !== "running") {
              return;
            }
            threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
              state,
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.state.changed",
              thread: threadSummary,
            });
            return;
          }
          case "turn/started":
            activeTurnId = firstString(params, ["turnId"]) ?? turnIdFromParams(params);
            if (activeTurnId) {
              input.activeAppServerTurnIdsByThreadId.set(activeThreadId, activeTurnId);
            }
            return;
          case "item/started":
          case "item/completed": {
            const item = params?.item;
            if (!item || typeof item !== "object") {
              return;
            }
            const canonicalUserMessage = replaceDuplicateInitialUserMessage(
              input.messagesByThreadId,
              activeThreadId,
              firstString(params, ["turnId"]) ?? activeTurnId,
              item as AppServerThreadItem,
              userMessage.id,
              displayPrompt,
            );
            if (canonicalUserMessage) {
              userMessage = canonicalUserMessage;
              return;
            }
            const turnId = firstString(params, ["turnId"]) ?? activeTurnId;
            const message = upsertAppServerItemMessage(
              input.messagesByThreadId,
              activeThreadId,
              turnId,
              item as AppServerThreadItem,
            );
            if (!message) {
              return;
            }
            producedTurnOutput = true;
            if (message.role === "assistant") {
              assistantMessageId = message.id;
            }
            threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
              state: "running",
              lastResult: message.role === "assistant" ? message.content : undefined,
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type:
                notification.method === "item/completed" && message.role === "assistant"
                  ? "thread.message.completed"
                  : "thread.message.created",
              thread: threadSummary,
              message,
            });
            return;
          }
          case "item/agentMessage/delta": {
            const itemId = firstString(params, ["itemId"]);
            const delta = firstString(params, ["delta"]);
            if (!itemId || !delta) {
              return;
            }
            if (!input.messagesByThreadId.get(activeThreadId)?.some((item) => item.id === itemId)) {
              appendMessageWithId(input.messagesByThreadId, activeThreadId, itemId, {
                role: "assistant",
                content: "",
                state: "streaming",
                turnId: firstString(params, ["turnId"]) ?? activeTurnId,
              });
            }
            assistantMessageId = itemId;
            const patch = appendMessageDelta(
              input.messagesByThreadId,
              activeThreadId,
              itemId,
              delta,
            );
            const message = patch.message;
            producedTurnOutput = true;
            updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
              state: "running",
              lastResult: message.content,
            });
            if (patch.delta) {
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.message.delta",
                threadId: activeThreadId,
                messageId: itemId,
                delta: patch.delta,
              });
            }
            return;
          }
          case "turn/plan/updated": {
            const content = planContentFromRecord(params);
            const message = appendMessage(input.messagesByThreadId, activeThreadId, {
              role: "status",
              kind: "plan",
              content: content || "Plan updated",
              details: planDetailsFromRecord(params),
              state: "completed",
              turnId: firstString(params, ["turnId"]) ?? activeTurnId,
            });
            producedTurnOutput = true;
            threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
              state: "running",
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.message.created",
              thread: threadSummary,
              message,
            });
            return;
          }
          case "turn/aborted":
          case "turn/cancelled":
          case "turn/completed":
          case "turn/failed": {
            const state = terminalTurnState(notification.method, params);
            relayDebugLog("app_server.turn.terminal", {
              method: notification.method,
              state,
              threadId: activeThreadId,
              turnId: firstString(params, ["turnId"]) ?? activeTurnId,
            });
            input.activeAppServerTurnIdsByThreadId.delete(activeThreadId);
            if (assistantMessageId) {
              const completedMessage = updateMessage(
                input.messagesByThreadId,
                activeThreadId,
                assistantMessageId,
                { state: "completed" },
              );
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.message.completed",
                thread: threadSummary,
                message: completedMessage,
              });
            }
            const lastError = state === "failed" ? turnErrorMessage(params) : undefined;
            const nextQueuedInput =
              state === "completed"
                ? shiftQueuedInput(input.queuedInputsByThreadId, activeThreadId)
                : undefined;
            threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
              state: nextQueuedInput ? "running" : state,
              lastError: nextQueuedInput ? undefined : lastError,
              ...(nextQueuedInput
                ? {
                    lastPrompt: promptWithAttachmentReferences(
                      nextQueuedInput.prompt,
                      nextQueuedInput.attachments,
                    ),
                    ...runtimeMetadataFromOptions(nextQueuedInput.runOptions),
                  }
                : {}),
            });
            sendSse(input.controller, input.encoder, input.secureSession, {
              type: "thread.state.changed",
              thread: threadSummary,
            });
            if (state === "failed") {
              const errorBody = apiError(
                "codex_run_failed",
                lastError ?? "Codex turn did not complete.",
              );
              appendMessage(input.messagesByThreadId, activeThreadId, {
                role: "error",
                content: errorBody.error.message,
                state: "failed",
                turnId: activeTurnId,
              });
              sendSse(input.controller, input.encoder, input.secureSession, {
                type: "thread.error",
                thread: threadSummary,
                error: errorBody.error,
              });
              input.steeringThreads.delete(activeThreadId);
              cleanupNotificationHandler();
              resolve();
              return;
            }
            if (nextQueuedInput) {
              handedOffToQueuedTurn = true;
              assistantMessageId = undefined;
              input.steeringThreads.add(activeThreadId);
              void startAppServerTurn(input.appServer, activeThreadId, nextQueuedInput)
                .then((turn) => {
                  activeTurnId = turn.id;
                  input.activeAppServerTurnIdsByThreadId.set(activeThreadId, activeTurnId);
                })
                .catch((error: unknown) => {
                  cleanupNotificationHandler();
                  reject(error);
                });
              return;
            }
            input.steeringThreads.delete(activeThreadId);
            cleanupNotificationHandler();
            resolve();
            return;
          }
        }
      } catch (error) {
        cleanupNotificationHandler();
        reject(error);
      }
    });
  });

  try {
    const isFirstLocalMessage = (input.messagesByThreadId.get(activeThreadId) ?? []).every(
      (message) => message.id === userMessage.id,
    );
    debugStream(
      `wait idle gate first=${isFirstLocalMessage ? "1" : "0"} active=${activeTurnId ?? "none"}`,
      activeThreadId,
    );
    if (activeTurnId) {
      debugStream("wait idle begin", activeThreadId);
      await waitForAppServerThreadIdle({
        appServer: input.appServer,
        onWaiting() {
          if (waitingForActiveTurnMessageId) {
            return;
          }
          const message = appendMessage(input.messagesByThreadId, activeThreadId, {
            role: "status",
            content: "Waiting for the current Codex turn to finish.",
            state: "streaming",
          });
          waitingForActiveTurnMessageId = message.id;
          threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
            state: "running",
          });
          sendSse(input.controller, input.encoder, input.secureSession, {
            type: "thread.message.created",
            thread: threadSummary,
            message,
          });
        },
        onWaitingHeartbeat() {
          threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
            state: "running",
          });
          sendSse(input.controller, input.encoder, input.secureSession, {
            type: "thread.state.changed",
            thread: threadSummary,
          });
        },
        threadId: activeThreadId,
      });
      debugStream("wait idle complete", activeThreadId);
    }
    if (waitingForActiveTurnMessageId) {
      const message = updateMessage(
        input.messagesByThreadId,
        activeThreadId,
        waitingForActiveTurnMessageId,
        { content: "Current Codex turn finished. Starting your reply.", state: "completed" },
      );
      threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
        state: "running",
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.message.created",
        thread: threadSummary,
        message,
      });
    }
    debugStream("start turn begin", activeThreadId);
    let turn: AppServerTurn;
    try {
      turn = await startAppServerTurn(input.appServer, activeThreadId, {
        attachments: input.attachments,
        id: randomUUID(),
        prompt,
        runOptions: input.runOptions,
        skills: input.skills,
        workspacePath: input.workspacePath,
      });
    } catch (error) {
      if (!isAppServerThreadNotFound(error)) {
        throw error;
      }
      if (
        !canRecoverMissingAppServerThread({
          messagesByThreadId: input.messagesByThreadId,
          threadId: activeThreadId,
          userMessageId: userMessage.id,
        })
      ) {
        throw error;
      }

      debugStream("recover missing thread begin", activeThreadId);
      const recovered = await recoverMissingAppServerThread({
        appServer: input.appServer,
        messagesByThreadId: input.messagesByThreadId,
        prompt,
        runOptions: input.runOptions,
        threadId: activeThreadId,
        threads: input.threads,
        userMessageId: userMessage.id,
        workspacePath: input.workspacePath,
      });
      activeThreadId = recovered.threadId;
      userMessage = recovered.userMessage;
      threadSummary = recovered.threadSummary;
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.message.created",
        thread: threadSummary,
        message: userMessage,
      });
      turn = await startAppServerTurn(input.appServer, activeThreadId, {
        attachments: input.attachments,
        id: randomUUID(),
        prompt,
        runOptions: input.runOptions,
        skills: input.skills,
        workspacePath: input.workspacePath,
      });
    }
    activeTurnId = turn.id;
    input.activeAppServerTurnIdsByThreadId.set(activeThreadId, activeTurnId);
    debugStream("start turn complete", activeThreadId, activeTurnId);
    let streamedReturnedItem = false;
    for (const item of turn.items) {
      const canonicalUserMessage = replaceDuplicateInitialUserMessage(
        input.messagesByThreadId,
        activeThreadId,
        activeTurnId,
        item,
        userMessage.id,
        displayPrompt,
      );
      if (canonicalUserMessage) {
        userMessage = canonicalUserMessage;
        continue;
      }
      const message = upsertAppServerItemMessage(
        input.messagesByThreadId,
        activeThreadId,
        activeTurnId,
        item,
      );
      if (!message) {
        continue;
      }
      streamedReturnedItem = true;
      producedTurnOutput = true;
      if (message.role === "assistant") {
        assistantMessageId = message.id;
      }
      threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
        state: "running",
        lastResult: message.role === "assistant" ? message.content : undefined,
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: message.role === "assistant" ? "thread.message.completed" : "thread.message.created",
        thread: threadSummary,
        message,
      });
    }
    const returnedState = mapAppServerThreadState(turn.status);
    if (returnedState !== "running") {
      if (!streamedReturnedItem && !producedTurnOutput) {
        sendEmptyAppServerTurnError({
          activeTurnId,
          controller: input.controller,
          encoder: input.encoder,
          messagesByThreadId: input.messagesByThreadId,
          secureSession: input.secureSession,
          threadId: activeThreadId,
          threads: input.threads,
        });
        input.steeringThreads.delete(activeThreadId);
        cleanupNotificationHandler();
        return;
      }
      threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
        state: returnedState,
      });
      sendSse(input.controller, input.encoder, input.secureSession, {
        type: "thread.state.changed",
        thread: threadSummary,
      });
      input.steeringThreads.delete(activeThreadId);
      cleanupNotificationHandler();
      return;
    }
    await completed;
  } catch (error) {
    debugStream(`failed ${errorMessage(error)}`, activeThreadId, activeTurnId);
    const threadSummary = updateThread(input.threads, input.messagesByThreadId, activeThreadId, {
      state: "failed",
      lastError: errorMessage(error),
    });
    const errorBody = apiError("codex_run_failed", threadSummary.lastError ?? "Codex run failed.");
    appendMessage(input.messagesByThreadId, activeThreadId, {
      role: "error",
      content: errorBody.error.message,
      state: "failed",
    });
    sendSse(input.controller, input.encoder, input.secureSession, {
      type: "thread.error",
      thread: threadSummary,
      error: errorBody.error,
    });
  } finally {
    cleanupRequestHandler();
    if (!handedOffToQueuedTurn) {
      input.activeAppServerTurnIdsByThreadId.delete(activeThreadId);
      input.steeringThreads.delete(activeThreadId);
    }
    closeSseController(input.controller);
  }
}

function sendEmptyAppServerTurnError(input: {
  activeTurnId: string | undefined;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  messagesByThreadId: Map<string, ChatMessage[]>;
  secureSession?: SecureSessionHandle;
  threadId: string;
  threads: Map<string, ThreadMetadata>;
}) {
  const message = appendMessage(input.messagesByThreadId, input.threadId, {
    role: "error",
    content: "Codex finished this turn without returning a plan or response.",
    state: "failed",
    turnId: input.activeTurnId,
  });
  const threadSummary = updateThread(input.threads, input.messagesByThreadId, input.threadId, {
    state: "failed",
    lastError: message.content,
  });
  sendSse(input.controller, input.encoder, input.secureSession, {
    type: "thread.message.created",
    thread: threadSummary,
    message,
  });
  sendSse(input.controller, input.encoder, input.secureSession, {
    type: "thread.error",
    thread: threadSummary,
    error: apiError("codex_empty_response", message.content).error,
  });
}

function debugStream(message: string, threadId: string, turnId?: string) {
  relayDebugLog("thread.stream.debug", { message, threadId, turnId });
}

function debugReason(reason: unknown) {
  if (reason instanceof Error) {
    return { message: reason.message, name: reason.name };
  }
  if (typeof reason === "string") {
    return reason;
  }
  if (reason === undefined || reason === null) {
    return reason;
  }
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

async function waitForAppServerThreadIdle(input: {
  appServer: CodexAppServerClient;
  onWaiting: () => void;
  onWaitingHeartbeat: () => void;
  threadId: string;
}) {
  if (typeof input.appServer.readThread !== "function") {
    return;
  }

  const waitStartedAt = Date.now();
  let hasWaited = false;
  for (;;) {
    let thread: AppServerThread | undefined;
    try {
      thread = await input.appServer.readThread(input.threadId, { includeTurns: false });
    } catch (error) {
      if (isUnmaterializedAppServerThreadError(error)) {
        return;
      }
      throw error;
    }
    if (!thread) {
      return;
    }
    if (mapAppServerThreadState(thread.status) !== "running") {
      return;
    }

    if (hasWaited) {
      input.onWaitingHeartbeat();
    } else {
      input.onWaiting();
      hasWaited = true;
    }

    if (Date.now() - waitStartedAt > 10 * 60 * 1000) {
      throw new Error("Timed out waiting for the current Codex turn to finish.");
    }

    await delay(1500);
  }
}

function isUnmaterializedAppServerThreadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not materialized yet") ||
    message.includes("includeTurns is unavailable before first user message")
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function recoverMissingAppServerThread(input: {
  appServer: CodexAppServerClient;
  messagesByThreadId: Map<string, ChatMessage[]>;
  prompt: string;
  runOptions: {
    approvalPolicy?: string;
    model?: string;
    serviceTier?: string;
    reasoningEffort?: string;
    runtimeMode?: RuntimeMode;
    sandboxMode?: string;
  };
  threadId: string;
  threads: Map<string, ThreadMetadata>;
  userMessageId: string;
  workspacePath: string;
}) {
  const previousThread = input.threads.get(input.threadId);
  const previousMessages = input.messagesByThreadId.get(input.threadId) ?? [];
  const runtime = resolveAppServerRuntime(input.runOptions, input.workspacePath);
  const thread = await input.appServer.startThread({
    approvalPolicy: runtime.approvalPolicy,
    cwd: input.workspacePath,
    experimentalRawEvents: false,
    model: input.runOptions.model ?? null,
    persistExtendedHistory: true,
    sandbox: runtime.sandbox,
    serviceTier: input.runOptions.serviceTier ?? null,
  });
  const recoveredThread = mapAppServerThread({
    ...thread,
    name:
      maybeReplaceDefaultTitle(previousThread?.title, input.prompt) ??
      previousThread?.title ??
      thread.name,
    preview: input.prompt,
  });
  input.threads.delete(input.threadId);
  input.messagesByThreadId.delete(input.threadId);
  input.threads.set(thread.id, {
    ...recoveredThread,
    state: "running",
    lastPrompt: input.prompt,
    lastError: undefined,
    ...runtimeMetadataFromOptions(input.runOptions),
  });
  const recoveredMessages = previousMessages.map((message) => ({
    ...message,
    threadId: thread.id,
  }));
  input.messagesByThreadId.set(thread.id, recoveredMessages);

  const userMessage =
    recoveredMessages.find((message) => message.id === input.userMessageId) ??
    appendMessage(input.messagesByThreadId, thread.id, {
      role: "user",
      content: input.prompt,
    });
  const threadSummary = updateThread(input.threads, input.messagesByThreadId, thread.id, {
    state: "running",
    lastPrompt: input.prompt,
    lastError: undefined,
    ...runtimeMetadataFromOptions(input.runOptions),
  });

  return { threadId: thread.id, threadSummary, userMessage };
}

function isAppServerThreadNotFound(error: unknown) {
  return errorMessage(error).toLowerCase().includes("thread not found");
}

function canRecoverMissingAppServerThread(input: {
  messagesByThreadId: Map<string, ChatMessage[]>;
  threadId: string;
  userMessageId: string;
}) {
  const messages = input.messagesByThreadId.get(input.threadId) ?? [];
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return latestUserMessage?.id === input.userMessageId;
}

async function parseRequestJson<T extends z.ZodType>(
  c: { req: { header: (name: string) => string | undefined; raw: Request } },
  pairing: PairingOptions | undefined,
  secureSessionsByTokenHash: Map<string, SecureSession>,
  schema: T,
) {
  let payload: unknown;
  try {
    payload = await c.req.raw.json();
  } catch {
    payload = {};
  }

  const secureSession = getSecureSessionForRequest(c, pairing, secureSessionsByTokenHash);
  if (secureSession) {
    const envelope = EncryptedPayloadSchema.safeParse(payload);
    if (!envelope.success) {
      return schema.safeParse({ __invalidEncryptedPayload: true });
    }

    try {
      payload = JSON.parse(decryptFromMobile(secureSession.session, envelope.data));
      await secureSession.persist();
    } catch {
      payload = { __invalidEncryptedPayload: true };
    }
  }

  return schema.safeParse(payload);
}

async function parsePlainJson<T extends z.ZodType>(request: Request, schema: T) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  return schema.safeParse(payload);
}

async function secureJson(
  c: {
    json: (payload: unknown, status?: number) => Response;
    req: { header: (name: string) => string | undefined };
  },
  pairing: PairingOptions | undefined,
  secureSessionsByTokenHash: Map<string, SecureSession>,
  payload: unknown,
  status?: number,
) {
  const secureSession = getSecureSessionForRequest(c, pairing, secureSessionsByTokenHash);
  if (!secureSession) {
    return c.json(payload, status);
  }

  const encrypted = EncryptedPayloadSchema.parse(
    encryptForMobile(secureSession.session, JSON.stringify(payload)),
  );
  await secureSession.persist();
  return c.json(encrypted, status);
}

function getSecureSessionForRequest(
  c: { req: { header: (name: string) => string | undefined } },
  pairing: PairingOptions | undefined,
  secureSessionsByTokenHash: Map<string, SecureSession>,
) {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token || !pairing) {
    return undefined;
  }

  const tokenHash = pairing.hashClientToken(token);
  const session = secureSessionsByTokenHash.get(tokenHash);
  return session ? createSecureSessionHandle(pairing, tokenHash, session) : undefined;
}

function createSecureSessionHandle(
  pairing: PairingOptions,
  tokenHash: string,
  session: SecureSession,
): SecureSessionHandle {
  let pendingPersist = Promise.resolve();
  return {
    persist: () => {
      pendingPersist = pendingPersist
        .catch(() => undefined)
        .then(() => pairing.sessions.updateSecureSession(tokenHash, session));
      return pendingPersist;
    },
    session,
    tokenHash,
  };
}

function sortedThreads(threads: Map<string, ThreadMetadata>) {
  return [...threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function ensureKnownThread(input: {
  appServer: CodexAppServerClient | null;
  messagesByThreadId: Map<string, ChatMessage[]>;
  threadId: string;
  threads: Map<string, ThreadMetadata>;
}) {
  const knownThread = input.threads.get(input.threadId);
  if (knownThread) {
    return knownThread;
  }

  if (!input.appServer) {
    return undefined;
  }

  try {
    const appServerThread = await input.appServer.readThread(input.threadId, {
      includeTurns: false,
    });
    const thread = rememberAppServerThread(input.threads, appServerThread);
    return thread;
  } catch {
    return undefined;
  }
}

function appendMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  input: Pick<ChatMessage, "role" | "content"> &
    Partial<Pick<ChatMessage, "details" | "kind" | "state" | "turnId">>,
) {
  const now = new Date().toISOString();
  const message = ChatMessageSchema.parse({
    id: `msg-${crypto.randomUUID()}`,
    threadId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    details: input.details,
    createdAt: now,
    updatedAt: now,
    state: input.state,
    turnId: input.turnId,
  });
  const messages = messagesByThreadId.get(threadId) ?? [];
  messages.push(message);
  messagesByThreadId.set(threadId, messages);
  return message;
}

function appendMessageWithId(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  id: string,
  input: Pick<ChatMessage, "role" | "content"> &
    Partial<Pick<ChatMessage, "details" | "kind" | "state" | "turnId">>,
) {
  const now = new Date().toISOString();
  const message = ChatMessageSchema.parse({
    id,
    threadId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    details: input.details,
    createdAt: now,
    updatedAt: now,
    state: input.state,
    turnId: input.turnId,
  });
  const messages = messagesByThreadId.get(threadId) ?? [];
  messages.push(message);
  messagesByThreadId.set(threadId, messages);
  return message;
}

function upsertAppServerItemMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  turnId: string | undefined,
  item: AppServerThreadItem,
) {
  const message = mapAppServerItem(threadId, appServerTurnShell(turnId), item);
  if (!message) {
    return undefined;
  }

  const existing = messagesByThreadId.get(threadId)?.some((candidate) => candidate.id === item.id);
  if (existing) {
    return updateMessage(messagesByThreadId, threadId, item.id, message);
  }

  return appendMessageWithId(messagesByThreadId, threadId, item.id, {
    role: message.role,
    kind: message.kind,
    content: message.content,
    details: message.details,
    state: message.state,
    turnId: message.turnId,
  });
}

function replaceDuplicateInitialUserMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  turnId: string | undefined,
  item: AppServerThreadItem,
  localMessageId: string,
  prompt: string,
) {
  if (!isDuplicateInitialUserMessage(messagesByThreadId, threadId, item, localMessageId, prompt)) {
    return undefined;
  }
  const message = mapAppServerItem(threadId, appServerTurnShell(turnId), item);
  if (!message) {
    return undefined;
  }
  return replaceMessage(
    messagesByThreadId,
    threadId,
    localMessageId,
    messageWithReplacementDetail(message, localMessageId),
  );
}

function isDuplicateInitialUserMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  item: AppServerThreadItem,
  localMessageId: string,
  prompt: string,
) {
  if (item.type !== "userMessage" || !("content" in item) || !Array.isArray(item.content)) {
    return false;
  }

  const localMessage = messagesByThreadId
    .get(threadId)
    ?.find((message) => message.id === localMessageId);
  const skills = appServerUserMessageSkills(item);
  const normalizeContent = (content: string) =>
    stripPromptSkillMentions(normalizeImageMessageContent(content), skills);
  const normalizedPrompt = normalizeContent(prompt);
  return (
    normalizeContent(localMessage?.content ?? "") === normalizedPrompt &&
    normalizeContent(appServerUserMessageText(item)) === normalizedPrompt
  );
}

function messageWithReplacementDetail(message: ChatMessage, replacesMessageId: string) {
  return ChatMessageSchema.parse({
    ...message,
    details: {
      ...message.details,
      replacesMessageId,
    },
  });
}

function appServerUserMessageText(item: Extract<AppServerThreadItem, { type: "userMessage" }>) {
  const skills = appServerUserMessageSkills(item);
  const text = item.content
    .map((content) => {
      switch (content.type) {
        case "text":
          return content.text;
        case "image":
        case "localImage":
        case "document":
        case "file":
        case "localFile":
        case "mention":
        case "skill":
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
  return promptMarkdownWithSkills(promptWithAppServerImageReferences(text, item.content), skills);
}

function appServerUserMessageDetails(item: Extract<AppServerThreadItem, { type: "userMessage" }>) {
  const attachments: AppServerUserAttachmentDetail[] = item.content.flatMap(
    (content): AppServerUserAttachmentDetail[] => {
      switch (content.type) {
        case "image":
          if (content.url.startsWith("data:image/")) {
            const materialized = materializeDataUriImage(content.url);
            return materialized ? [materialized] : [];
          }
          return [
            {
              url: content.url,
              type: "image" as const,
            },
          ];
        case "localImage":
          return localImageAttachmentDetails(content.path);
        case "document":
        case "file":
        case "localFile":
          return appServerDocumentAttachmentDetails(content);
        default:
          return [];
      }
    },
  );
  return attachments.length > 0 ? { attachments } : undefined;
}

type AppServerUserAttachmentDetail = {
  mimeType?: string;
  name?: string;
  path?: string;
  type: "document" | "image";
  url?: string;
};

function appServerAgentMessageParts(item: Extract<AppServerThreadItem, { type: "agentMessage" }>) {
  return agentMessageParts(item.text);
}

function agentMessageParts(text: string) {
  const imageReferences = localMarkdownImageReferences(text);
  if (imageReferences.length === 0) {
    return {
      content: text,
      details: undefined,
    };
  }

  const materializedReferences = new Set<string>();
  const attachments = imageReferences.flatMap((reference) => {
    const name =
      reference.alt || basename(localImageFilePath(reference.destination) ?? reference.destination);
    const details = localImageAttachmentDetails(reference.destination, name);
    if (details.length > 0) {
      materializedReferences.add(reference.destination);
    }
    return details;
  });

  return {
    content:
      attachments.length > 0 ? stripMaterializedMarkdownImages(text, materializedReferences) : text,
    details: attachments.length > 0 ? { attachments } : undefined,
  };
}

function localMarkdownImageReferences(markdown: string) {
  const references: Array<{ alt: string; destination: string }> = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(LOCAL_MARKDOWN_IMAGE_PATTERN)) {
    const destination = markdownImageDestination(match[2] ?? "");
    if (!destination || seen.has(destination) || !isLocalMarkdownImageReference(destination)) {
      continue;
    }
    seen.add(destination);
    references.push({
      alt: (match[1] ?? "").trim(),
      destination,
    });
  }
  return references;
}

function stripMaterializedMarkdownImages(markdown: string, destinations: Set<string>) {
  return markdown
    .replace(LOCAL_MARKDOWN_IMAGE_PATTERN, (match, _alt: string, rawDestination: string) => {
      const destination = markdownImageDestination(rawDestination);
      return destination && destinations.has(destination) ? "" : match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownImageDestination(value: string) {
  let destination = value.trim();
  if (destination.startsWith("<")) {
    const endIndex = destination.indexOf(">");
    if (endIndex > 0) {
      destination = destination.slice(1, endIndex);
    }
  } else {
    const titleIndex = destination.search(/\s+["']/);
    if (titleIndex > 0) {
      destination = destination.slice(0, titleIndex);
    }
  }

  try {
    return decodeURI(destination);
  } catch {
    return destination;
  }
}

function isLocalMarkdownImageReference(reference: string) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) && !reference.startsWith("file://")) {
    return false;
  }
  const filePath = localImageFilePath(reference);
  return Boolean(filePath && LOCAL_IMAGE_REFERENCE_PATTERN.test(filePath));
}

function appServerDocumentAttachmentDetails(
  input: Extract<AppServerUserInput, { type: "document" | "file" | "localFile" }>,
): AppServerUserAttachmentDetail[] {
  const reference = input.path ?? input.url;
  if (!reference) {
    return [];
  }

  return [
    {
      mimeType: input.mimeType,
      name: input.name ?? basename(reference),
      path: input.path,
      type: "document" as const,
      url: input.url,
    },
  ];
}

async function saveUploadedImageAttachment(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`Unsupported attachment type: ${file.type || "unknown"}`);
  }
  if (file.size > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Image ${file.name || "attachment"} is too large.`);
  }
  if (file.size === 0) {
    throw new Error(`Image ${file.name || "attachment"} is empty.`);
  }

  const attachmentId = `${Date.now()}-${randomUUID()}${imageExtension(file.name, file.type)}`;
  const filePath = resolve(imageAttachmentDirectory, attachmentId);
  await mkdir(imageAttachmentDirectory, { recursive: true });
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  return {
    mimeType: file.type,
    name: file.name || attachmentId,
    path: filePath,
    type: "image" as const,
    url: imageAttachmentUrl(attachmentId, filePath),
  };
}

function isUploadedFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    "size" in value &&
    typeof (value as { size?: unknown }).size === "number" &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function localImageAttachmentDetails(path: string, name = basename(path)) {
  const uploadedUrl = uploadedImageUrlForPath(path);
  if (uploadedUrl) {
    return [
      {
        mimeType: imageMimeType(path),
        name,
        path,
        type: "image" as const,
        url: uploadedUrl,
      },
    ];
  }

  const materialized = materializeLocalImageFile(path, name);
  return materialized ? [materialized] : [];
}

function materializeDataUriImage(dataUri: string, name = "image.png") {
  const parsed = /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/.exec(dataUri);
  if (!parsed) {
    return undefined;
  }

  const mimeType = parsed[1];
  const base64 = parsed[2].replace(/\s/g, "");
  const attachmentId = `${createHash("sha256").update(base64).digest("hex").slice(0, 24)}${imageExtension(name, mimeType)}`;
  const filePath = resolve(imageAttachmentDirectory, attachmentId);
  if (!existsSync(filePath)) {
    mkdirSync(imageAttachmentDirectory, { recursive: true });
    writeFileSync(filePath, Buffer.from(base64, "base64"));
  }
  return {
    mimeType,
    name,
    path: filePath,
    type: "image" as const,
    url: imageAttachmentUrl(attachmentId, filePath),
  };
}

function materializeLocalImageFile(path: string, name = basename(path)) {
  const filePath = localImageFilePath(path);
  if (!filePath || !existsSync(filePath)) {
    return undefined;
  }
  const fileStat = statSync(filePath);
  if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > IMAGE_ATTACHMENT_MAX_BYTES) {
    return undefined;
  }

  const buffer = readFileSync(filePath);
  const mimeType = imageMimeType(filePath);
  const attachmentId = `${createHash("sha256").update(buffer).digest("hex").slice(0, 24)}${imageExtension(name, mimeType)}`;
  const uploadedPath = resolve(imageAttachmentDirectory, attachmentId);
  if (!existsSync(uploadedPath)) {
    mkdirSync(imageAttachmentDirectory, { recursive: true });
    writeFileSync(uploadedPath, buffer);
  }
  return {
    mimeType,
    name,
    path: uploadedPath,
    type: "image" as const,
    url: imageAttachmentUrl(attachmentId, uploadedPath),
  };
}

function uploadedImagePathFromId(attachmentId: string) {
  const safeAttachmentId = basename(attachmentId);
  if (
    attachmentId !== safeAttachmentId ||
    !/^[A-Za-z0-9._-]+\.(gif|heic|heif|jpe?g|png|webp)$/i.test(attachmentId)
  ) {
    return undefined;
  }
  return resolve(imageAttachmentDirectory, safeAttachmentId);
}

function uploadedImageUrlForPath(path: string) {
  const filePath = localImageFilePath(path);
  if (!filePath) {
    return undefined;
  }
  const attachmentId = relative(resolve(imageAttachmentDirectory), resolve(filePath));
  if (
    !attachmentId ||
    attachmentId.startsWith("..") ||
    attachmentId.includes("/") ||
    attachmentId.includes("\\")
  ) {
    return undefined;
  }
  return imageAttachmentUrl(attachmentId, filePath);
}

function imageAttachmentUrl(attachmentId: string, filePath: string) {
  const version = existsSync(filePath) ? String(Math.trunc(statSync(filePath).mtimeMs)) : "0";
  return `${apiPaths.imageAttachment(attachmentId)}?v=${encodeURIComponent(version)}`;
}

function imageExtension(name: string | undefined, mimeType: string | undefined) {
  const extension = extname(name ?? "").toLowerCase();
  if ([".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)) {
    return extension;
  }
  switch (mimeType) {
    case "image/gif":
      return ".gif";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/jpeg":
    default:
      return ".jpg";
  }
}

function localImageFilePath(path: string) {
  if (path.startsWith("file://")) {
    try {
      return fileURLToPath(path);
    } catch {
      return undefined;
    }
  }
  return resolve(path);
}

function imageMimeType(path: string) {
  const dataUriMimeType = path.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/);
  if (dataUriMimeType?.[1]) {
    return dataUriMimeType[1];
  }

  switch (extname(path).toLowerCase()) {
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
    default:
      return "image/png";
  }
}

function appServerUserMessageSkills(item: Extract<AppServerThreadItem, { type: "userMessage" }>) {
  return item.content.filter(isAppServerSkillInput).map(({ name, path }) => ({
    name,
    path,
  }));
}

function isAppServerSkillInput(
  input: AppServerUserInput,
): input is Extract<AppServerUserInput, { type: "skill" }> {
  return input.type === "skill";
}

function appendMessageDelta(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  messageId: string,
  delta: string,
) {
  const existing = messagesByThreadId.get(threadId)?.find((message) => message.id === messageId);
  const normalizedDelta = normalizeStreamDelta(existing?.content ?? "", delta);
  const message = updateMessage(messagesByThreadId, threadId, messageId, {
    content: `${existing?.content ?? ""}${normalizedDelta}`,
    state: "streaming",
  });
  return { delta: normalizedDelta, message };
}

function normalizeStreamDelta(existingContent: string, incomingDelta: string) {
  if (!existingContent || !incomingDelta.startsWith(existingContent)) {
    return incomingDelta;
  }
  return incomingDelta.slice(existingContent.length);
}

function markApprovalMessageResolved(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  messageId: string,
  decision: string,
) {
  const messages = messagesByThreadId.get(threadId) ?? [];
  const message = messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    return;
  }

  updateMessage(messagesByThreadId, threadId, messageId, {
    details: {
      ...message.details,
      approvalDecision: decision,
      approvalResolved: true,
    },
  });
}

function trimResolvedApprovals(resolvedApprovals: Map<string, ResolvedApproval>) {
  while (resolvedApprovals.size > maxResolvedApprovals) {
    const oldestApprovalId = resolvedApprovals.keys().next().value;
    if (!oldestApprovalId) {
      return;
    }
    resolvedApprovals.delete(oldestApprovalId);
  }
}

function updateMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  messageId: string,
  update: Partial<ChatMessage>,
) {
  const messages = messagesByThreadId.get(threadId) ?? [];
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw new Error(`Unknown message: ${messageId}`);
  }

  const next = ChatMessageSchema.parse({
    ...messages[index],
    ...update,
    updatedAt: new Date().toISOString(),
  });
  messages[index] = next;
  return next;
}

function replaceMessage(
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  messageId: string,
  replacement: ChatMessage,
) {
  const messages = messagesByThreadId.get(threadId) ?? [];
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw new Error(`Unknown message: ${messageId}`);
  }

  const next = ChatMessageSchema.parse({
    ...replacement,
    updatedAt: new Date().toISOString(),
  });
  messages[index] = next;
  return next;
}

function replaceLocalThreadId(
  threads: Map<string, ThreadMetadata>,
  messagesByThreadId: Map<string, ChatMessage[]>,
  liveThreads: Map<string, ReturnType<CodexClient["startThread"]>>,
  currentThreadId: string,
  sdkThreadId: string | undefined,
) {
  if (!sdkThreadId || sdkThreadId === currentThreadId) {
    return currentThreadId;
  }

  const metadata = threads.get(currentThreadId);
  const thread = liveThreads.get(currentThreadId);
  const messages = messagesByThreadId.get(currentThreadId) ?? [];
  if (!metadata) {
    return sdkThreadId;
  }

  threads.delete(currentThreadId);
  liveThreads.delete(currentThreadId);
  messagesByThreadId.delete(currentThreadId);
  threads.set(sdkThreadId, { ...metadata, id: sdkThreadId });
  messagesByThreadId.set(
    sdkThreadId,
    messages.map((message) => ({ ...message, threadId: sdkThreadId })),
  );
  if (thread) {
    liveThreads.set(sdkThreadId, thread);
  }

  return sdkThreadId;
}

function updateThread(
  threads: Map<string, ThreadMetadata>,
  messagesByThreadId: Map<string, ChatMessage[]>,
  threadId: string,
  update: Partial<ThreadMetadata>,
) {
  const existing = threads.get(threadId);
  if (!existing) {
    throw new Error(`Unknown thread: ${threadId}`);
  }

  const messages = messagesByThreadId.get(threadId) ?? [];
  const lastMessage = [...messages].reverse().find((message) => message.role !== "status");
  const next = ThreadSummarySchema.parse({
    ...existing,
    ...update,
    messageCount: messages.length,
    lastMessagePreview: lastMessage?.content
      ? preview(lastMessage.content)
      : existing.lastMessagePreview,
    lastActivityAt: lastMessage?.updatedAt ?? lastMessage?.createdAt ?? existing.lastActivityAt,
    updatedAt: new Date().toISOString(),
  });
  threads.set(threadId, next);
  return next;
}

function sendSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  secureSession: SecureSessionHandle | undefined,
  event: StreamThreadRunEvent,
) {
  const parsed = StreamThreadRunEventSchema.parse(event);
  const threadId = threadIdFromStreamEvent(parsed);
  relayDebugLog("thread.stream.sse", {
    direction: "server_to_mobile",
    eventType: parsed.type,
    threadId,
    payload: parsed,
  });
  const data = secureSession
    ? EncryptedPayloadSchema.parse(encryptForMobile(secureSession.session, JSON.stringify(parsed)))
    : parsed;
  if (secureSession) {
    void secureSession.persist().catch(() => undefined);
  }
  if (!enqueueSseChunk(controller, encoder.encode(`event: ${parsed.type}\n`))) {
    relayDebugLog("thread.stream.sse.enqueue_failed", {
      eventType: parsed.type,
      stage: "event",
      threadId,
    });
    return;
  }
  if (!enqueueSseChunk(controller, encoder.encode(`data: ${JSON.stringify(data)}\n\n`))) {
    relayDebugLog("thread.stream.sse.enqueue_failed", {
      eventType: parsed.type,
      stage: "data",
      threadId,
    });
  }
}

function sendTerminalOutputSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  secureSession: SecureSessionHandle | undefined,
  response: WorkspaceTerminalOutputResponse,
) {
  const parsed = WorkspaceTerminalOutputResponseSchema.parse(response);
  const data = secureSession
    ? EncryptedPayloadSchema.parse(encryptForMobile(secureSession.session, JSON.stringify(parsed)))
    : parsed;
  if (secureSession) {
    void secureSession.persist().catch(() => undefined);
  }
  if (!enqueueSseChunk(controller, encoder.encode("event: output\n"))) {
    return false;
  }
  return enqueueSseChunk(controller, encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function threadIdFromStreamEvent(event: StreamThreadRunEvent) {
  if ("threadId" in event && typeof event.threadId === "string") {
    return event.threadId;
  }
  if ("thread" in event && event.thread) {
    return event.thread.id;
  }
  return undefined;
}

function enqueueSseChunk(
  controller: ReadableStreamDefaultController<Uint8Array>,
  chunk: Uint8Array,
) {
  try {
    controller.enqueue(chunk);
    return true;
  } catch (error) {
    if (isClosedStreamControllerError(error)) {
      return false;
    }
    throw error;
  }
}

function closeSseController(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
    return true;
  } catch (error) {
    if (isClosedStreamControllerError(error)) {
      return false;
    }
    throw error;
  }
}

function closeActiveStreamControllers(
  controllers: Set<ReadableStreamDefaultController<Uint8Array>>,
) {
  for (const controller of controllers) {
    closeSseController(controller);
  }
  controllers.clear();
}

function isClosedStreamControllerError(error: unknown) {
  return (
    error instanceof TypeError &&
    (error as { code?: string }).code === "ERR_INVALID_STATE" &&
    error.message.includes("Controller is already closed")
  );
}

function startWebPreviewTargetMonitor({
  bridgeUrl,
  send,
}: {
  bridgeUrl: string;
  send: (target: WebPreviewTarget) => void;
}) {
  const urls = webPreviewCandidateUrls(bridgeUrl);
  const seenUrls = new Set<string>();
  let stopped = false;

  async function scan() {
    if (stopped) {
      return;
    }

    const targets = await detectWebPreviewTargets(urls);
    for (const target of targets) {
      if (stopped || seenUrls.has(target.url)) {
        continue;
      }

      seenUrls.add(target.url);
      try {
        send(target);
      } catch {
        stopped = true;
        return;
      }
    }
  }

  void scan();
  const interval = setInterval(() => void scan(), 1500);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function webPreviewCandidateUrls(bridgeUrl: string) {
  const bridge = new URL(bridgeUrl);
  const bridgePort = Number(bridge.port);
  return webPreviewCandidatePorts()
    .filter((port) => port !== bridgePort)
    .map((port) => {
      const url = new URL(bridge.toString());
      url.port = String(port);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    });
}

function webPreviewCandidatePorts() {
  const configured = process.env.CODEX_RELAY_WEB_PREVIEW_PORTS;
  if (!configured) {
    return defaultWebPreviewPorts;
  }

  const ports = configured
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  return ports.length > 0 ? ports : defaultWebPreviewPorts;
}

function readCollaborationModeTemplate(name: (typeof collaborationModeTemplateNames)[number]) {
  return readFileSync(new URL(`./collaboration-mode-templates/${name}.md`, import.meta.url), "utf8")
    .replaceAll("{{KNOWN_MODE_NAMES}}", knownCollaborationModeNames)
    .trim();
}

async function detectWebPreviewTargets(urls: string[]) {
  const targets = await Promise.all(urls.map((url) => probeWebPreviewTarget(url)));
  return targets.filter((target): target is WebPreviewTarget => Boolean(target));
}

async function probeWebPreviewTarget(url: string): Promise<WebPreviewTarget | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (!contentType.includes("text/html") && !looksLikeHtml(text)) {
      return undefined;
    }

    return {
      kind: "web",
      url,
      port: Number(new URL(url).port),
      label: webPreviewLabel(text),
      source: "detected-port",
      confidence: "high",
      detectedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeHtml(value: string) {
  return /^\s*(<!doctype html|<html[\s>])/i.test(value);
}

function webPreviewLabel(html: string) {
  if (html.includes("/@vite/client")) {
    return "Vite";
  }
  if (html.includes("__next")) {
    return "Next.js";
  }
  if (html.includes("expo-router") || html.includes("Expo")) {
    return "Expo";
  }
  return "Web preview";
}

function titleFromPrompt(prompt: string | undefined) {
  if (!prompt) {
    return undefined;
  }

  const firstLine = prompt.trim().split(/\r?\n/, 1)[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function maybeReplaceDefaultTitle(currentTitle: string | undefined, prompt: string) {
  return !currentTitle || currentTitle === "New Codex thread"
    ? titleFromPrompt(prompt)
    : currentTitle;
}

function promptWithAttachments(prompt: string, attachments: PromptAttachment[]) {
  if (attachments.length === 0) {
    return prompt;
  }

  const attachmentPayload = attachments
    .map((attachment, index) => {
      const name = attachment.name ? ` (${attachment.name})` : "";
      const reference = attachment.path ?? attachment.url ?? "";
      return `Attached image ${index + 1}${name}${reference ? `:\n${reference}` : ""}`;
    })
    .join("\n\n");

  return `${prompt}\n\n${attachmentPayload}`;
}

function promptWithAttachmentReferences(prompt: string, attachments: PromptAttachment[]) {
  if (attachments.length === 0) {
    return prompt;
  }

  const attachmentPayload = attachments
    .map((attachment, index) => attachmentReferenceLabel(index, attachment.name))
    .join("\n");

  return `${prompt}\n\n${attachmentPayload}`;
}

function promptWithAppServerImageReferences(prompt: string, inputs: AppServerUserInput[]) {
  let imageIndex = 0;
  const labels = inputs.flatMap((input) => {
    switch (input.type) {
      case "image":
      case "localImage":
        imageIndex += 1;
        return [attachmentReferenceLabel(imageIndex - 1)];
      default:
        return [];
    }
  });
  return labels.length > 0 ? `${prompt}\n\n${labels.join("\n")}` : prompt;
}

function attachmentReferenceLabel(index: number, name?: string) {
  const suffix = name ? ` (${name})` : "";
  return `Attached image ${index + 1}${suffix}`;
}

function appServerTurnInput(
  prompt: string,
  attachments: PromptAttachment[],
  skills: PromptSkill[],
): AppServerTurnStartParams["input"] {
  const context = normalizePromptContext({ attachments, skills });
  const attachmentInputs: AppServerUserInput[] = [];
  for (const attachment of context.attachments) {
    if (attachment.path) {
      attachmentInputs.push({ type: "localImage", path: attachment.path });
    } else if (attachment.url) {
      attachmentInputs.push({ type: "image", url: attachment.url });
    }
  }
  return [
    { type: "text", text: prompt, text_elements: [] },
    ...attachmentInputs,
    ...context.skills.map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      path: skill.path,
    })),
  ];
}

function promptForCollaborationMode(prompt: string, collaborationMode?: ThreadCollaborationMode) {
  if (collaborationMode !== "plan") {
    return prompt;
  }
  return `${collaborationModeTemplates.plan}\n\nUser request:\n${prompt}`;
}

function appServerCollaborationMode(options: {
  collaborationMode?: ThreadCollaborationMode;
  model?: string;
  reasoningEffort?: string;
}): AppServerTurnStartParams["collaborationMode"] {
  if (!options.collaborationMode) {
    return null;
  }

  return {
    mode: options.collaborationMode,
    settings: {
      developer_instructions: null,
      model: options.model ?? defaultCodexModel,
      reasoning_effort: options.reasoningEffort ?? null,
    },
  };
}

function buildThreadOptions(
  base: Parameters<CodexClient["startThread"]>[0],
  options: {
    approvalPolicy?: string;
    model?: string;
    serviceTier?: string;
    reasoningEffort?: string;
    runtimeMode?: RuntimeMode;
    sandboxMode?: string;
  },
): Parameters<CodexClient["startThread"]>[0] {
  const runtime = resolveRuntimeOptions(options.runtimeMode);
  return {
    ...base,
    ...runtime,
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort ? { modelReasoningEffort: options.reasoningEffort as never } : {}),
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy as never } : {}),
    ...(options.sandboxMode ? { sandboxMode: options.sandboxMode as never } : {}),
  };
}

function runtimeMetadataFromOptions(options: RuntimeOptionSubset): Partial<ThreadMetadata> {
  const runtime = options.runtimeMode ? (resolveRuntimeOptions(options.runtimeMode) ?? {}) : {};
  const approvalPolicy = options.approvalPolicy ?? runtime.approvalPolicy;
  const sandboxMode = options.sandboxMode ?? runtime.sandboxMode;
  return {
    ...(options.model ? { model: options.model } : {}),
    ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
    ...(options.runtimeMode ? { runtimeMode: options.runtimeMode } : {}),
    ...(options.collaborationMode ? { collaborationMode: options.collaborationMode } : {}),
    ...(approvalPolicy ? { approvalPolicy: approvalPolicy as ApprovalMode } : {}),
    ...(sandboxMode ? { sandboxMode: sandboxMode as SandboxMode } : {}),
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort as ReasoningEffort }
      : {}),
  };
}

function withRuntimePreferences<T extends RuntimeOptionSubset>(
  preferences: RuntimePreferences,
  options: T,
): T {
  return {
    ...options,
    approvalPolicy: options.approvalPolicy,
    model: options.model ?? preferences.model,
    serviceTier: options.serviceTier ?? preferences.serviceTier,
    reasoningEffort: options.reasoningEffort ?? preferences.reasoningEffort,
    runtimeMode: options.runtimeMode ?? preferences.runtimeMode,
    sandboxMode: options.sandboxMode,
  };
}

function resolveRuntimeOptions(
  runtimeMode: RuntimeMode | undefined,
): Parameters<CodexClient["startThread"]>[0] {
  switch (runtimeMode) {
    case "auto":
      return {
        approvalPolicy: "on-failure",
        sandboxMode: "workspace-write",
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
      };
    case "default":
    case "on-request":
    default:
      return {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      };
  }
}

function resolveAppServerRuntime(options: RuntimeOptionSubset | undefined, workspacePath: string) {
  const runtime = resolveRuntimeOptions(options?.runtimeMode) ?? {};
  const sandbox = options?.sandboxMode ?? runtime.sandboxMode ?? "workspace-write";
  return {
    approvalPolicy: options?.approvalPolicy ?? runtime.approvalPolicy ?? "on-request",
    sandbox,
    sandboxPolicy: sandboxPolicyForMode(sandbox, workspacePath),
  };
}

function sandboxPolicyForMode(sandboxMode: string, workspacePath: string) {
  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (sandboxMode === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess: false,
    };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [workspacePath],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function hasExplicitRunOptions(options: {
  approvalPolicy?: string;
  collaborationMode?: ThreadCollaborationMode;
  model?: string;
  serviceTier?: string;
  reasoningEffort?: string;
  runtimeMode?: RuntimeMode;
  sandboxMode?: string;
}) {
  return Boolean(
    options.model ||
    options.serviceTier ||
    options.reasoningEffort ||
    options.approvalPolicy ||
    options.sandboxMode ||
    options.collaborationMode === "plan" ||
    options.runtimeMode,
  );
}

function mapAppServerThread(
  thread: AppServerThread,
  fallbackMessageCount?: number,
): ThreadMetadata {
  const createdAt = fromUnixSeconds(thread.createdAt);
  const updatedAt = fromUnixSeconds(thread.updatedAt);
  const messageCount = Math.max(
    thread.turns ? countThreadMessages(thread) : 0,
    fallbackMessageCount ?? 0,
  );
  const mappedState = mapAppServerThreadState(thread.status, thread.turns);
  return ThreadSummarySchema.parse({
    id: thread.id,
    title: thread.name ?? preview(thread.preview || "Untitled thread"),
    createdAt,
    updatedAt,
    state: mappedState,
    cwd: String(thread.cwd),
    source: thread.source,
    messageCount,
    lastMessagePreview: thread.preview ? preview(thread.preview) : undefined,
    lastActivityAt: updatedAt,
  });
}

function rememberAppServerThread(threads: Map<string, ThreadMetadata>, thread: AppServerThread) {
  const existingThread = threads.get(thread.id);
  const mappedThread = mapAppServerThread(thread, existingThread?.messageCount);
  const threadWithLocalRuntime = ThreadSummarySchema.parse({
    ...mappedThread,
    ...runtimeMetadataFromOptions(existingThread ?? {}),
    model: existingThread?.model ?? mappedThread.model,
  });
  threads.set(threadWithLocalRuntime.id, threadWithLocalRuntime);
  return threadWithLocalRuntime;
}

function preserveKnownRunningThreadState(thread: ThreadMetadata, wasKnownRunning: boolean) {
  if (!wasKnownRunning || thread.state === "running") {
    return thread;
  }
  return ThreadSummarySchema.parse({
    ...thread,
    state: "running",
  });
}

function mapAppServerMessages(thread: AppServerThread): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const message = mapAppServerItem(thread.id, turn, item);
      if (message) {
        messages.push(message);
      }
    }
  }
  return messages;
}

function mergeAppServerMessagesWithLocalStatus(
  appMessages: ChatMessage[],
  localMessages: ChatMessage[],
) {
  const appMessageIds = new Set(appMessages.map((message) => message.id));
  const localStatusMessages = localMessages.filter(
    (message) => message.role === "status" && !appMessageIds.has(message.id),
  );
  return [...appMessages, ...localStatusMessages].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function mergeThreadMessagePages(incomingMessages: ChatMessage[], cachedMessages: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of cachedMessages) {
    byId.set(message.id, message);
  }
  for (const message of incomingMessages) {
    byId.set(message.id, message);
  }
  return dedupeThreadMessages(Array.from(byId.values()));
}

function dedupeThreadMessages(messages: ChatMessage[]) {
  const byCrossSourceKey = new Map<string, number>();
  const byImageKey = new Map<string, number>();
  const deduped: ChatMessage[] = [];
  const sortedMessages = [...messages].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );

  for (const message of sortedMessages) {
    const crossSourceKey = crossSourceMessageKey(message);
    const crossSourceIndex = crossSourceKey ? byCrossSourceKey.get(crossSourceKey) : undefined;
    if (crossSourceIndex !== undefined) {
      const existingMessage = deduped[crossSourceIndex];
      if (existingMessage && shouldPreferDuplicateThreadMessage(message, existingMessage)) {
        deduped[crossSourceIndex] = message;
      }
      continue;
    }

    const previous = deduped[deduped.length - 1];
    if (previous && isDuplicateCrossSourceMessage(previous, message)) {
      if (shouldPreferDuplicateThreadMessage(message, previous)) {
        deduped[deduped.length - 1] = message;
      }
      continue;
    }

    const imageKey = userImageMessageKey(message);
    if (!imageKey) {
      if (crossSourceKey) {
        byCrossSourceKey.set(crossSourceKey, deduped.length);
      }
      deduped.push(message);
      continue;
    }

    const existingIndex = byImageKey.get(imageKey);
    if (existingIndex === undefined) {
      byImageKey.set(imageKey, deduped.length);
      if (crossSourceKey) {
        byCrossSourceKey.set(crossSourceKey, deduped.length);
      }
      deduped.push(message);
      continue;
    }

    const existingMessage = deduped[existingIndex];
    if (existingMessage && shouldPreferDuplicateThreadMessage(message, existingMessage)) {
      deduped[existingIndex] = message;
    }
  }

  return deduped;
}

function crossSourceMessageKey(message: ChatMessage) {
  if (!isSyntheticHistoryMessageId(message.id)) {
    return undefined;
  }
  if (message.role !== "user" && message.role !== "assistant") {
    return undefined;
  }
  return [
    message.threadId,
    message.createdAt.slice(0, 19),
    message.role,
    message.kind,
    message.content,
  ].join("\n");
}

function isDuplicateCrossSourceMessage(previous: ChatMessage, next: ChatMessage) {
  return (
    previous.id !== next.id &&
    (isSyntheticHistoryMessageId(previous.id) || isSyntheticHistoryMessageId(next.id)) &&
    previous.threadId === next.threadId &&
    previous.role === next.role &&
    previous.kind === next.kind &&
    previous.content === next.content
  );
}

function isSyntheticHistoryMessageId(id: string) {
  return id.startsWith("msg-") || id.startsWith("rollout:");
}

function userImageMessageKey(message: ChatMessage) {
  if (message.role !== "user") {
    return undefined;
  }
  const imageUris = imageAttachmentUris(message);
  if (imageUris.length === 0) {
    return undefined;
  }
  return [normalizeImageMessageContent(message.content), ...imageUris].join("\n");
}

function normalizeImageMessageContent(content: string) {
  return content
    .replace(/\n*Attached image \d+(?: \([^)]+\))?:\n?data:[^;\s]+;base64,[A-Za-z0-9+/=\n\r]+/g, "")
    .replace(/\n*Attached image \d+(?: \([^)]+\))?(?=\n|$)/g, "")
    .trim();
}

function imageAttachmentUris(message: ChatMessage) {
  const attachments = message.details?.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return [];
    }
    const url = "url" in attachment ? attachment.url : undefined;
    const path = "path" in attachment ? attachment.path : undefined;
    return [url, path].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  });
}

function shouldPreferDuplicateThreadMessage(candidate: ChatMessage, existing: ChatMessage) {
  if (existing.id.startsWith("rollout") && !candidate.id.startsWith("rollout")) {
    return true;
  }
  if (!existing.id.startsWith("rollout") && candidate.id.startsWith("rollout")) {
    return false;
  }
  if (!existing.turnId && candidate.turnId) {
    return true;
  }
  if (existing.turnId && !candidate.turnId) {
    return false;
  }
  return candidate.content.length < existing.content.length;
}

function rememberRolloutThreadMessages(
  threads: Map<string, ThreadMetadata>,
  thread: ThreadMetadata,
  messages: ChatMessage[],
  messageCountLowerBound = messages.length,
) {
  const messageCount = Math.max(thread.messageCount, messages.length, messageCountLowerBound);
  const lastMessage = messages[messages.length - 1];
  const nextThread = ThreadSummarySchema.parse({
    ...thread,
    messageCount,
    lastMessagePreview: lastMessage?.content
      ? preview(lastMessage.content)
      : thread.lastMessagePreview,
    lastActivityAt: lastMessage?.createdAt ?? thread.lastActivityAt,
  });
  threads.set(thread.id, nextThread);
  return nextThread;
}

function rolloutThreadMetadata(
  threadId: string,
  workspacePath: string,
  rolloutPath: string,
  messages: ChatMessage[],
) {
  const rolloutStat = statSync(rolloutPath);
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const createdAt = firstMessage?.createdAt ?? new Date(rolloutStat.birthtimeMs).toISOString();
  const updatedAt = lastMessage?.createdAt ?? new Date(rolloutStat.mtimeMs).toISOString();
  return ThreadSummarySchema.parse({
    id: threadId,
    title:
      readSessionIndexThreadTitle(threadId) ??
      preview(lastMessage?.content || firstMessage?.content || "Codex thread"),
    createdAt,
    updatedAt,
    state: "idle",
    cwd: workspacePath,
    source: "app",
    messageCount: messages.length,
    lastMessagePreview: lastMessage?.content ? preview(lastMessage.content) : undefined,
    lastActivityAt: updatedAt,
  });
}

function readSessionIndexThreadTitle(threadId: string) {
  const indexPath = join(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "session_index.jsonl",
  );
  if (!existsSync(indexPath)) {
    return undefined;
  }
  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line.includes(threadId)) {
      continue;
    }
    try {
      const record = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (record.id === threadId && typeof record.thread_name === "string") {
        return record.thread_name;
      }
    } catch {
      // Ignore malformed index entries.
    }
  }
  return undefined;
}

function readRolloutThreadMessages(threadId: string, workspacePath = defaultWorkspacePath) {
  const rolloutPath = findRolloutFileForThread(threadId);
  if (!rolloutPath) {
    return { messageCountLowerBound: 0, messages: [], rolloutPath };
  }

  const collected: ChatMessage[] = [];
  const applyPatchInputs = new Map<string, string>();
  const handledApplyPatchCallIds = new Set<string>();
  const pendingApplyPatchChanges: RolloutPatchChange[] = [];
  const lines = readFileSync(rolloutPath, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    if (!line.trim()) {
      continue;
    }
    if (!isRolloutMessageLine(line)) {
      continue;
    }
    try {
      const record = JSON.parse(line) as {
        payload?: Record<string, unknown>;
        timestamp?: unknown;
        type?: unknown;
      };
      rememberRolloutApplyPatchInput(record, applyPatchInputs);
      collectRolloutApplyPatchOutput(
        record,
        workspacePath,
        applyPatchInputs,
        handledApplyPatchCallIds,
        pendingApplyPatchChanges,
      );
      if (isRolloutTaskComplete(record) && pendingApplyPatchChanges.length > 0) {
        collected.push(
          rolloutApplyPatchSummaryMessage(
            threadId,
            record,
            `rollout:${lineNumber}:apply_patch`,
            pendingApplyPatchChanges,
          ),
        );
        pendingApplyPatchChanges.length = 0;
        continue;
      }
      const message = rolloutRecordMessage(
        threadId,
        record,
        `rollout:${lineNumber}`,
        workspacePath,
      );
      if (!message) {
        continue;
      }
      collected.push(message);
      const patchApplyEndCallId = rolloutPatchApplyEndCallId(record);
      if (patchApplyEndCallId) {
        handledApplyPatchCallIds.add(patchApplyEndCallId);
        pendingApplyPatchChanges.splice(
          0,
          pendingApplyPatchChanges.length,
          ...pendingApplyPatchChanges.filter((change) => change.callId !== patchApplyEndCallId),
        );
      }
    } catch {
      // Ignore corrupt/incomplete JSONL lines; the active writer can append while we read.
    }
  }
  return {
    messageCountLowerBound: collected.length,
    messages: collected,
    rolloutPath,
  };
}

function findRolloutFileForThread(threadId: string) {
  const sessionsRoot = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
  if (!existsSync(sessionsRoot)) {
    return undefined;
  }
  const stack = [sessionsRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith(".jsonl")) {
        return entryPath;
      }
    }
  }
  return undefined;
}

function isRolloutTaskComplete(record: { payload?: Record<string, unknown>; type?: unknown }) {
  return record.type === "event_msg" && record.payload?.type === "task_complete";
}

type RolloutPatchChange = {
  callId?: string;
  kind: string;
  patch?: string;
  path: string;
};

function rolloutRecordMessage(
  threadId: string,
  record: { payload?: Record<string, unknown>; timestamp?: unknown; type?: unknown },
  messageKey: string,
  workspacePath = defaultWorkspacePath,
) {
  const timestamp =
    typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString();
  const payload = record.payload;
  if (!payload) {
    return undefined;
  }

  if (record.type === "event_msg" && payload.type === "user_message") {
    const content = firstString(payload, ["message"]);
    if (!content) {
      return undefined;
    }
    return ChatMessageSchema.parse({
      id: `${messageKey}:user`,
      threadId,
      role: "user",
      content,
      details: rolloutUserMessageDetails(payload),
      createdAt: timestamp,
      state: "completed",
    });
  }

  if (record.type === "event_msg" && payload.type === "agent_message") {
    const content = firstString(payload, ["message"]);
    if (!content) {
      return undefined;
    }
    const messageParts = agentMessageParts(content);
    return ChatMessageSchema.parse({
      id: `${messageKey}:assistant`,
      threadId,
      role: "assistant",
      content: messageParts.content,
      details: messageParts.details,
      createdAt: timestamp,
      state: "completed",
    });
  }

  if (record.type === "event_msg" && payload.type === "patch_apply_end") {
    const changes = rolloutPatchApplyChanges(payload.changes, workspacePath);
    if (changes.length === 0) {
      return undefined;
    }
    const patchPreview = largeTextPreview(rolloutPatchPreview(changes));
    return ChatMessageSchema.parse({
      id: `${messageKey}:patch:${firstString(payload, ["call_id"]) ?? ""}`,
      threadId,
      role: "tool",
      kind: "fileChange",
      content: summarizeFileChanges(changes),
      createdAt: timestamp,
      state: "completed",
      details: {
        changes: changes.map(publicRolloutPatchChange),
        patch: patchPreview?.text,
        patchOriginalLength: patchPreview?.originalLength,
        patchTruncated: patchPreview?.truncated,
      },
    });
  }

  if (record.type === "event_msg" && payload.type === "exec_command_end") {
    const command = Array.isArray(payload.command)
      ? payload.command.map((part) => String(part)).join(" ")
      : firstString(payload, ["command"]) || "Command";
    const outputPreview = largeTextPreview(firstString(payload, ["aggregated_output"]));
    return ChatMessageSchema.parse({
      id: `${messageKey}:command:${firstString(payload, ["call_id"]) ?? ""}`,
      threadId,
      role: "tool",
      kind: "commandExecution",
      content: command,
      createdAt: timestamp,
      state: "completed",
      details: {
        command,
        cwd: firstString(payload, ["cwd"]),
        exitCode: firstNumber(payload, ["exit_code"]),
        output: outputPreview?.text,
        outputOriginalLength: outputPreview?.originalLength,
        outputTruncated: outputPreview?.truncated,
      },
    });
  }

  if (record.type === "event_msg" && payload.type === "mcp_tool_call_end") {
    const invocation =
      payload.invocation && typeof payload.invocation === "object"
        ? (payload.invocation as Record<string, unknown>)
        : undefined;
    const server = invocation ? firstString(invocation, ["server"]) : undefined;
    const tool = invocation ? firstString(invocation, ["tool"]) : undefined;
    return ChatMessageSchema.parse({
      id: `${messageKey}:mcp:${firstString(payload, ["call_id"]) ?? ""}`,
      threadId,
      role: "tool",
      kind: "toolActivity",
      content: [server, tool].filter(Boolean).join(".") || "Tool call",
      createdAt: timestamp,
      state: "completed",
      details: { server, tool },
    });
  }

  return undefined;
}

function rolloutUserMessageDetails(payload: Record<string, unknown>) {
  const attachments = [
    ...rolloutImageAttachments(payload.images, "dataUri"),
    ...rolloutImageAttachments(payload.local_images, "path"),
  ];
  return attachments.length > 0 ? { attachments } : undefined;
}

function rolloutImageAttachments(value: unknown, source: "dataUri" | "path") {
  return stringArray(value).flatMap((image, index) => {
    const name = source === "path" ? basename(image) : `image-${index + 1}.png`;
    if (source === "dataUri") {
      const materialized = materializeDataUriImage(image, name);
      return materialized ? [materialized] : [];
    }
    return localImageAttachmentDetails(image, name);
  });
}

function rememberRolloutApplyPatchInput(
  record: { payload?: Record<string, unknown>; type?: unknown },
  applyPatchInputs: Map<string, string>,
) {
  const payload = record.payload;
  if (
    record.type !== "response_item" ||
    payload?.type !== "custom_tool_call" ||
    firstString(payload, ["name"]) !== "apply_patch"
  ) {
    return;
  }

  const callId = firstString(payload, ["call_id"]);
  const input = firstString(payload, ["input"]);
  if (callId && input) {
    applyPatchInputs.set(callId, input);
  }
}

function collectRolloutApplyPatchOutput(
  record: { payload?: Record<string, unknown>; timestamp?: unknown; type?: unknown },
  workspacePath: string,
  applyPatchInputs: Map<string, string>,
  handledApplyPatchCallIds: ReadonlySet<string>,
  pendingApplyPatchChanges: RolloutPatchChange[],
) {
  const payload = record.payload;
  const callId = firstString(payload, ["call_id"]);
  if (
    record.type !== "response_item" ||
    payload?.type !== "custom_tool_call_output" ||
    !callId ||
    handledApplyPatchCallIds.has(callId)
  ) {
    return;
  }

  const output = rolloutCustomToolOutputText(payload);
  const changes = rolloutApplyPatchOutputChanges(output, workspacePath);
  if (changes.length === 0) {
    return;
  }

  const patch = callId ? applyPatchInputs.get(callId) : undefined;
  for (const change of changes) {
    pendingApplyPatchChanges.push({
      ...change,
      callId,
      patch,
    });
  }
}

function rolloutApplyPatchSummaryMessage(
  threadId: string,
  record: { payload?: Record<string, unknown>; timestamp?: unknown },
  messageKey: string,
  pendingApplyPatchChanges: RolloutPatchChange[],
) {
  const timestamp =
    typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString();
  const uniquePatches = [...new Set(pendingApplyPatchChanges.map((change) => change.patch))];
  const patchPreview = largeTextPreview(
    uniquePatches.filter((patch): patch is string => Boolean(patch)).join("\n"),
  );
  return ChatMessageSchema.parse({
    id: `${messageKey}:summary`,
    threadId,
    role: "tool",
    kind: "fileChange",
    content: summarizeFileChanges(pendingApplyPatchChanges),
    createdAt: timestamp,
    state: "completed",
    details: {
      changes: pendingApplyPatchChanges.map(publicRolloutPatchChange),
      patch: patchPreview?.text,
      patchOriginalLength: patchPreview?.originalLength,
      patchTruncated: patchPreview?.truncated,
    },
  });
}

function rolloutPatchApplyEndCallId(record: { payload?: Record<string, unknown>; type?: unknown }) {
  if (record.type !== "event_msg" || record.payload?.type !== "patch_apply_end") {
    return undefined;
  }
  return firstString(record.payload, ["call_id"]);
}

function publicRolloutPatchChange(change: RolloutPatchChange) {
  const { callId: _callId, patch: _patch, ...publicChange } = change;
  return publicChange;
}

function rolloutPatchPreview(changes: RolloutPatchChange[]) {
  return changes
    .flatMap((change) => {
      if (!change.patch) {
        return [];
      }
      if (hasPatchFileHeader(change.patch)) {
        return [change.patch];
      }
      return [`*** ${patchHeaderChangeKind(change.kind)} File: ${change.path}\n${change.patch}`];
    })
    .join("\n");
}

function hasPatchFileHeader(patch: string) {
  return /^(?:diff --git |\*\*\* (?:Add|Update|Delete) File: )/m.test(patch);
}

function patchHeaderChangeKind(kind: string) {
  if (kind === "added") {
    return "Add";
  }
  if (kind === "deleted") {
    return "Delete";
  }
  return "Update";
}

function rolloutCustomToolOutputText(payload: Record<string, unknown>) {
  const rawOutput = firstString(payload, ["output"]);
  if (!rawOutput) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawOutput) as { output?: unknown };
    return typeof parsed.output === "string" ? parsed.output : rawOutput;
  } catch {
    return rawOutput;
  }
}

function rolloutApplyPatchOutputChanges(value: string | undefined, workspacePath: string) {
  if (!value || !value.includes("Updated the following files")) {
    return [];
  }

  return value.split("\n").flatMap((line): RolloutPatchChange[] => {
    const match = line.match(/^\s*([ADM])\s+(.+?)\s*$/);
    if (!match) {
      return [];
    }

    return [
      {
        kind: rolloutPatchChangeKind(
          match[1] === "A" ? "added" : match[1] === "D" ? "deleted" : "modified",
        ),
        path: rolloutPatchDisplayPath(match[2] ?? "", workspacePath),
      },
    ];
  });
}

function rolloutPatchApplyChanges(
  value: unknown,
  workspacePath = defaultWorkspacePath,
): RolloutPatchChange[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([rawPath, rawChange]) => {
    if (!rawChange || typeof rawChange !== "object") {
      return [];
    }

    const record = rawChange as Record<string, unknown>;
    const type = firstString(record, ["type"]) ?? "modified";
    return [
      {
        kind: rolloutPatchChangeKind(type),
        patch: firstString(record, ["unified_diff", "patch"]),
        path: rolloutPatchDisplayPath(rawPath, workspacePath),
      },
    ];
  });
}

function rolloutPatchChangeKind(type: string) {
  const normalized = type.toLowerCase();
  if (["add", "added", "create", "created"].includes(normalized)) {
    return "added";
  }
  if (["delete", "deleted", "remove", "removed"].includes(normalized)) {
    return "deleted";
  }
  if (["move", "moved", "rename", "renamed"].includes(normalized)) {
    return "renamed";
  }
  return "modified";
}

function rolloutPatchDisplayPath(value: string, workspacePath = defaultWorkspacePath) {
  const filePath = value.startsWith("file://") ? fileUrlPath(value) : value;
  if (!isAbsolute(filePath)) {
    return filePath;
  }

  const rootPath = resolve(workspacePath);
  const relativePath = relative(rootPath, filePath);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)
    ? relativePath.split("\\").join("/")
    : filePath;
}

function fileUrlPath(value: string) {
  try {
    return fileURLToPath(value);
  } catch {
    return value;
  }
}

function isRolloutMessageLine(line: string) {
  return (
    (line.includes('"type":"event_msg"') &&
      (line.includes('"type":"user_message"') ||
        line.includes('"type":"agent_message"') ||
        line.includes('"type":"patch_apply_end"') ||
        line.includes('"type":"task_complete"') ||
        line.includes('"type":"exec_command_end"') ||
        line.includes('"type":"mcp_tool_call_end"'))) ||
    (line.includes('"type":"response_item"') &&
      (line.includes('"type":"custom_tool_call"') ||
        line.includes('"type":"custom_tool_call_output"')))
  );
}

function threadDetailResponse(input: {
  messages: ChatMessage[];
  pendingInputRequests: PendingInputRequest[];
  thread: ThreadMetadata;
}) {
  return ThreadDetailResponseSchema.parse({
    thread: input.thread,
    messages: input.messages,
    pendingInputRequests: input.pendingInputRequests,
  });
}

const threadDetailLargeTextPreviewLimit = 8 * 1024;

function largeTextPreview(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value.length <= threadDetailLargeTextPreviewLimit) {
    return {
      originalLength: value.length,
      text: value,
      truncated: false,
    };
  }

  const headLength = Math.ceil(threadDetailLargeTextPreviewLimit / 2);
  const tailLength = Math.floor(threadDetailLargeTextPreviewLimit / 2);
  const omittedLength = value.length - headLength - tailLength;
  return {
    originalLength: value.length,
    text: `${value.slice(0, headLength)}\n\n[... truncated ${omittedLength} characters ...]\n\n${value.slice(-tailLength)}`,
    truncated: true,
  };
}

type MessageDetailLookup =
  | {
      found: true;
      value: string;
    }
  | {
      found: false;
    };

function threadMessageDetailResponse(
  messageId: string,
  field: ThreadMessageDetailField,
  value: string,
) {
  return ThreadMessageDetailResponseSchema.parse({
    field,
    messageId,
    originalLength: value.length,
    value,
  });
}

function appServerThreadMessageDetail(
  thread: AppServerThread,
  messageId: string,
  field: ThreadMessageDetailField,
): MessageDetailLookup {
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.id !== messageId) {
        continue;
      }
      const value = appServerItemDetailValue(item, field);
      return typeof value === "string" ? { found: true, value } : { found: false };
    }
  }
  return { found: false };
}

function appServerItemDetailValue(
  item: AppServerThreadItem,
  field: ThreadMessageDetailField,
): string | undefined {
  if (field === "output" && item.type === "commandExecution") {
    return (
      (item as Extract<AppServerThreadItem, { type: "commandExecution" }>).aggregatedOutput ??
      undefined
    );
  }
  if (field === "patch" && item.type === "fileChange") {
    return (item as Extract<AppServerThreadItem, { type: "fileChange" }>).patch ?? undefined;
  }
  return undefined;
}

function localThreadMessageDetail(
  messages: ChatMessage[],
  messageId: string,
  field: ThreadMessageDetailField,
): MessageDetailLookup {
  const message = messages.find((candidate) => candidate.id === messageId);
  const value = message?.details?.[field];
  return typeof value === "string" ? { found: true, value } : { found: false };
}

function mapAppServerItem(threadId: string, turn: AppServerTurn, item: AppServerThreadItem) {
  const timestamp = fromUnixSeconds(turn.startedAt ?? turn.completedAt ?? Date.now() / 1000);
  const base = {
    id: item.id,
    threadId,
    createdAt: timestamp,
    updatedAt: turn.completedAt ? fromUnixSeconds(turn.completedAt) : timestamp,
    turnId: turn.id,
    state: "completed" as const,
  };

  switch (item.type) {
    case "userMessage": {
      const userItem = item as Extract<AppServerThreadItem, { type: "userMessage" }>;
      return ChatMessageSchema.parse({
        ...base,
        role: "user",
        content: appServerUserMessageText(userItem),
        details: appServerUserMessageDetails(userItem),
      });
    }
    case "agentMessage": {
      const agentItem = item as Extract<AppServerThreadItem, { type: "agentMessage" }>;
      const planContent = proposedPlanContent(agentItem.text);
      const messageParts = appServerAgentMessageParts(agentItem);
      return ChatMessageSchema.parse({
        ...base,
        role: "assistant",
        kind: planContent ? "plan" : undefined,
        content: planContent ?? messageParts.content,
        details: planContent ? { raw: agentItem.text } : messageParts.details,
      });
    }
    case "reasoning": {
      const reasoningItem = item as Extract<AppServerThreadItem, { type: "reasoning" }>;
      const summary = compactStringList(reasoningItem.summary);
      const content = compactStringList(reasoningItem.content);
      const text = [...summary, ...content].join("\n\n") || "Reasoning";
      return ChatMessageSchema.parse({
        ...base,
        role: "reasoning",
        kind: "thinking",
        content: text,
        details: { summary, content },
      });
    }
    case "commandExecution": {
      const commandItem = item as Extract<AppServerThreadItem, { type: "commandExecution" }>;
      const outputPreview = largeTextPreview(commandItem.aggregatedOutput);
      return ChatMessageSchema.parse({
        ...base,
        role: "tool",
        kind: "commandExecution",
        content: commandItem.command,
        details: {
          command: commandItem.command,
          cwd: commandItem.cwd ?? undefined,
          exitCode: commandItem.exitCode ?? undefined,
          output: outputPreview?.text,
          outputOriginalLength: outputPreview?.originalLength,
          outputTruncated: outputPreview?.truncated,
          status: commandItem.status ?? undefined,
        },
      });
    }
    case "fileChange": {
      const fileItem = item as Extract<AppServerThreadItem, { type: "fileChange" }>;
      const changes = fileItem.changes ?? [];
      const patchPreview = largeTextPreview(fileItem.patch);
      return ChatMessageSchema.parse({
        ...base,
        role: "tool",
        kind: "fileChange",
        content: summarizeFileChanges(changes),
        details: {
          changes,
          patch: patchPreview?.text,
          patchOriginalLength: patchPreview?.originalLength,
          patchTruncated: patchPreview?.truncated,
        },
      });
    }
    case "mcpToolCall": {
      const toolItem = item as Extract<AppServerThreadItem, { type: "mcpToolCall" }>;
      return ChatMessageSchema.parse({
        ...base,
        role: "tool",
        kind: "toolActivity",
        content: `${toolItem.server}.${toolItem.tool}`,
        details: {
          server: toolItem.server,
          status: toolItem.status ?? undefined,
          tool: toolItem.tool,
        },
      });
    }
    case "webSearch": {
      const searchItem = item as Extract<AppServerThreadItem, { type: "webSearch" }>;
      return ChatMessageSchema.parse({
        ...base,
        role: "tool",
        kind: "webSearch",
        content: searchItem.query,
        details: { query: searchItem.query, status: searchItem.status ?? undefined },
      });
    }
    default:
      return mapUnknownAppServerItem(threadId, turn, item);
  }
}

function mapUnknownAppServerItem(threadId: string, turn: AppServerTurn, item: AppServerThreadItem) {
  const timestamp = fromUnixSeconds(turn.startedAt ?? turn.completedAt ?? Date.now() / 1000);
  const type = "type" in item ? String(item.type) : "unknown";
  const kind = kindFromProtocolType(type) ?? "unknown";
  const record = item as Record<string, unknown>;
  const content = kind === "plan" ? (planContentFromRecord(record) ?? type) : type;
  return ChatMessageSchema.parse({
    id: item.id,
    threadId,
    role: "status",
    kind,
    content,
    createdAt: timestamp,
    updatedAt: turn.completedAt ? fromUnixSeconds(turn.completedAt) : timestamp,
    turnId: turn.id,
    state: "completed",
    details: kind === "plan" ? planDetailsFromRecord(record) : { type },
  });
}

function appServerTurnShell(turnId: string | undefined): AppServerTurn {
  return {
    id: turnId ?? "turn-live",
    items: [],
    status: "running",
    startedAt: Date.now() / 1000,
    completedAt: null,
  };
}

function mapAppServerModel(model: AppServerModel) {
  const serviceTiers =
    model.serviceTiers ??
    model.additionalSpeedTiers?.map((tier) => ({
      id: tier,
      name: tier === "fast" ? "Fast" : tier,
      description: undefined,
    })) ??
    [];
  return {
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    description: model.description,
    isDefault: Boolean(model.isDefault),
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts:
      model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort) ?? [],
    serviceTiers,
  };
}

function normalizeRateLimitBuckets(rateLimits: AppServerRateLimits) {
  const keyed = objectRecord(rateLimits.rateLimitsByLimitId);
  if (keyed) {
    return Object.values(keyed).flatMap((value) => {
      const bucket = normalizeRateLimitBucket(value);
      return bucket ? [bucket] : [];
    });
  }

  const bucket = normalizeRateLimitBucket(rateLimits.rateLimits);
  return bucket ? [bucket] : [];
}

function normalizeRateLimitBucket(value: unknown) {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }

  const limitId = firstString(record, ["limitId", "limit_id", "id"]);
  if (!limitId) {
    return undefined;
  }

  return {
    limitId,
    limitName: firstString(record, ["limitName", "limit_name", "name"]) ?? null,
    planType: firstString(record, ["planType", "plan_type"]) ?? null,
    primary: normalizeRateLimitWindow(record.primary),
    secondary: normalizeRateLimitWindow(record.secondary),
    rateLimitReachedType:
      firstString(record, ["rateLimitReachedType", "rate_limit_reached_type"]) ?? null,
  };
}

function normalizeRateLimitWindow(value: unknown) {
  const record = objectRecord(value);
  if (!record) {
    return null;
  }

  const usedPercent = firstNumber(record, ["usedPercent", "used_percent"]);
  if (usedPercent === undefined) {
    return null;
  }

  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent))),
    windowDurationMins: firstNumber(record, ["windowDurationMins", "window_duration_mins"]) ?? null,
    resetsAt: firstNumber(record, ["resetsAt", "resets_at"]) ?? null,
  };
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function fallbackModels(): AppServerModel[] {
  return [
    {
      id: defaultCodexModel,
      model: defaultCodexModel,
      displayName: "GPT-5.5",
      description: "Default Codex model",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
        { reasoningEffort: "xhigh" },
      ],
      additionalSpeedTiers: ["fast"],
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
    },
  ];
}

function mapAppServerThreadState(status: unknown, turns?: AppServerTurn[]) {
  if (turns?.some(isAppServerTurnRunning)) {
    return "running";
  }
  return mapAppServerThreadStatusState(status);
}

function isAppServerTurnRunning(turn: AppServerTurn) {
  if (turn.completedAt !== null && turn.completedAt !== undefined) {
    return false;
  }
  return mapAppServerTurnStatusState(turn.status) === "running";
}

function mapAppServerThreadStatusState(status: unknown) {
  const statusType = appServerStatusType(status);
  if (!statusType) {
    return "idle";
  }
  if (["failed", "systemerror", "error"].includes(statusType)) {
    return "failed";
  }
  if (["completed", "complete", "done"].includes(statusType)) {
    return "completed";
  }
  if (["idle", "notloaded", "notstarted"].includes(statusType)) {
    return "idle";
  }
  if (["active", "running", "inprogress", "processing"].includes(statusType)) {
    return "running";
  }
  return "idle";
}

function mapAppServerTurnStatusState(status: unknown) {
  const statusType = appServerStatusType(status);
  if (!statusType) {
    return "idle";
  }
  if (["failed", "systemerror", "error"].includes(statusType)) {
    return "failed";
  }
  if (["completed", "complete", "done"].includes(statusType)) {
    return "completed";
  }
  if (["idle", "notloaded", "notstarted"].includes(statusType)) {
    return "idle";
  }
  return "running";
}

function appServerStatusType(status: unknown) {
  if (typeof status === "string") {
    return normalizeAppServerStatus(status);
  }
  if (status && typeof status === "object" && "type" in status) {
    return normalizeAppServerStatus(String(status.type));
  }
  return undefined;
}

function normalizeAppServerStatus(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function countThreadMessages(thread: AppServerThread) {
  return (
    thread.turns?.reduce(
      (count, turn) =>
        count +
        turn.items.filter((item) => item.type === "userMessage" || item.type === "agentMessage")
          .length,
      0,
    ) ?? 0
  );
}

function fromUnixSeconds(value: number) {
  return new Date(value * 1000).toISOString();
}

function preview(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function compactStringList(value: string[] | undefined) {
  return value?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function summarizeFileChanges(changes: Array<{ path: string; kind: string }>) {
  if (changes.length === 0) {
    return "Files changed";
  }

  const paths = changes.map((change) => change.path).filter(Boolean);
  const shown = paths.slice(0, 3).join(", ");
  const suffix = paths.length > 3 ? ` and ${paths.length - 3} more` : "";
  return `${changes.length} file${changes.length === 1 ? "" : "s"} changed: ${shown}${suffix}`;
}

function structuredStreamMessage(
  role: "reasoning" | "tool" | "status",
  event: unknown,
  fallbackContent: string,
): Pick<ChatMessage, "content" | "details" | "kind"> {
  const item = eventItem(event);
  const type = item?.type ? String(item.type) : undefined;

  if (role === "reasoning") {
    const summary = stringArray(item?.summary);
    const content = stringArray(item?.content);
    return {
      kind: "thinking",
      content: [...summary, ...content].join("\n\n") || fallbackContent,
      details: { content, summary, type },
    };
  }

  switch (type) {
    case "command_execution": {
      const command = firstString(item, ["command", "cmd"]) ?? fallbackContent;
      return {
        kind: "commandExecution",
        content: command,
        details: {
          command,
          cwd: firstString(item, ["cwd", "working_directory"]),
          exitCode: firstNumber(item, ["exit_code", "exitCode"]),
          output: firstString(item, ["aggregated_output", "aggregatedOutput", "output"]),
          status: firstString(item, ["status"]),
          type,
        },
      };
    }
    case "file_change": {
      const changes = Array.isArray(item?.changes) ? item.changes : [];
      return {
        kind: "fileChange",
        content: summarizeFileChanges(normalizeFileChanges(changes)),
        details: { changes, patch: firstString(item, ["patch"]), type },
      };
    }
    case "mcp_tool_call":
      return {
        kind: "toolActivity",
        content:
          [firstString(item, ["server"]), firstString(item, ["tool", "name"])]
            .filter(Boolean)
            .join(".") || fallbackContent,
        details: {
          server: firstString(item, ["server"]),
          status: firstString(item, ["status"]),
          tool: firstString(item, ["tool", "name"]),
          type,
        },
      };
    case "web_search":
      return {
        kind: "webSearch",
        content: firstString(item, ["query"]) ?? fallbackContent,
        details: {
          query: firstString(item, ["query"]),
          status: firstString(item, ["status"]),
          type,
        },
      };
    default:
      return {
        kind: kindFromProtocolType(type) ?? (role === "tool" ? "toolActivity" : "unknown"),
        content: fallbackContent,
        details: { type },
      };
  }
}

function isApprovalServerRequest(method: string) {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "item/tool/requestUserInput" ||
    method === "mcpServer/elicitation/request" ||
    method === "execCommandApproval" ||
    method === "applyPatchApproval"
  );
}

function approvalMessageFromRequest(request: AppServerRequest) {
  const params = recordParams(request);
  const threadId = firstString(params, ["threadId", "conversationId"]);
  const turnId = firstString(params, ["turnId"]) ?? undefined;
  if (!threadId) {
    return undefined;
  }

  const approvalId = `approval-${request.id}`;
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const command = firstString(params, ["command"]) ?? "Command execution";
      return {
        approvalId,
        content: command,
        details: {
          approvalId,
          approvalKind: "commandExecution",
          command,
          cwd: firstString(params, ["cwd"]),
          reason: firstString(params, ["reason"]),
          availableDecisions: Array.isArray(params?.availableDecisions)
            ? params.availableDecisions
            : undefined,
        },
        kind: "commandExecution" as const,
        threadId,
        turnId,
      };
    }
    case "execCommandApproval": {
      const command = stringArray(params?.command).join(" ") || "Command execution";
      return {
        approvalId,
        content: command,
        details: {
          approvalId,
          approvalKind: "commandExecution",
          command,
          cwd: firstString(params, ["cwd"]),
          reason: firstString(params, ["reason"]),
        },
        kind: "commandExecution" as const,
        threadId,
        turnId,
      };
    }
    case "item/fileChange/requestApproval":
      return {
        approvalId,
        content: firstString(params, ["reason"]) ?? "Approve file changes",
        details: {
          approvalId,
          approvalKind: "fileChange",
          grantRoot: firstString(params, ["grantRoot"]),
          reason: firstString(params, ["reason"]),
        },
        kind: "fileChange" as const,
        threadId,
        turnId,
      };
    case "applyPatchApproval":
      return {
        approvalId,
        content: firstString(params, ["reason"]) ?? "Approve file changes",
        details: {
          approvalId,
          approvalKind: "fileChange",
          changes: params?.fileChanges,
          reason: firstString(params, ["reason"]),
        },
        kind: "fileChange" as const,
        threadId,
        turnId,
      };
    case "item/permissions/requestApproval":
      return {
        approvalId,
        content: firstString(params, ["reason"]) ?? "Approve additional permissions",
        details: {
          approvalId,
          approvalKind: "permissions",
          cwd: firstString(params, ["cwd"]),
          permissions: params?.permissions,
          reason: firstString(params, ["reason"]),
        },
        kind: "permissions" as const,
        threadId,
        turnId,
      };
    case "item/tool/requestUserInput":
      const questions = pendingInputQuestions(params?.questions);
      return {
        approvalId,
        content: "Input requested",
        details: {
          approvalId,
          approvalKind: "structuredUserInput",
          questions,
        },
        kind: "structuredUserInput" as const,
        questions,
        threadId,
        turnId,
      };
    case "mcpServer/elicitation/request":
      return {
        approvalId,
        content: firstString(params, ["message"]) ?? "MCP input requested",
        details: {
          approvalId,
          approvalKind: "mcpElicitation",
          message: firstString(params, ["message"]),
          mode: firstString(params, ["mode"]),
          serverName: firstString(params, ["serverName"]),
          url: firstString(params, ["url"]),
        },
        kind: "mcpElicitation" as const,
        threadId,
        turnId,
      };
    default:
      return undefined;
  }
}

function pendingInputQuestions(value: unknown): PendingInputRequestQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((question, index) => {
    if (!question || typeof question !== "object") {
      return [];
    }
    const record = question as Record<string, unknown>;
    const questionText =
      typeof record.question === "string" && record.question.trim()
        ? record.question.trim()
        : undefined;
    if (!questionText) {
      return [];
    }
    return [
      {
        header: typeof record.header === "string" ? record.header : undefined,
        id:
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim()
            : `question_${index + 1}`,
        options: pendingInputOptions(record.options),
        question: questionText,
      },
    ];
  });
}

function pendingInputOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options = value.flatMap((option) => {
    if (!option || typeof option !== "object") {
      return [];
    }
    const record = option as Record<string, unknown>;
    const label =
      typeof record.label === "string" && record.label.trim() ? record.label.trim() : "";
    if (!label) {
      return [];
    }
    return [
      {
        description:
          typeof record.description === "string" && record.description.trim()
            ? record.description.trim()
            : undefined,
        label,
      },
    ];
  });
  return options.length > 0 ? options : undefined;
}

function pendingInputRequestFromApproval(
  approval: {
    approvalId: string;
    questions?: PendingInputRequestQuestion[];
    turnId?: string;
  },
  threadId: string,
): PendingInputRequest {
  return {
    id: approval.approvalId,
    questions: approval.questions ?? [],
    threadId,
    turnId: approval.turnId,
  };
}

function pendingInputRequestsForThread(
  pendingApprovals: Map<string, PendingApproval>,
  threadId: string,
) {
  return Array.from(pendingApprovals.entries()).flatMap(([approvalId, pending]) => {
    if (pending.kind !== "structuredUserInput" || pending.threadId !== threadId) {
      return [];
    }
    return [
      {
        id: approvalId,
        questions: pending.questions ?? [],
        threadId,
        turnId: pending.turnId,
      },
    ];
  });
}

function structuredUserInputResponse(
  questions: PendingInputRequestQuestion[],
  decision: "approve" | "approve-for-session" | "deny" | "cancel",
  answers: string[],
) {
  if (decision !== "approve" && decision !== "approve-for-session") {
    return { answers: {} };
  }

  return {
    answers: Object.fromEntries(
      questions.map((question, index) => {
        const answer = answers[index]?.trim();
        return [question.id, { answers: answer ? [answer] : [] }];
      }),
    ),
  };
}

async function resolveAppServerRequest(
  pending: PendingApproval,
  decision: "approve" | "approve-for-session" | "deny" | "cancel",
  answers: string[],
) {
  switch (pending.kind) {
    case "commandExecution":
      await pending.appServer.respondToRequest(pending.requestId, {
        decision:
          pending.method === "execCommandApproval"
            ? legacyApprovalDecision(decision)
            : commandApprovalDecision(decision),
      });
      return;
    case "fileChange":
      await pending.appServer.respondToRequest(pending.requestId, {
        decision:
          pending.method === "applyPatchApproval"
            ? legacyApprovalDecision(decision)
            : fileChangeApprovalDecision(decision),
      });
      return;
    case "permissions":
      await pending.appServer.respondToRequest(pending.requestId, {
        permissions: decision === "approve" || decision === "approve-for-session" ? {} : {},
        scope: decision === "approve-for-session" ? "session" : "turn",
        strictAutoReview: decision === "deny" || decision === "cancel",
      });
      return;
    case "structuredUserInput":
      await pending.appServer.respondToRequest(
        pending.requestId,
        structuredUserInputResponse(pending.questions ?? [], decision, answers),
      );
      return;
    case "mcpElicitation":
      await pending.appServer.respondToRequest(pending.requestId, {
        action: decision === "approve" || decision === "approve-for-session" ? "accept" : "decline",
        content: answers.length > 0 ? { answers } : null,
        _meta: null,
      });
      return;
  }
}

function legacyApprovalDecision(decision: string) {
  switch (decision) {
    case "approve":
      return "approved";
    case "approve-for-session":
      return "approved_for_session";
    case "cancel":
      return "abort";
    case "deny":
    default:
      return "denied";
  }
}

function commandApprovalDecision(decision: string) {
  switch (decision) {
    case "approve":
      return "accept";
    case "approve-for-session":
      return "acceptForSession";
    case "cancel":
      return "cancel";
    case "deny":
    default:
      return "decline";
  }
}

function fileChangeApprovalDecision(decision: string) {
  switch (decision) {
    case "approve":
      return "accept";
    case "approve-for-session":
      return "acceptForSession";
    case "cancel":
      return "cancel";
    case "deny":
    default:
      return "decline";
  }
}

function kindFromProtocolType(type: string | undefined) {
  switch (type) {
    case "plan":
    case "turn_plan_updated":
    case "turn/plan/updated":
      return "plan";
    case "request_user_input":
    case "structured_user_input":
    case "structuredUserInput":
      return "structuredUserInput";
    case "approval_request":
    case "approvalRequest":
      return "approvalRequest";
    case "subagent_action":
    case "subagentAction":
      return "subagentAction";
    default:
      return undefined;
  }
}

function eventItem(event: unknown) {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const record = event as Record<string, unknown>;
  return record.item && typeof record.item === "object"
    ? (record.item as Record<string, unknown>)
    : record;
}

function recordParams(message: { params?: unknown } | AppServerNotification | AppServerRequest) {
  return message.params && typeof message.params === "object"
    ? (message.params as Record<string, unknown>)
    : undefined;
}

function turnIdFromParams(params: Record<string, unknown> | undefined) {
  const turn = params?.turn;
  return turn && typeof turn === "object"
    ? firstString(turn as Record<string, unknown>, ["id"])
    : undefined;
}

function turnStatus(params: Record<string, unknown> | undefined) {
  if (typeof params?.status === "string") {
    return params.status;
  }
  const turn = params?.turn;
  if (turn && typeof turn === "object") {
    const status = (turn as Record<string, unknown>).status;
    return typeof status === "string" ? status : undefined;
  }
  return undefined;
}

function terminalTurnState(method: string, params: Record<string, unknown> | undefined) {
  const status = turnStatus(params);
  if (
    method === "turn/aborted" ||
    method === "turn/cancelled" ||
    method === "turn/failed" ||
    status === "aborted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "failed" ||
    status === "interrupted"
  ) {
    return "failed" as const;
  }
  return "completed" as const;
}

function proposedPlanContent(value: string) {
  const match = value.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
  return match?.[1]?.trim() || undefined;
}

function turnErrorMessage(params: Record<string, unknown> | undefined) {
  const message = firstString(params, ["message", "reason", "lastError"]);
  if (message) {
    return message;
  }
  const directError = params?.error;
  if (typeof directError === "string" && directError.trim()) {
    return directError;
  }
  if (directError && typeof directError === "object") {
    const directErrorMessage = firstString(directError as Record<string, unknown>, [
      "message",
      "reason",
    ]);
    if (directErrorMessage) {
      return directErrorMessage;
    }
  }
  const turn = params?.turn;
  if (!turn || typeof turn !== "object") {
    return undefined;
  }
  const error = (turn as Record<string, unknown>).error;
  return error && typeof error === "object"
    ? firstString(error as Record<string, unknown>, ["message"])
    : undefined;
}

function planStepText(step: unknown) {
  if (typeof step === "string") {
    return meaningfulPlanText(step);
  }
  if (!step || typeof step !== "object") {
    return undefined;
  }
  const record = step as Record<string, unknown>;
  const text =
    planString(record, ["markdown", "content", "text", "title", "description", "summary"]) ??
    planTextFromValue(record.step) ??
    planTextFromValue(record.plan) ??
    planTextFromValue(record.steps) ??
    planTextFromValue(record.items);
  const status = firstString(record, ["status"]);
  return text ? `${status ? `${status}: ` : ""}${text}` : undefined;
}

function planContentFromRecord(record: Record<string, unknown> | undefined) {
  if (!record) {
    return undefined;
  }

  const explanation = planString(record, ["explanation"]);
  const direct = planString(record, ["markdown", "content", "text", "message"]);
  const nestedPlan =
    planTextFromValue(record.plan) ??
    planTextFromValue(record.steps) ??
    planTextFromValue(record.items) ??
    planTextFromValue(record.body);
  return [explanation, nestedPlan ?? direct].filter(Boolean).join("\n").trim() || undefined;
}

function planDetailsFromRecord(record: Record<string, unknown> | undefined) {
  return {
    type: firstString(record, ["type"]),
    explanation: planString(record, ["explanation"]),
    plan: record?.plan,
    steps: record?.steps,
    raw: record,
  };
}

function planTextFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return meaningfulPlanText(value);
  }
  if (Array.isArray(value)) {
    return (
      value
        .map((step) => planStepText(step))
        .filter(Boolean)
        .join("\n") || undefined
    );
  }
  const record = objectRecord(value);
  return record ? planContentFromRecord(record) : undefined;
}

function planString(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string") {
      const text = meaningfulPlanText(value);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function meaningfulPlanText(value: string) {
  const text = (proposedPlanContent(value) ?? value).trim();
  return text && text.toLowerCase() !== "plan" ? text : undefined;
}

function firstString(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeFileChanges(value: unknown[]) {
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const path = firstString(record, ["path"]);
    const kind = firstString(record, ["kind", "type"]) ?? "modified";
    return path ? [{ path, kind }] : [];
  });
}

type WorkspaceChangeFile = {
  additions: number;
  deletions: number;
  isBinary: boolean;
  oldPath: string | null;
  path: string;
  patch: string;
  stagedStatus: string | null;
  status: string;
  worktreeStatus: string | null;
};

async function readWorkspaceChanges(workspacePath: string) {
  const repo = await openRepository(workspacePath);
  const [currentBranch, branches] = await Promise.all([
    currentGitBranch(workspacePath),
    listGitBranches(workspacePath),
  ]);
  const statusEntries = collectIterator<StatusEntry>(repo.statuses().iter()).filter(
    (entry) => !entry.status().ignored,
  );
  const statusByPath = new Map(statusEntries.map((entry) => [entry.path(), entry]));
  const status = statusEntries
    .map((entry) => formatStatusLine(entry.path(), entry.status()))
    .join("\n");
  const structuredDiff = createWorkspaceDiff(repo);
  const diff = await git(workspacePath, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "HEAD",
    "--",
  ]).catch(() => structuredDiff.print());
  const patchesByPath = splitDiffByPath(diff);
  structuredDiff.findSimilar({ renames: true });
  const stats = structuredDiff.stats();
  const filesByPath = new Map<string, WorkspaceChangeFile>();

  for (const delta of collectIterator<DiffDelta>(structuredDiff.deltas())) {
    const path = delta.newFile().path() ?? delta.oldFile().path();
    if (!path) {
      continue;
    }

    const patch = patchesByPath.get(path) ?? patchesByPath.get(delta.oldFile().path() ?? "") ?? "";
    const lineStats = countPatchLines(patch);
    const statusEntry = statusByPath.get(path) ?? statusByPath.get(delta.oldFile().path() ?? "");
    filesByPath.set(path, {
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      isBinary: delta.newFile().isBinary() || delta.oldFile().isBinary(),
      oldPath: delta.oldFile().path(),
      path,
      patch,
      stagedStatus: statusEntry?.headToIndex()?.status() ?? null,
      status: delta.status(),
      worktreeStatus: statusEntry?.indexToWorkdir()?.status() ?? null,
    });
  }

  for (const entry of statusEntries) {
    if (filesByPath.has(entry.path())) {
      continue;
    }

    filesByPath.set(entry.path(), {
      additions: 0,
      deletions: 0,
      isBinary: false,
      oldPath: null,
      path: entry.path(),
      patch: "",
      stagedStatus: entry.headToIndex()?.status() ?? null,
      status: statusNameFromStatus(entry.status()),
      worktreeStatus: entry.indexToWorkdir()?.status() ?? null,
    });
  }

  const files = [...filesByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const fileStats = {
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    filesChanged: files.length,
  };

  return {
    branches,
    currentBranch,
    diff,
    files,
    hasChanges: files.length > 0 || Boolean(status.trim() || diff.trim()),
    status,
    stats:
      files.length > 0
        ? fileStats
        : {
            additions: Number(stats.insertions),
            deletions: Number(stats.deletions),
            filesChanged: Number(stats.filesChanged),
          },
  };
}

async function currentGitBranch(workspacePath: string) {
  const branch = await git(workspacePath, ["branch", "--show-current"]).catch(() => "");
  return branch.trim() || null;
}

async function localGitBranchExists(workspacePath: string, branch: string) {
  try {
    await git(workspacePath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function listGitBranches(workspacePath: string) {
  const output = await git(workspacePath, [
    "branch",
    "--format=%(HEAD)%09%(refname:short)",
    "--sort=refname",
  ]).catch(() => "");

  return output
    .split("\n")
    .map((line) => {
      const [headMarker, name] = line.split("\t");
      return {
        current: headMarker === "*",
        name: name?.trim() ?? "",
      };
    })
    .filter((branch) => branch.name.length > 0);
}

function createWorkspaceDiff(repo: Repository): Diff {
  const options = {
    includeUntracked: true,
    recurseUntrackedDirs: true,
    showUntrackedContent: true,
  };

  try {
    return repo.diffTreeToWorkdirWithIndex(repo.head().peelToTree(), options);
  } catch {
    return repo.diffIndexToWorkdir(undefined, options);
  }
}

function collectIterator<T>(iterator: { next: () => IteratorResult<T, void> }) {
  const items: T[] = [];

  for (let result = iterator.next(); !result.done; result = iterator.next()) {
    items.push(result.value);
  }

  return items;
}

function splitDiffByPath(diff: string) {
  const patches = new Map<string, string>();
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);

  for (const section of sections) {
    const header = section.match(/^diff --git a\/(.+) b\/(.+)$/m);
    if (!header) {
      continue;
    }

    const oldPath = header[1];
    const newPath = header[2];
    patches.set(newPath, section.trimEnd());
    patches.set(oldPath, section.trimEnd());
  }

  return patches;
}

function countPatchLines(patch: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function formatStatusLine(path: string, status: Status) {
  if (status.ignored) {
    return `!! ${path}`;
  }

  if (status.wtNew && !status.indexNew) {
    return `?? ${path}`;
  }

  return `${statusIndexCode(status)}${statusWorktreeCode(status)} ${path}`;
}

function statusIndexCode(status: Status) {
  if (status.conflicted) {
    return "U";
  }
  if (status.indexRenamed) {
    return "R";
  }
  if (status.indexNew) {
    return "A";
  }
  if (status.indexDeleted) {
    return "D";
  }
  if (status.indexTypechange) {
    return "T";
  }
  return status.indexModified ? "M" : " ";
}

function statusWorktreeCode(status: Status) {
  if (status.conflicted) {
    return "U";
  }
  if (status.wtRenamed) {
    return "R";
  }
  if (status.wtDeleted) {
    return "D";
  }
  if (status.wtTypechange) {
    return "T";
  }
  if (status.wtUnreadable) {
    return "?";
  }
  return status.wtModified ? "M" : " ";
}

function statusNameFromStatus(status: Status): DeltaType {
  if (status.conflicted) {
    return "Conflicted";
  }
  if (status.indexNew || status.wtNew) {
    return "Added";
  }
  if (status.indexDeleted || status.wtDeleted) {
    return "Deleted";
  }
  if (status.indexRenamed || status.wtRenamed) {
    return "Renamed";
  }
  if (status.indexTypechange || status.wtTypechange) {
    return "Typechange";
  }
  if (status.ignored) {
    return "Ignored";
  }
  return status.current ? "Unmodified" : "Modified";
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

function createWorkspaceTerminalSession(input: {
  cols: number;
  cwd: string;
  rows: number;
}): WorkspaceTerminalSession {
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const shell = process.env.SHELL || "/bin/sh";
  const child = pty.spawn(shell, ["-l"], {
    cols: input.cols,
    cwd: input.cwd,
    env: {
      ...process.env,
      COLORTERM: process.env.COLORTERM ?? "truecolor",
      TERM: process.env.TERM && process.env.TERM !== "dumb" ? process.env.TERM : "xterm-256color",
    },
    name: "xterm-256color",
    rows: input.rows,
  });
  const session: WorkspaceTerminalSession = {
    child,
    cols: input.cols,
    output: [],
    rows: input.rows,
    seq: 0,
    sessionId,
    startedAt,
    subscribers: new Set(),
    workspacePath: input.cwd,
  };

  const appendOutput = (data: string) => {
    const chunk = { data, seq: session.seq };
    session.output.push(chunk);
    session.seq += 1;
    if (session.output.length > maxWorkspaceTerminalOutputChunks) {
      session.output.splice(0, session.output.length - maxWorkspaceTerminalOutputChunks);
    }
    notifyWorkspaceTerminalOutput(session, {
      chunks: [chunk],
      nextSeq: session.seq,
    });
  };

  child.onData(appendOutput);
  child.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    session.exitedAt = new Date().toISOString();
    notifyWorkspaceTerminalOutput(session, workspaceTerminalOutputResponse(session, session.seq));
  });

  return session;
}

function closeWorkspaceTerminalSession(session: WorkspaceTerminalSession) {
  if (session.exitedAt) {
    return;
  }
  session.child.kill();
}

function workspaceTerminalOutputResponse(
  session: WorkspaceTerminalSession,
  since: number,
): WorkspaceTerminalOutputResponse {
  return WorkspaceTerminalOutputResponseSchema.parse({
    chunks: session.output.filter((chunk) => chunk.seq >= since),
    exitCode: session.exitCode,
    exitedAt: session.exitedAt,
    nextSeq: session.seq,
  });
}

function subscribeWorkspaceTerminalOutput(
  session: WorkspaceTerminalSession,
  subscriber: WorkspaceTerminalOutputSubscriber,
) {
  session.subscribers.add(subscriber);
  return () => {
    session.subscribers.delete(subscriber);
  };
}

function notifyWorkspaceTerminalOutput(
  session: WorkspaceTerminalSession,
  response: WorkspaceTerminalOutputResponse,
) {
  for (const subscriber of session.subscribers) {
    subscriber(response);
  }
}

async function listWorkspaceFiles(workspacePath: string, query: string, directory: string) {
  const normalizedQuery = query.toLowerCase();
  const isIgnored = await workspaceIgnoreMatcher(workspacePath);
  if (directory && isWorkspacePathIgnored(directory, isIgnored)) {
    return [];
  }
  const filePaths = await workspaceFilePaths(workspacePath, isIgnored);
  const entriesByPath = new Map<
    string,
    { directory: string; kind: "directory" | "file"; name: string; path: string }
  >();

  for (const entry of await workspaceDirectoryEntries(workspacePath, directory, isIgnored)) {
    entriesByPath.set(entry.path, entry);
  }

  for (const path of filePaths) {
    if (!path || path.startsWith("../") || path.includes("/.git/")) {
      continue;
    }

    if (!directory && normalizedQuery) {
      entriesByPath.set(path, {
        directory: dirname(path) === "." ? "" : dirname(path),
        kind: "file",
        name: path.split("/").pop() ?? path,
        path,
      });

      const parts = path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        const directoryPath = parts.slice(0, index).join("/");
        if (isWorkspacePathIgnored(directoryPath, isIgnored)) {
          continue;
        }
        entriesByPath.set(directoryPath, {
          directory: dirname(directoryPath) === "." ? "" : dirname(directoryPath),
          kind: "directory",
          name: parts[index - 1],
          path: directoryPath,
        });
      }
      continue;
    }

    const prefix = directory ? `${directory}/` : "";
    if (!path.startsWith(prefix)) {
      continue;
    }

    const childPath = path.slice(prefix.length);
    const childParts = childPath.split("/").filter(Boolean);
    if (childParts.length === 0) {
      continue;
    }

    if (childParts.length === 1) {
      entriesByPath.set(path, {
        directory,
        kind: "file",
        name: childParts[0],
        path,
      });
    } else {
      const directoryPath = [...(directory ? directory.split("/") : []), childParts[0]].join("/");
      if (isWorkspacePathIgnored(directoryPath, isIgnored)) {
        continue;
      }
      entriesByPath.set(directoryPath, {
        directory,
        kind: "directory",
        name: childParts[0],
        path: directoryPath,
      });
    }
  }

  return [...entriesByPath.values()]
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.path.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((left, right) => {
      const leftScore = workspaceFileScore(left.path, normalizedQuery);
      const rightScore = workspaceFileScore(right.path, normalizedQuery);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, directory || !normalizedQuery ? 160 : 80);
}

async function readWorkspaceFileContent(workspacePath: string, requestedPath: string) {
  const relativePath = normalizeWorkspaceRelativePath(requestedPath);
  if (!relativePath.success) {
    return {
      code: "invalid_workspace_file_path",
      error: relativePath.error,
      status: 400,
      success: false as const,
    };
  }

  const rootPath = resolve(workspacePath);
  const absolutePath = resolve(rootPath, relativePath.path);
  if (!isPathInside(rootPath, absolutePath)) {
    return {
      code: "invalid_workspace_file_path",
      error: "Workspace file path must stay inside the workspace.",
      status: 400,
      success: false as const,
    };
  }

  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return {
      code: "workspace_file_not_found",
      error: "Workspace file was not found.",
      status: 404,
      success: false as const,
    };
  }

  const bytesToRead = Math.min(fileStat.size, WORKSPACE_FILE_PREVIEW_MAX_BYTES);
  const buffer = Buffer.alloc(bytesToRead);
  if (bytesToRead > 0) {
    const handle = await open(absolutePath, "r");
    try {
      await handle.read(buffer, 0, bytesToRead, 0);
    } finally {
      await handle.close();
    }
  }

  const binary = buffer.includes(0);
  const content = binary ? "" : buffer.toString("utf8");
  return {
    content: {
      binary,
      content,
      directory: dirname(relativePath.path) === "." ? "" : dirname(relativePath.path),
      language: languageFromWorkspaceFile(relativePath.path),
      name: basename(relativePath.path),
      path: relativePath.path,
      size: fileStat.size,
      truncated: fileStat.size > WORKSPACE_FILE_PREVIEW_MAX_BYTES,
    },
    success: true as const,
  };
}

async function updateWorkspaceFileContent(
  workspacePath: string,
  input: UpdateWorkspaceFileContentRequest,
) {
  const relativePath = normalizeWorkspaceRelativePath(input.path);
  if (!relativePath.success) {
    return {
      code: "invalid_workspace_file_path",
      error: relativePath.error,
      status: 400,
      success: false as const,
    };
  }

  const rootPath = resolve(workspacePath);
  const absolutePath = resolve(rootPath, relativePath.path);
  if (!isPathInside(rootPath, absolutePath)) {
    return {
      code: "invalid_workspace_file_path",
      error: "Workspace file path must stay inside the workspace.",
      status: 400,
      success: false as const,
    };
  }

  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return {
      code: "workspace_file_not_found",
      error: "Workspace file was not found.",
      status: 404,
      success: false as const,
    };
  }

  await writeFile(absolutePath, input.content, "utf8");
  return readWorkspaceFileContent(workspacePath, relativePath.path);
}

function normalizeWorkspaceRelativePath(requestedPath: string) {
  const normalized = requestedPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (!normalized) {
    return { error: "Workspace file path is required.", success: false as const };
  }
  if (isAbsolute(normalized)) {
    return {
      error: "Workspace file path must be relative.",
      success: false as const,
    };
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment === ".git")) {
    return {
      error: "Workspace file path contains an unsupported segment.",
      success: false as const,
    };
  }

  return { path: segments.join("/"), success: true as const };
}

function normalizeWorkspaceDirectoryPath(requestedPath: string) {
  const normalized = requestedPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) {
    return { path: "", success: true as const };
  }
  if (isAbsolute(normalized)) {
    return {
      error: "Workspace directory path must be relative.",
      success: false as const,
    };
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment === ".git")) {
    return {
      error: "Workspace directory path contains an unsupported segment.",
      success: false as const,
    };
  }

  return { path: segments.join("/"), success: true as const };
}

function parentWorkspaceDirectory(directory: string) {
  if (!directory) {
    return null;
  }
  const parent = dirname(directory);
  return parent === "." ? "" : parent;
}

function isPathInside(rootPath: string, targetPath: string) {
  const pathFromRoot = relative(rootPath, targetPath);
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}

function languageFromWorkspaceFile(path: string) {
  const name = basename(path).toLowerCase();
  const extension = extname(name).replace(/^\./, "");
  if (name === "dockerfile") {
    return "dockerfile";
  }
  if (name === "makefile") {
    return "make";
  }
  if (name === "package.json") {
    return "json";
  }

  return (
    {
      cjs: "javascript",
      css: "css",
      diff: "diff",
      go: "go",
      htm: "html",
      html: "html",
      java: "java",
      js: "javascript",
      json: "json",
      jsx: "jsx",
      kt: "kotlin",
      lock: "yaml",
      log: "text",
      md: "markdown",
      mdx: "markdown",
      mjs: "javascript",
      plist: "xml",
      py: "python",
      rb: "ruby",
      rs: "rust",
      sh: "bash",
      swift: "swift",
      ts: "typescript",
      tsx: "tsx",
      txt: "text",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
    }[extension] ?? extension
  );
}

async function workspaceFilePaths(workspacePath: string, isIgnored: (path: string) => boolean) {
  try {
    const output = await git(workspacePath, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      .filter((path) => !isWorkspacePathIgnored(path, isIgnored));
  } catch {
    return recursiveWorkspaceFilePaths(workspacePath, isIgnored);
  }
}

async function workspaceDirectoryEntries(
  workspacePath: string,
  directory: string,
  isIgnored: (path: string) => boolean,
) {
  const rootPath = resolve(workspacePath);
  const absoluteDirectory = resolve(rootPath, directory);
  if (absoluteDirectory !== rootPath && !isPathInside(rootPath, absoluteDirectory)) {
    return [];
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== ".git")
    .map((entry) => {
      const path = [...(directory ? directory.split("/") : []), entry.name].join("/");
      return {
        directory,
        kind: "directory" as const,
        name: entry.name,
        path,
      };
    })
    .filter((entry) => !isWorkspacePathIgnored(entry.path, isIgnored));
}

async function recursiveWorkspaceFilePaths(rootPath: string, isIgnored: (path: string) => boolean) {
  const ignoredDirectories = new Set([".git", ".expo", ".turbo", "dist", "node_modules"]);
  const results: string[] = [];

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(rootPath, absolutePath).split("\\").join("/");
      if (isWorkspacePathIgnored(relativePath, isIgnored)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  await visit(rootPath);
  return results;
}

async function workspaceIgnoreMatcher(workspacePath: string) {
  const gitignorePath = join(workspacePath, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8").catch(() => "");
  const matchers = gitignore
    .split(/\r?\n/)
    .map((line) => gitignorePatternMatcher(line))
    .filter((matcher): matcher is (path: string) => boolean => Boolean(matcher));

  return (path: string) => matchers.some((matcher) => matcher(path.split("\\").join("/")));
}

function isWorkspacePathIgnored(path: string, isIgnored: (path: string) => boolean) {
  const normalizedPath = path.replace(/^\/+/, "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalizedPath) {
    return false;
  }
  if (isIgnored(normalizedPath) || isIgnored(`${normalizedPath}/`)) {
    return true;
  }
  const parts = normalizedPath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const ancestorPath = parts.slice(0, index).join("/");
    if (isIgnored(ancestorPath) || isIgnored(`${ancestorPath}/`)) {
      return true;
    }
  }
  return false;
}

function gitignorePatternMatcher(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return undefined;
  }

  const directoryOnly = trimmed.endsWith("/");
  const anchored = trimmed.startsWith("/");
  const pattern = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) {
    return undefined;
  }

  const matcher = gitignoreGlobMatcher(pattern);
  const hasSlash = pattern.includes("/");

  return (path: string) => {
    const normalizedPath = path.replace(/^\/+/, "");
    const candidates = anchored || hasSlash ? [normalizedPath] : normalizedPath.split("/");

    return candidates.some((candidate) => {
      if (directoryOnly) {
        return matcher(candidate);
      }
      return matcher(candidate);
    });
  };
}

function gitignoreGlobMatcher(pattern: string) {
  const expression = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*")
    .replace(/\?/g, "[^/]");
  const regex = new RegExp(`^${expression}(?:/.*)?$`);
  return (path: string) => regex.test(path);
}

function workspaceFileScore(path: string, query: string) {
  if (!query) {
    return path.split("/").length;
  }
  const lowerPath = path.toLowerCase();
  const name = lowerPath.split("/").pop() ?? lowerPath;
  if (name === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (lowerPath.startsWith(query)) {
    return 2;
  }
  if (lowerPath.includes(`/${query}`)) {
    return 3;
  }
  return 4;
}

function validationError(error: z.ZodError): ErrorResponse {
  return apiError(
    "invalid_request",
    "Request body did not match the Codex Relay API schema.",
    error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
  );
}

function apiError(code: string, message: string, issues?: string[]): ErrorResponse {
  return {
    error: {
      code,
      message,
      issues,
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Codex run failed.";
}
