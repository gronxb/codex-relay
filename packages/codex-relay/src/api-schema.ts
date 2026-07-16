import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime();

export const ThreadStateSchema = z.enum(["idle", "running", "completed", "failed"]);

export const ChatMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "status",
  "tool",
  "reasoning",
  "error",
]);

export const ChatMessageStateSchema = z.enum(["streaming", "completed", "failed"]);
export const ChatMessageKindSchema = z.enum([
  "chat",
  "thinking",
  "toolActivity",
  "commandExecution",
  "fileChange",
  "plan",
  "approvalRequest",
  "structuredUserInput",
  "subagentAction",
  "webSearch",
  "unknown",
]);
export const ApprovalModeSchema = z.enum(["on-request", "on-failure", "never"]);
export const RuntimeModeSchema = z.enum(["default", "auto", "full-access", "on-request"]);
export const SandboxModeSchema = z.enum(["workspace-write", "danger-full-access", "read-only"]);
export const KnownReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export const ReasoningEffortSchema = z.string().trim().min(1);
export const ThreadCollaborationModeSchema = z.enum(["default", "plan"]);
export const ThreadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

export const VersionResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("codex-relay-server"),
  packageName: z.literal("codex-relay"),
  packageVersion: z.string().min(1),
});

export const ThreadRunOptionsSchema = z.object({
  model: z.string().trim().min(1).optional(),
  serviceTier: z.string().trim().min(1).optional(),
  runtimeMode: RuntimeModeSchema.optional(),
  approvalPolicy: ApprovalModeSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  collaborationMode: ThreadCollaborationModeSchema.optional(),
});

export const RuntimePreferencesSchema = z.object({
  model: z.string().trim().min(1).optional(),
  serviceTier: z.string().trim().min(1).optional(),
  runtimeMode: RuntimeModeSchema.default("default"),
  reasoningEffort: ReasoningEffortSchema.optional(),
});

export const RuntimePreferencesByWorkspacePathSchema = z.record(
  z.string().trim().min(1),
  RuntimePreferencesSchema,
);

export const UpdateRuntimePreferencesRequestSchema = z.object({
  model: z.string().trim().min(1).nullable().optional(),
  serviceTier: z.string().trim().min(1).nullable().optional(),
  runtimeMode: RuntimeModeSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.nullable().optional(),
  threadId: z.string().trim().min(1).optional(),
  workspacePath: z.string().trim().min(1).optional(),
});

export const RuntimePreferencesResponseSchema = z.object({
  preferences: RuntimePreferencesSchema,
  runtimePreferencesByWorkspacePath: RuntimePreferencesByWorkspacePathSchema.default({}),
  threadId: z.string().trim().min(1).optional(),
  workspacePath: z.string().trim().min(1).optional(),
});

export const PushNotificationIntentSchema = z.enum(["turn_terminal", "action_required"]);

export const PushNotificationPreferencesSchema = z.object({
  actionRequired: z.boolean(),
  turnTerminal: z.boolean(),
});

export const RegisterPushNotificationRequestSchema = z.object({
  expoPushToken: z
    .string()
    .trim()
    .regex(/^(?:Expo|Exponent)PushToken\[[^\]\r\n]{1,512}\]$/),
  platform: z.enum(["android", "ios"]),
  preferences: PushNotificationPreferencesSchema,
});

export const PushNotificationSettingsResponseSchema = z.object({
  preferences: PushNotificationPreferencesSchema,
  registered: z.boolean(),
});

export const CodexModelSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().default(false),
  defaultReasoningEffort: ReasoningEffortSchema.optional(),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).default([]),
  reasoningEffortOptions: z
    .array(
      z.object({
        reasoningEffort: ReasoningEffortSchema,
        description: z.string().optional(),
      }),
    )
    .default([]),
  serviceTiers: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
});

export const AgentSkillSourceSchema = z.enum(["workspace", "personal", "system", "plugin"]);

export const AgentSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  path: z.string().trim().min(1),
  source: AgentSkillSourceSchema,
  sourceLabel: z.string().min(1),
});

export const ContextWindowUsageSchema = z.object({
  tokensUsed: z.number().int().nonnegative(),
  tokenLimit: z.number().int().positive(),
});

export const RateLimitWindowSchema = z.object({
  usedPercent: z.number().int().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullable().optional(),
  resetsAt: z.number().int().positive().nullable().optional(),
});

export const RateLimitBucketSchema = z.object({
  limitId: z.string().min(1),
  limitName: z.string().nullable().optional(),
  planType: z.string().nullable().optional(),
  primary: RateLimitWindowSchema.nullable().optional(),
  secondary: RateLimitWindowSchema.nullable().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
});

export const RateLimitsResponseSchema = z.object({
  buckets: z.array(RateLimitBucketSchema),
});

export const ThreadContextWindowResponseSchema = z.object({
  threadId: z.string().min(1),
  usage: ContextWindowUsageSchema.nullable(),
  rolloutPath: z.string().nullable().optional(),
});

export const ThreadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string().trim().min(1),
  status: ThreadGoalStatusSchema,
  tokenBudget: z.number().int().positive().nullable(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

const PromptAttachmentBaseSchema = z.object({
  type: z.literal("image"),
  mimeType: z.string().trim().startsWith("image/").optional(),
  name: z.string().trim().min(1).max(160).optional(),
  path: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
});

export const PromptAttachmentSchema = PromptAttachmentBaseSchema.refine(
  (attachment) => Boolean(attachment.path || attachment.url),
  {
    message: "Image attachments require path or url.",
  },
);

export const PromptSkillSchema = AgentSkillSchema.pick({
  name: true,
  path: true,
});

export const PromptContextSchema = z.object({
  attachments: z.array(PromptAttachmentSchema).max(6).default([]),
  skills: z.array(PromptSkillSchema).max(12).default([]),
});

export const PromptContextInputSchema = PromptContextSchema.partial();

export const PromptAttachmentSummarySchema = PromptAttachmentBaseSchema.pick({
  mimeType: true,
  name: true,
  path: true,
  type: true,
  url: true,
});

export const ChatMessagePromptDetailsSchema = z
  .object({
    attachments: z.array(PromptAttachmentSummarySchema).max(6).optional(),
  })
  .passthrough();

export const WorkspaceFileMentionSchema = z.object({
  directory: z.string(),
  kind: z.enum(["directory", "file"]),
  name: z.string().min(1),
  path: z.string().min(1),
});

export const ListWorkspaceFilesResponseSchema = z.object({
  directory: z.string(),
  files: z.array(WorkspaceFileMentionSchema),
  parentDirectory: z.string().nullable(),
  query: z.string(),
  workspacePath: z.string().min(1),
});

export const WorkspaceFileContentResponseSchema = z.object({
  binary: z.boolean(),
  content: z.string(),
  directory: z.string(),
  language: z.string(),
  name: z.string().min(1),
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  workspacePath: z.string().min(1),
});

export const UpdateWorkspaceFileContentRequestSchema = z.object({
  content: z.string().max(1024 * 1024),
  path: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1).optional(),
});

export const PendingInputRequestOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

export const PendingInputRequestQuestionSchema = z.object({
  header: z.string().optional(),
  id: z.string().min(1),
  options: z.array(PendingInputRequestOptionSchema).optional(),
  question: z.string().min(1),
});

export const PendingInputRequestSchema = z.object({
  id: z.string().min(1),
  questions: z.array(PendingInputRequestQuestionSchema),
  threadId: z.string().min(1),
  turnId: z.string().optional(),
});

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: ChatMessageRoleSchema,
  kind: ChatMessageKindSchema.default("chat"),
  content: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  turnId: z.string().optional(),
  state: ChatMessageStateSchema.optional(),
});

export const ThreadSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  state: ThreadStateSchema,
  model: z.string().optional(),
  serviceTier: z.string().optional(),
  runtimeMode: RuntimeModeSchema.optional(),
  approvalPolicy: ApprovalModeSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  collaborationMode: ThreadCollaborationModeSchema.optional(),
  cwd: z.string().optional(),
  source: z.string().optional(),
  messageCount: z.number().int().nonnegative().default(0),
  lastMessagePreview: z.string().optional(),
  lastActivityAt: IsoDateTimeSchema.optional(),
  lastPrompt: z.string().optional(),
  lastResult: z.string().optional(),
  lastError: z.string().optional(),
  goal: ThreadGoalSchema.nullable().optional(),
});

export const StatusResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("codex-relay-server"),
  sdkAvailable: z.boolean(),
  machineName: z.string().min(1),
  workspacePath: z.string(),
  threadCount: z.number().int().nonnegative(),
  appServerAvailable: z.boolean().default(false),
  preferences: RuntimePreferencesSchema.default({ runtimeMode: "default" }),
  runtimePreferencesByWorkspacePath: RuntimePreferencesByWorkspacePathSchema.default({}),
});

export const WorkspaceDirectoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const ListWorkspaceDirectoriesResponseSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().min(1),
  parentPath: z.string().min(1).nullable(),
  directories: z.array(WorkspaceDirectoryEntrySchema),
});

export const WorkspaceChangesResponseSchema = z.object({
  workspacePath: z.string().min(1),
  status: z.string(),
  diff: z.string(),
  hasChanges: z.boolean(),
  currentBranch: z.string().nullable().default(null),
  branches: z
    .array(
      z.object({
        current: z.boolean().default(false),
        name: z.string().min(1),
      }),
    )
    .default([]),
  stats: z
    .object({
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      filesChanged: z.number().int().nonnegative(),
    })
    .default({ additions: 0, deletions: 0, filesChanged: 0 }),
  files: z
    .array(
      z.object({
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        isBinary: z.boolean().default(false),
        oldPath: z.string().nullable(),
        path: z.string().min(1),
        patch: z.string(),
        stagedStatus: z.string().nullable(),
        status: z.string().min(1),
        worktreeStatus: z.string().nullable(),
      }),
    )
    .default([]),
});

export const WorkspaceSelectionRequestSchema = z.object({
  workspacePath: z.string().trim().min(1).optional(),
});

export const CheckoutWorkspaceBranchRequestSchema = WorkspaceSelectionRequestSchema.extend({
  branch: z
    .string()
    .trim()
    .min(1)
    .refine((branch) => !branch.startsWith("-"), "Branch name cannot start with '-'."),
});

export const CommitPushWorkspaceRequestSchema = WorkspaceSelectionRequestSchema.extend({
  message: z.string().trim().min(1).max(240),
});

export const WorkspaceGitActionResponseSchema = z.object({
  branch: z.string().nullable(),
  message: z.string().min(1),
  output: z.string().default(""),
});

export const WORKSPACE_PREVIEW_TAB_VALUES = ["git", "files", "markdown", "web", "ssh"] as const;

export const WorkspacePreviewTabSchema = z.enum(WORKSPACE_PREVIEW_TAB_VALUES);

export const WorkspaceMarkdownPreviewTargetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1).optional(),
});

export const WORKSPACE_PREVIEW_OPEN_PROTOCOL = "workspace-preview.open" as const;

export const WebPreviewTargetSchema = z.object({
  kind: z.literal("web"),
  url: z.string().url(),
  port: z.number().int().positive(),
  label: z.string().min(1).optional(),
  source: z.enum(["detected-port", "codex-output", "user-entered"]),
  confidence: z.enum(["low", "medium", "high"]),
  detectedAt: IsoDateTimeSchema,
});

const WorkspacePreviewOpenBaseSchema = z.object({
  protocol: z.literal(WORKSPACE_PREVIEW_OPEN_PROTOCOL),
  workspacePath: z.string().trim().min(1).optional(),
});

export const WorkspacePreviewNavigationRequestSchema = z.discriminatedUnion("tab", [
  WorkspacePreviewOpenBaseSchema.extend({
    tab: z.literal("git"),
  }),
  WorkspacePreviewOpenBaseSchema.extend({
    tab: z.literal("files"),
    target: z
      .object({
        path: z.string().trim().min(1).optional(),
      })
      .optional(),
  }),
  WorkspacePreviewOpenBaseSchema.extend({
    tab: z.literal("markdown"),
    target: WorkspaceMarkdownPreviewTargetSchema,
  }),
  WorkspacePreviewOpenBaseSchema.extend({
    tab: z.literal("web"),
    target: WebPreviewTargetSchema.optional(),
  }),
  WorkspacePreviewOpenBaseSchema.extend({
    tab: z.literal("ssh"),
  }),
]);

export const WorkspaceTerminalStartRequestSchema = WorkspaceSelectionRequestSchema.extend({
  cols: z.number().int().min(2).max(300).default(80),
  rows: z.number().int().min(2).max(120).default(24),
});

export const WorkspaceTerminalOutputChunkSchema = z.object({
  data: z.string(),
  seq: z.number().int().nonnegative(),
});

export const WorkspaceTerminalSessionResponseSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  sessionId: z.string().min(1),
  startedAt: IsoDateTimeSchema,
  workspacePath: z.string().min(1),
});

export const WorkspaceTerminalOutputResponseSchema = z.object({
  chunks: z.array(WorkspaceTerminalOutputChunkSchema),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: IsoDateTimeSchema.optional(),
  nextSeq: z.number().int().nonnegative(),
});

export const WorkspaceTerminalInputRequestSchema = z
  .union([
    z.object({ data: z.string().min(1) }),
    z.object({ input: z.string().min(1) }),
    z.string().min(1),
  ])
  .transform((payload) => ({
    data: typeof payload === "string" ? payload : "data" in payload ? payload.data : payload.input,
  }));

export const WorkspaceTerminalResizeRequestSchema = z.object({
  cols: z.number().int().min(2).max(300),
  rows: z.number().int().min(2).max(120),
});

export const WorkspaceTailscaleServeRequestSchema = z.object({
  url: z.string().url(),
});

export const WorkspaceTailscaleServeResponseSchema = z.object({
  port: z.number().int().positive(),
  url: z.string().url(),
});

export const PairRequestSchema = z.object({
  clientSessionId: z.string().trim().min(1).max(120).optional(),
  clientName: z.string().trim().min(1).max(80).optional(),
  secure: z
    .object({
      clientEphemeralPublicKey: z.string().min(1),
      clientNonce: z.string().min(1),
      protocolVersion: z.literal(1),
    })
    .optional(),
});

export const PairResponseSchema = z.object({
  approvalCode: z.string().min(1).optional(),
  approvalExpiresAt: IsoDateTimeSchema.optional(),
  clientToken: z.string().min(1).optional(),
  clientTokenExpiresAt: IsoDateTimeSchema.optional(),
  secure: z
    .object({
      encryptedPayload: z.string().min(1),
      keyEpoch: z.number().int().nonnegative(),
      protocolVersion: z.literal(1),
      serverEphemeralPublicKey: z.string().min(1),
      serverNonce: z.string().min(1),
      serverSignature: z.string().min(1),
    })
    .optional(),
});

export const EncryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1),
  counter: z.number().int().nonnegative(),
  keyEpoch: z.number().int().nonnegative(),
  protocolVersion: z.literal(1),
  sender: z.enum(["mobile", "server"]),
});

export const PairEncryptedPayloadSchema = z.object({
  clientToken: z.string().min(1),
  clientTokenExpiresAt: IsoDateTimeSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.string()).optional(),
  }),
});

export const CreateThreadRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    workspacePath: z.string().trim().min(1).optional(),
  })
  .merge(PromptContextInputSchema)
  .merge(ThreadRunOptionsSchema.partial());

export const CreateThreadResponseSchema = z.object({
  thread: ThreadSummarySchema,
  messages: z.array(ChatMessageSchema).default([]),
  result: z.string().optional(),
});

export const RunThreadRequestSchema = z
  .object({
    prompt: z.string().trim().min(1),
  })
  .merge(PromptContextInputSchema)
  .merge(ThreadRunOptionsSchema.partial());

export const StreamThreadRunRequestSchema = RunThreadRequestSchema.or(
  ThreadRunOptionsSchema.partial()
    .extend({
      prompt: z.string().trim().min(1).optional(),
    })
    .merge(PromptContextInputSchema),
);

export const RunThreadResponseSchema = z.object({
  thread: ThreadSummarySchema,
  messages: z.array(ChatMessageSchema).default([]),
  result: z.string(),
});

export const ImageAttachmentUploadResponseSchema = z.object({
  attachments: z
    .array(
      PromptAttachmentBaseSchema.pick({
        mimeType: true,
        name: true,
        path: true,
        type: true,
        url: true,
      }).required({
        path: true,
        url: true,
      }),
    )
    .max(6),
});

export const QueuedThreadInputSchema = z.object({
  attachments: PromptContextSchema.shape.attachments,
  id: z.string().min(1),
  prompt: z.string().min(1),
  skills: PromptContextSchema.shape.skills,
});

export const SubmitThreadInputResponseSchema = z.object({
  acceptedAs: z.enum(["steering", "queued"]),
  input: QueuedThreadInputSchema.optional(),
  queueLength: z.number().int().nonnegative(),
  thread: ThreadSummarySchema,
});

export const QueuedThreadInputActionResponseSchema = z.object({
  input: QueuedThreadInputSchema.optional(),
  queueLength: z.number().int().nonnegative(),
  thread: ThreadSummarySchema,
});

export const UpdateThreadGoalRequestSchema = z
  .object({
    objective: z.string().trim().min(1).optional(),
    status: ThreadGoalStatusSchema.optional(),
    tokenBudget: z.number().int().positive().nullable().optional(),
  })
  .refine((input) => input.objective || input.status || input.tokenBudget !== undefined, {
    message: "At least one goal field is required.",
  });

export const ThreadGoalResponseSchema = z.object({
  goal: ThreadGoalSchema.nullable(),
  thread: ThreadSummarySchema,
});

export const InterruptThreadRunResponseSchema = z.object({
  thread: ThreadSummarySchema,
});

export const ListQueuedThreadInputsResponseSchema = z.object({
  inputs: z.array(QueuedThreadInputSchema),
  queueLength: z.number().int().nonnegative(),
});

export const ApprovalDecisionSchema = z.enum(["approve", "approve-for-session", "deny", "cancel"]);

export const ResolveApprovalRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
  answers: z.array(z.string()).optional(),
});

export const ResolveApprovalResponseSchema = z.object({
  ok: z.boolean(),
});

export const ListThreadsResponseSchema = z.object({
  threads: z.array(ThreadSummarySchema),
  source: z.enum(["app-server", "memory"]).default("memory"),
});

export const ArchiveThreadResponseSchema = z.object({
  archivedThreadId: z.string().min(1),
  threads: z.array(ThreadSummarySchema),
  source: z.enum(["app-server", "memory"]).default("memory"),
});

export const ListModelsResponseSchema = z.object({
  models: z.array(CodexModelSchema),
});

export const ListSkillsResponseSchema = z.object({
  skills: z.array(AgentSkillSchema),
});

export const ThreadDetailResponseSchema = z.object({
  thread: ThreadSummarySchema,
  messages: z.array(ChatMessageSchema),
  pendingInputRequests: z.array(PendingInputRequestSchema).default([]),
});

export const ThreadMessageDetailFieldSchema = z.enum(["output", "patch"]);

export const ThreadMessageDetailResponseSchema = z.object({
  field: ThreadMessageDetailFieldSchema,
  messageId: z.string().min(1),
  originalLength: z.number().int().nonnegative(),
  value: z.string(),
});

export const StreamThreadRunEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread.message.created"),
    thread: ThreadSummarySchema,
    message: ChatMessageSchema,
  }),
  z.object({
    type: z.literal("thread.message.delta"),
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("thread.message.completed"),
    thread: ThreadSummarySchema,
    message: ChatMessageSchema,
  }),
  z.object({
    type: z.literal("thread.state.changed"),
    thread: ThreadSummarySchema,
  }),
  z.object({
    type: z.literal("thread.goal.updated"),
    thread: ThreadSummarySchema,
    goal: ThreadGoalSchema.nullable(),
  }),
  z.object({
    type: z.literal("thread.error"),
    thread: ThreadSummarySchema.optional(),
    error: ErrorResponseSchema.shape.error,
  }),
  z.object({
    type: z.literal("thread.preview_target.detected"),
    threadId: z.string().min(1),
    target: WebPreviewTargetSchema,
  }),
  z.object({
    type: z.literal("thread.input_request.created"),
    request: PendingInputRequestSchema,
    thread: ThreadSummarySchema,
  }),
  z.object({
    type: z.literal("thread.input_request.resolved"),
    requestId: z.string().min(1),
    threadId: z.string().min(1),
  }),
]);

export type ThreadState = z.infer<typeof ThreadStateSchema>;
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;
export type ChatMessageState = z.infer<typeof ChatMessageStateSchema>;
export type ChatMessageKind = z.infer<typeof ChatMessageKindSchema>;
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;
export type KnownReasoningEffort = z.infer<typeof KnownReasoningEffortSchema>;
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type SandboxMode = z.infer<typeof SandboxModeSchema>;
export type ThreadCollaborationMode = z.infer<typeof ThreadCollaborationModeSchema>;
export type ThreadRunOptions = z.infer<typeof ThreadRunOptionsSchema>;
export type CodexModel = z.infer<typeof CodexModelSchema>;
export type AgentSkillSource = z.infer<typeof AgentSkillSourceSchema>;
export type AgentSkill = z.infer<typeof AgentSkillSchema>;
export type PromptSkill = z.infer<typeof PromptSkillSchema>;
export type PromptContext = z.infer<typeof PromptContextSchema>;
export type PromptAttachmentSummary = z.infer<typeof PromptAttachmentSummarySchema>;
export type ChatMessagePromptDetails = z.infer<typeof ChatMessagePromptDetailsSchema>;
export type RuntimePreferences = z.infer<typeof RuntimePreferencesSchema>;
export type RuntimePreferencesByWorkspacePath = z.infer<
  typeof RuntimePreferencesByWorkspacePathSchema
>;
export type RuntimePreferencesResponse = z.infer<typeof RuntimePreferencesResponseSchema>;
export type PushNotificationIntent = z.infer<typeof PushNotificationIntentSchema>;
export type PushNotificationPreferences = z.infer<typeof PushNotificationPreferencesSchema>;
export type RegisterPushNotificationRequest = z.infer<typeof RegisterPushNotificationRequestSchema>;
export type PushNotificationSettingsResponse = z.infer<
  typeof PushNotificationSettingsResponseSchema
>;
export type ContextWindowUsage = z.infer<typeof ContextWindowUsageSchema>;
export type RateLimitBucket = z.infer<typeof RateLimitBucketSchema>;
export type RateLimitWindow = z.infer<typeof RateLimitWindowSchema>;
export type RateLimitsResponse = z.infer<typeof RateLimitsResponseSchema>;
export type ThreadContextWindowResponse = z.infer<typeof ThreadContextWindowResponseSchema>;
export type ThreadGoal = z.infer<typeof ThreadGoalSchema>;
export type ThreadGoalResponse = z.infer<typeof ThreadGoalResponseSchema>;
export type ThreadGoalStatus = z.infer<typeof ThreadGoalStatusSchema>;
export type PromptAttachment = z.infer<typeof PromptAttachmentSchema>;
export type PendingInputRequest = z.infer<typeof PendingInputRequestSchema>;
export type PendingInputRequestQuestion = z.infer<typeof PendingInputRequestQuestionSchema>;
export type PendingInputRequestOption = z.infer<typeof PendingInputRequestOptionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type WorkspaceDirectoryEntry = z.infer<typeof WorkspaceDirectoryEntrySchema>;
export type ListWorkspaceDirectoriesResponse = z.infer<
  typeof ListWorkspaceDirectoriesResponseSchema
>;
export type WorkspaceChangesResponse = z.infer<typeof WorkspaceChangesResponseSchema>;
export type WorkspaceSelectionRequest = z.infer<typeof WorkspaceSelectionRequestSchema>;
export type CheckoutWorkspaceBranchRequest = z.infer<typeof CheckoutWorkspaceBranchRequestSchema>;
export type CommitPushWorkspaceRequest = z.infer<typeof CommitPushWorkspaceRequestSchema>;
export type WorkspaceGitActionResponse = z.infer<typeof WorkspaceGitActionResponseSchema>;
export type WorkspacePreviewTab = z.infer<typeof WorkspacePreviewTabSchema>;
export type WorkspaceMarkdownPreviewTarget = z.infer<typeof WorkspaceMarkdownPreviewTargetSchema>;
export type WorkspacePreviewNavigationRequest = z.infer<
  typeof WorkspacePreviewNavigationRequestSchema
>;
export type WorkspaceTerminalStartRequest = z.infer<typeof WorkspaceTerminalStartRequestSchema>;
export type WorkspaceTerminalSessionResponse = z.infer<
  typeof WorkspaceTerminalSessionResponseSchema
>;
export type WorkspaceTerminalOutputResponse = z.infer<typeof WorkspaceTerminalOutputResponseSchema>;
export type WorkspaceTerminalInputRequest = z.infer<typeof WorkspaceTerminalInputRequestSchema>;
export type WorkspaceTerminalResizeRequest = z.infer<typeof WorkspaceTerminalResizeRequestSchema>;
export type WorkspaceTailscaleServeRequest = z.infer<typeof WorkspaceTailscaleServeRequestSchema>;
export type WorkspaceTailscaleServeResponse = z.infer<typeof WorkspaceTailscaleServeResponseSchema>;
export type WebPreviewTarget = z.infer<typeof WebPreviewTargetSchema>;
export type PairRequest = z.infer<typeof PairRequestSchema>;
export type PairResponse = z.infer<typeof PairResponseSchema>;
export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;
export type PairEncryptedPayload = z.infer<typeof PairEncryptedPayloadSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;
export type RunThreadRequest = z.infer<typeof RunThreadRequestSchema>;
export type StreamThreadRunRequest = z.infer<typeof StreamThreadRunRequestSchema>;
export type RunThreadResponse = z.infer<typeof RunThreadResponseSchema>;
export type ImageAttachmentUploadResponse = z.infer<typeof ImageAttachmentUploadResponseSchema>;
export type QueuedThreadInput = z.infer<typeof QueuedThreadInputSchema>;
export type SubmitThreadInputResponse = z.infer<typeof SubmitThreadInputResponseSchema>;
export type QueuedThreadInputActionResponse = z.infer<typeof QueuedThreadInputActionResponseSchema>;
export type UpdateThreadGoalRequest = z.infer<typeof UpdateThreadGoalRequestSchema>;
export type InterruptThreadRunResponse = z.infer<typeof InterruptThreadRunResponseSchema>;
export type ListQueuedThreadInputsResponse = z.infer<typeof ListQueuedThreadInputsResponseSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ResolveApprovalRequest = z.infer<typeof ResolveApprovalRequestSchema>;
export type ResolveApprovalResponse = z.infer<typeof ResolveApprovalResponseSchema>;
export type UpdateRuntimePreferencesRequest = z.infer<typeof UpdateRuntimePreferencesRequestSchema>;
export type VersionResponse = z.infer<typeof VersionResponseSchema>;
export type ListThreadsResponse = z.infer<typeof ListThreadsResponseSchema>;
export type ArchiveThreadResponse = z.infer<typeof ArchiveThreadResponseSchema>;
export type ListModelsResponse = z.infer<typeof ListModelsResponseSchema>;
export type ListSkillsResponse = z.infer<typeof ListSkillsResponseSchema>;
export type ListWorkspaceFilesResponse = z.infer<typeof ListWorkspaceFilesResponseSchema>;
export type WorkspaceFileContentResponse = z.infer<typeof WorkspaceFileContentResponseSchema>;

export function normalizePromptContext(input?: {
  attachments?: PromptAttachment[] | null;
  skills?: PromptSkill[] | null;
}): PromptContext {
  return PromptContextSchema.parse({
    attachments: input?.attachments ? [...input.attachments] : [],
    skills: input?.skills ? [...input.skills] : [],
  });
}

export function chatMessageDetailsFromPromptContext(
  input: {
    attachments?: PromptAttachment[] | null;
  },
  extraDetails: Record<string, unknown> = {},
) {
  const context = normalizePromptContext(input);
  const details: Record<string, unknown> = { ...extraDetails };

  if (context.attachments.length > 0) {
    details.attachments = context.attachments.map(({ mimeType, name, path, type, url }) => ({
      mimeType,
      name,
      path,
      type,
      url,
    }));
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

export function promptSkillDisplayName(skill: PromptSkill) {
  const parts = skill.name.split(/[-_:]/).filter(Boolean);
  const displayParts =
    parts.length === 2 && parts[0]?.toLowerCase() === parts[1]?.toLowerCase() ? [parts[1]] : parts;
  return displayParts.filter(Boolean).map(formatPromptSkillDisplayPart).join(" ");
}

function formatPromptSkillDisplayPart(part: string) {
  const knownDisplayParts: Record<string, string> = {
    api: "API",
    github: "GitHub",
    ios: "iOS",
    openai: "OpenAI",
    ota: "OTA",
    pr: "PR",
    qa: "QA",
    ui: "UI",
    ux: "UX",
  };
  return knownDisplayParts[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}

export function promptSkillMentionLabel(skill: PromptSkill) {
  return `$${skill.name}`;
}

export function promptSkillMentionMarkdown(skill: PromptSkill) {
  return `[${escapePromptSkillMarkdownLabel(promptSkillMentionLabel(skill))}](${skill.path})`;
}

export function promptMarkdownWithSkills(prompt: string, skills: PromptSkill[]) {
  const seenSkills = new Set<string>();
  const markdown = promptMarkdownWithInlineSkills(prompt, skills, seenSkills).trim();
  const missingSkillMentions = skills
    .filter((skill) => !seenSkills.has(promptSkillKey(skill)))
    .map((skill) => promptSkillMentionMarkdown(skill))
    .join(" ");
  return [markdown, missingSkillMentions]
    .filter(Boolean)
    .join(markdown.includes("\n") ? "\n\n" : " ");
}

export function promptSkillMentionTextCandidates(skill: PromptSkill) {
  const displayName = promptSkillDisplayName(skill);
  return [promptSkillMentionLabel(skill), skill.name, `$${displayName}`, displayName];
}

export function isPromptSkillMarkdownMention(label: string, url: string, skills: PromptSkill[]) {
  const mentionText = unescapePromptSkillMarkdownLabel(label).trim();
  const normalizedUrl = safeDecodePromptSkillMarkdownUrl(url);
  return skills.some(
    (skill) =>
      normalizedUrl === skill.path && promptSkillMentionTextCandidates(skill).includes(mentionText),
  );
}

export function stripPromptSkillMentions(prompt: string, skills: PromptSkill[]) {
  let nextPrompt = prompt.replace(
    /\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g,
    (match, label: string, url: string) =>
      isPromptSkillMarkdownMention(label, url, skills) ? "" : match,
  );
  for (const skill of skills) {
    for (const candidate of promptSkillMentionTextCandidates(skill)) {
      nextPrompt = nextPrompt.replace(
        new RegExp(`(^|\\s)${escapePromptSkillRegExp(candidate)}(?=\\s|$)`, "g"),
        "$1",
      );
    }
  }
  return nextPrompt.replace(/\s{2,}/g, " ").trim();
}

function promptMarkdownWithInlineSkills(
  prompt: string,
  skills: PromptSkill[],
  seenSkills: Set<string>,
) {
  const linkRegex = /\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g;
  let nextPrompt = prompt.replace(linkRegex, (match, label: string, url: string) => {
    const skill = skills.find((candidate) => isPromptSkillMarkdownMention(label, url, [candidate]));
    if (!skill) {
      return match;
    }
    seenSkills.add(promptSkillKey(skill));
    return promptSkillMentionMarkdown(skill);
  });

  for (const skill of skills) {
    for (const candidate of promptSkillMentionTextCandidates(skill)) {
      nextPrompt = replacePromptSkillTextMention(nextPrompt, candidate, skill, seenSkills);
    }
  }
  return nextPrompt;
}

function replacePromptSkillTextMention(
  prompt: string,
  candidate: string,
  skill: PromptSkill,
  seenSkills: Set<string>,
) {
  const linkRegex = /\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g;
  let result = "";
  let cursor = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(prompt))) {
    result += replacePromptSkillTextMentionSegment(
      prompt.slice(cursor, linkMatch.index),
      candidate,
      skill,
      seenSkills,
    );
    result += linkMatch[0];
    cursor = linkMatch.index + linkMatch[0].length;
  }
  result += replacePromptSkillTextMentionSegment(
    prompt.slice(cursor),
    candidate,
    skill,
    seenSkills,
  );
  return result;
}

function replacePromptSkillTextMentionSegment(
  segment: string,
  candidate: string,
  skill: PromptSkill,
  seenSkills: Set<string>,
) {
  return segment.replace(
    new RegExp(`(^|\\s)${escapePromptSkillRegExp(candidate)}(?=\\s|$)`, "g"),
    (_match, prefix: string) => {
      seenSkills.add(promptSkillKey(skill));
      return `${prefix}${promptSkillMentionMarkdown(skill)}`;
    },
  );
}

function promptSkillKey(skill: PromptSkill) {
  return `${skill.name}\n${skill.path}`;
}

function unescapePromptSkillMarkdownLabel(value: string) {
  return value.replace(/\\([\\[\]])/g, "$1");
}

function escapePromptSkillMarkdownLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function safeDecodePromptSkillMarkdownUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapePromptSkillRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export type ThreadDetailResponse = z.infer<typeof ThreadDetailResponseSchema>;
export type ThreadMessageDetailField = z.infer<typeof ThreadMessageDetailFieldSchema>;
export type ThreadMessageDetailResponse = z.infer<typeof ThreadMessageDetailResponseSchema>;
export type StreamThreadRunEvent = z.infer<typeof StreamThreadRunEventSchema>;
export type UpdateWorkspaceFileContentRequest = z.infer<
  typeof UpdateWorkspaceFileContentRequestSchema
>;

export const apiPaths = {
  version: "/version",
  pair: "/v1/pair",
  pairApproval: (approvalCode: string) => `/v1/pair/${encodeURIComponent(approvalCode)}`,
  pairApprove: "/v1/pair/approve",
  sessionsClear: "/v1/sessions/clear",
  sessionRefresh: "/v1/session/refresh",
  status: "/v1/status",
  preferences: "/v1/preferences",
  pushNotifications: "/v1/notifications/push",
  rateLimits: "/v1/rate-limits",
  models: "/v1/models",
  skills: "/v1/skills",
  workspaceFiles: "/v1/workspace/files",
  workspaceFileContent: "/v1/workspace/file",
  workspaceDirectories: "/v1/workspace-directories",
  workspaceChanges: "/v1/workspace/changes",
  workspaceCheckout: "/v1/workspace/checkout",
  workspaceCommitPush: "/v1/workspace/commit-push",
  workspaceTerminalSessions: "/v1/workspace/terminal/sessions",
  workspaceTerminalSession: (sessionId: string) =>
    `/v1/workspace/terminal/sessions/${encodeURIComponent(sessionId)}`,
  workspaceTerminalInput: (sessionId: string) =>
    `/v1/workspace/terminal/sessions/${encodeURIComponent(sessionId)}/input`,
  workspaceTerminalOutput: (sessionId: string) =>
    `/v1/workspace/terminal/sessions/${encodeURIComponent(sessionId)}/output`,
  workspaceTerminalOutputStream: (sessionId: string) =>
    `/v1/workspace/terminal/sessions/${encodeURIComponent(sessionId)}/output/stream`,
  workspaceTerminalResize: (sessionId: string) =>
    `/v1/workspace/terminal/sessions/${encodeURIComponent(sessionId)}/resize`,
  workspaceTailscaleServe: "/v1/workspace/tailscale/serve",
  imageAttachments: "/v1/attachments/images",
  imageAttachment: (attachmentId: string) =>
    `/v1/attachments/images/${encodeURIComponent(attachmentId)}`,
  threads: "/v1/threads",
  thread: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}`,
  threadArchive: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}`,
  threadContextWindow: (threadId: string) =>
    `/v1/threads/${encodeURIComponent(threadId)}/context-window`,
  threadGoal: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}/goal`,
  threadMessageDetail: (threadId: string, messageId: string, field: ThreadMessageDetailField) =>
    `/v1/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/details/${encodeURIComponent(field)}`,
  approval: (approvalId: string) => `/v1/approvals/${encodeURIComponent(approvalId)}`,
  threadInput: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}/input`,
  threadQueuedInput: (threadId: string, inputId: string) =>
    `/v1/threads/${encodeURIComponent(threadId)}/input/${encodeURIComponent(inputId)}`,
  threadQueuedInputSteer: (threadId: string, inputId: string) =>
    `/v1/threads/${encodeURIComponent(threadId)}/input/${encodeURIComponent(inputId)}/steer`,
  threadRuns: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}/runs`,
  threadRunInterrupt: (threadId: string) =>
    `/v1/threads/${encodeURIComponent(threadId)}/runs/interrupt`,
  threadRunStream: (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}/runs/stream`,
} as const;

export function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Codex Relay Local Codex API",
      version: "1.2.0",
    },
    paths: {
      "/version": {
        get: {
          summary: "Relay package version",
          responses: {
            "200": jsonResponse("VersionResponse"),
          },
        },
      },
      "/v1/status": {
        get: {
          summary: "Local server status",
          responses: {
            "200": jsonResponse("StatusResponse"),
          },
        },
      },
      "/v1/preferences": {
        patch: {
          summary: "Update default runtime preferences",
          requestBody: jsonRequest("UpdateRuntimePreferencesRequest"),
          responses: {
            "200": jsonResponse("RuntimePreferencesResponse"),
            "400": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/notifications/push": {
        get: {
          summary: "Read push notification settings for this paired device",
          responses: {
            "200": jsonResponse("PushNotificationSettingsResponse"),
            "401": jsonResponse("ErrorResponse"),
          },
        },
        put: {
          summary: "Register push notifications for this paired device",
          requestBody: jsonRequest("RegisterPushNotificationRequest"),
          responses: {
            "200": jsonResponse("PushNotificationSettingsResponse"),
            "400": jsonResponse("ErrorResponse"),
            "401": jsonResponse("ErrorResponse"),
          },
        },
        delete: {
          summary: "Remove push notifications for this paired device",
          responses: {
            "200": jsonResponse("PushNotificationSettingsResponse"),
            "401": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads": {
        get: {
          summary: "List locally known threads",
          responses: {
            "200": jsonResponse("ListThreadsResponse"),
          },
        },
        post: {
          summary: "Start a Codex thread",
          requestBody: jsonRequest("CreateThreadRequest"),
          responses: {
            "201": jsonResponse("CreateThreadResponse"),
            "400": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}": {
        get: {
          summary: "Read a Codex thread with full available message history",
          parameters: [
            {
              name: "threadId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ThreadDetailResponse"),
            "404": jsonResponse("ErrorResponse"),
          },
        },
        delete: {
          summary: "Archive a Codex thread",
          parameters: [
            {
              name: "threadId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ArchiveThreadResponse"),
            "404": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/workspace-directories": {
        get: {
          summary: "List directories under the configured workspace",
          responses: {
            "200": jsonResponse("ListWorkspaceDirectoriesResponse"),
            "400": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/workspace/files": {
        get: {
          summary: "List files under the configured workspace",
          responses: {
            "200": jsonResponse("ListWorkspaceFilesResponse"),
            "400": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/workspace/file": {
        get: {
          summary: "Read a workspace file preview",
          responses: {
            "200": jsonResponse("WorkspaceFileContentResponse"),
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
        put: {
          summary: "Update a workspace text file",
          requestBody: jsonRequest("UpdateWorkspaceFileContentRequest"),
          responses: {
            "200": jsonResponse("WorkspaceFileContentResponse"),
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/workspace/tailscale/serve": {
        post: {
          summary: "Start Tailscale Serve for a workspace preview URL",
          requestBody: jsonRequest("WorkspaceTailscaleServeRequest"),
          responses: {
            "200": jsonResponse("WorkspaceTailscaleServeResponse"),
            "400": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}/runs": {
        post: {
          summary: "Run a prompt on a Codex thread",
          parameters: [
            {
              name: "threadId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: jsonRequest("RunThreadRequest"),
          responses: {
            "200": jsonResponse("RunThreadResponse"),
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}/runs/interrupt": {
        post: {
          summary: "Interrupt the active Codex app-server turn",
          parameters: [
            {
              name: "threadId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("InterruptThreadRunResponse"),
            "404": jsonResponse("ErrorResponse"),
            "409": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}/goal": {
        get: {
          summary: "Read the active goal for a Codex app-server thread",
          responses: {
            "200": jsonResponse("ThreadGoalResponse"),
            "404": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
        post: {
          summary: "Update the active goal for a Codex app-server thread",
          requestBody: jsonRequest("UpdateThreadGoalRequest"),
          responses: {
            "200": jsonResponse("ThreadGoalResponse"),
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
            "409": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
        delete: {
          summary: "Clear the active goal for a Codex app-server thread",
          responses: {
            "200": jsonResponse("ThreadGoalResponse"),
            "404": jsonResponse("ErrorResponse"),
            "409": jsonResponse("ErrorResponse"),
            "502": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}/input": {
        post: {
          summary: "Submit input to an already-running Codex thread",
          requestBody: jsonRequest("RunThreadRequest"),
          responses: {
            "202": jsonResponse("SubmitThreadInputResponse"),
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
            "409": jsonResponse("ErrorResponse"),
          },
        },
        get: {
          summary: "List queued input for an already-running Codex thread",
          responses: {
            "200": jsonResponse("ListQueuedThreadInputsResponse"),
            "404": jsonResponse("ErrorResponse"),
          },
        },
      },
      "/v1/threads/{threadId}/runs/stream": {
        post: {
          summary: "Run a prompt or attach to an already-running Codex thread and stream events",
          requestBody: jsonRequest("StreamThreadRunRequest"),
          responses: {
            "200": {
              description: "Server-sent events containing StreamThreadRunEvent payloads",
              content: {
                "text/event-stream": {
                  schema: { $ref: "#/components/schemas/StreamThreadRunEvent" },
                },
              },
            },
            "400": jsonResponse("ErrorResponse"),
            "404": jsonResponse("ErrorResponse"),
          },
        },
      },
    },
    components: {
      schemas: {
        ThreadState: { type: "string", enum: ThreadStateSchema.options },
        ReasoningEffort: { type: "string", minLength: 1 },
        ChatMessage: {
          type: "object",
          required: ["id", "threadId", "role", "content", "createdAt"],
          properties: {
            id: { type: "string" },
            threadId: { type: "string" },
            role: { type: "string", enum: ChatMessageRoleSchema.options },
            kind: { type: "string", enum: ChatMessageKindSchema.options },
            content: { type: "string" },
            details: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            turnId: { type: "string" },
            state: { type: "string", enum: ChatMessageStateSchema.options },
          },
        },
        ThreadSummary: {
          type: "object",
          required: ["id", "title", "createdAt", "updatedAt", "state", "messageCount"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            state: { $ref: "#/components/schemas/ThreadState" },
            messageCount: { type: "integer", minimum: 0 },
            model: { type: "string" },
            serviceTier: { type: "string" },
            runtimeMode: { $ref: "#/components/schemas/RuntimeMode" },
            approvalPolicy: { type: "string", enum: ["on-request", "on-failure", "never"] },
            sandboxMode: {
              type: "string",
              enum: ["workspace-write", "danger-full-access", "read-only"],
            },
            reasoningEffort: { $ref: "#/components/schemas/ReasoningEffort" },
            cwd: { type: "string" },
            source: { type: "string" },
            lastMessagePreview: { type: "string" },
            lastActivityAt: { type: "string", format: "date-time" },
            lastPrompt: { type: "string" },
            lastResult: { type: "string" },
            lastError: { type: "string" },
            goal: {
              anyOf: [{ $ref: "#/components/schemas/ThreadGoal" }, { type: "null" }],
            },
          },
        },
        ThreadGoal: {
          type: "object",
          required: [
            "threadId",
            "objective",
            "status",
            "tokenBudget",
            "tokensUsed",
            "timeUsedSeconds",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            threadId: { type: "string" },
            objective: { type: "string" },
            status: { type: "string", enum: ThreadGoalStatusSchema.options },
            tokenBudget: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
            tokensUsed: { type: "integer", minimum: 0 },
            timeUsedSeconds: { type: "integer", minimum: 0 },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        UpdateThreadGoalRequest: {
          type: "object",
          properties: {
            objective: { type: "string" },
            status: { type: "string", enum: ThreadGoalStatusSchema.options },
            tokenBudget: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          },
        },
        ThreadGoalResponse: {
          type: "object",
          required: ["goal", "thread"],
          properties: {
            goal: {
              anyOf: [{ $ref: "#/components/schemas/ThreadGoal" }, { type: "null" }],
            },
            thread: { $ref: "#/components/schemas/ThreadSummary" },
          },
        },
        StatusResponse: {
          type: "object",
          required: [
            "ok",
            "service",
            "sdkAvailable",
            "machineName",
            "workspacePath",
            "threadCount",
          ],
          properties: {
            ok: { type: "boolean" },
            service: { type: "string", const: "codex-relay-server" },
            sdkAvailable: { type: "boolean" },
            machineName: { type: "string" },
            workspacePath: { type: "string" },
            threadCount: { type: "integer", minimum: 0 },
            appServerAvailable: { type: "boolean" },
            preferences: { $ref: "#/components/schemas/RuntimePreferences" },
            runtimePreferencesByWorkspacePath: {
              type: "object",
              additionalProperties: { $ref: "#/components/schemas/RuntimePreferences" },
            },
          },
        },
        VersionResponse: {
          type: "object",
          required: ["ok", "service", "packageName", "packageVersion"],
          properties: {
            ok: { type: "boolean" },
            service: { type: "string", const: "codex-relay-server" },
            packageName: { type: "string", const: "codex-relay" },
            packageVersion: { type: "string" },
          },
        },
        RuntimePreferences: {
          type: "object",
          required: ["runtimeMode"],
          properties: {
            model: { type: "string" },
            serviceTier: { type: "string" },
            runtimeMode: {
              type: "string",
              enum: ["default", "auto", "full-access", "on-request"],
              default: "default",
            },
            reasoningEffort: {
              type: "string",
              minLength: 1,
            },
          },
        },
        UpdateRuntimePreferencesRequest: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            workspacePath: { type: "string" },
            model: { type: "string", nullable: true },
            serviceTier: { type: "string", nullable: true },
            runtimeMode: {
              type: "string",
              enum: ["default", "auto", "full-access", "on-request"],
            },
            reasoningEffort: {
              type: "string",
              minLength: 1,
              nullable: true,
            },
          },
        },
        RuntimePreferencesResponse: {
          type: "object",
          required: ["preferences"],
          properties: {
            preferences: { $ref: "#/components/schemas/RuntimePreferences" },
            runtimePreferencesByWorkspacePath: {
              type: "object",
              additionalProperties: { $ref: "#/components/schemas/RuntimePreferences" },
            },
            threadId: { type: "string" },
            workspacePath: { type: "string" },
          },
        },
        PushNotificationPreferences: {
          type: "object",
          required: ["actionRequired", "turnTerminal"],
          properties: {
            actionRequired: { type: "boolean" },
            turnTerminal: { type: "boolean" },
          },
        },
        RegisterPushNotificationRequest: {
          type: "object",
          required: ["expoPushToken", "platform", "preferences"],
          properties: {
            expoPushToken: {
              type: "string",
              pattern: "^(?:Expo|Exponent)PushToken\\[[^\\]\\r\\n]{1,512}\\]$",
            },
            platform: { type: "string", enum: ["android", "ios"] },
            preferences: { $ref: "#/components/schemas/PushNotificationPreferences" },
          },
        },
        PushNotificationSettingsResponse: {
          type: "object",
          required: ["preferences", "registered"],
          properties: {
            preferences: { $ref: "#/components/schemas/PushNotificationPreferences" },
            registered: { type: "boolean" },
          },
        },
        WorkspaceDirectoryEntry: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string" },
            path: { type: "string" },
          },
        },
        ListWorkspaceDirectoriesResponse: {
          type: "object",
          required: ["rootPath", "path", "parentPath", "directories"],
          properties: {
            rootPath: { type: "string" },
            path: { type: "string" },
            parentPath: { type: "string", nullable: true },
            directories: {
              type: "array",
              items: { $ref: "#/components/schemas/WorkspaceDirectoryEntry" },
            },
          },
        },
        WorkspaceFileMention: {
          type: "object",
          required: ["directory", "kind", "name", "path"],
          properties: {
            directory: { type: "string" },
            kind: { type: "string", enum: ["directory", "file"] },
            name: { type: "string" },
            path: { type: "string" },
          },
        },
        ListWorkspaceFilesResponse: {
          type: "object",
          required: ["directory", "files", "parentDirectory", "query", "workspacePath"],
          properties: {
            directory: { type: "string" },
            files: {
              type: "array",
              items: { $ref: "#/components/schemas/WorkspaceFileMention" },
            },
            parentDirectory: { type: "string", nullable: true },
            query: { type: "string" },
            workspacePath: { type: "string" },
          },
        },
        WorkspaceFileContentResponse: {
          type: "object",
          required: [
            "binary",
            "content",
            "directory",
            "language",
            "name",
            "path",
            "size",
            "truncated",
            "workspacePath",
          ],
          properties: {
            binary: { type: "boolean" },
            content: { type: "string" },
            directory: { type: "string" },
            language: { type: "string" },
            name: { type: "string" },
            path: { type: "string" },
            size: { type: "integer", minimum: 0 },
            truncated: { type: "boolean" },
            workspacePath: { type: "string" },
          },
        },
        UpdateWorkspaceFileContentRequest: {
          type: "object",
          required: ["content", "path"],
          properties: {
            content: { type: "string", maxLength: 1048576 },
            path: { type: "string" },
            workspacePath: { type: "string" },
          },
        },
        WorkspaceTailscaleServeRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
          },
        },
        WorkspaceTailscaleServeResponse: {
          type: "object",
          required: ["url", "port"],
          properties: {
            url: { type: "string", format: "uri" },
            port: { type: "integer", minimum: 1 },
          },
        },
        CreateThreadRequest: {
          type: "object",
          properties: {
            attachments: {
              type: "array",
              maxItems: 6,
              items: { $ref: "#/components/schemas/PromptAttachment" },
            },
            prompt: { type: "string" },
            skills: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/PromptSkill" },
            },
            title: { type: "string", maxLength: 120 },
            workspacePath: { type: "string" },
            collaborationMode: { type: "string", enum: ["default", "plan"], default: "default" },
          },
        },
        PromptAttachment: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", const: "image" },
            mimeType: { type: "string", pattern: "^image/" },
            name: { type: "string", maxLength: 160 },
            path: { type: "string" },
            url: { type: "string" },
          },
        },
        PromptSkill: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string" },
            path: { type: "string" },
          },
        },
        CreateThreadResponse: {
          type: "object",
          required: ["thread"],
          properties: {
            thread: { $ref: "#/components/schemas/ThreadSummary" },
            messages: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
            result: { type: "string" },
          },
        },
        RunThreadRequest: {
          type: "object",
          required: ["prompt"],
          properties: {
            attachments: {
              type: "array",
              maxItems: 6,
              items: { $ref: "#/components/schemas/PromptAttachment" },
            },
            prompt: { type: "string" },
            skills: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/PromptSkill" },
            },
            collaborationMode: { type: "string", enum: ["default", "plan"], default: "default" },
          },
        },
        StreamThreadRunRequest: {
          type: "object",
          properties: {
            attachments: {
              type: "array",
              maxItems: 6,
              items: { $ref: "#/components/schemas/PromptAttachment" },
            },
            prompt: { type: "string" },
            skills: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/PromptSkill" },
            },
            collaborationMode: { type: "string", enum: ["default", "plan"], default: "default" },
          },
        },
        RunThreadResponse: {
          type: "object",
          required: ["thread", "result"],
          properties: {
            thread: { $ref: "#/components/schemas/ThreadSummary" },
            messages: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
            result: { type: "string" },
          },
        },
        SubmitThreadInputResponse: {
          type: "object",
          required: ["acceptedAs", "queueLength", "thread"],
          properties: {
            acceptedAs: { type: "string", enum: ["steering", "queued"] },
            input: { $ref: "#/components/schemas/QueuedThreadInput" },
            queueLength: { type: "integer", minimum: 0 },
            thread: { $ref: "#/components/schemas/ThreadSummary" },
          },
        },
        QueuedThreadInput: {
          type: "object",
          required: ["attachments", "id", "prompt", "skills"],
          properties: {
            attachments: {
              type: "array",
              maxItems: 6,
              items: { $ref: "#/components/schemas/PromptAttachment" },
            },
            id: { type: "string" },
            prompt: { type: "string" },
            skills: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/PromptSkill" },
            },
          },
        },
        QueuedThreadInputActionResponse: {
          type: "object",
          required: ["queueLength", "thread"],
          properties: {
            input: { $ref: "#/components/schemas/QueuedThreadInput" },
            queueLength: { type: "integer", minimum: 0 },
            thread: { $ref: "#/components/schemas/ThreadSummary" },
          },
        },
        InterruptThreadRunResponse: {
          type: "object",
          required: ["thread"],
          properties: {
            thread: { $ref: "#/components/schemas/ThreadSummary" },
          },
        },
        ListQueuedThreadInputsResponse: {
          type: "object",
          required: ["inputs", "queueLength"],
          properties: {
            inputs: {
              type: "array",
              items: { $ref: "#/components/schemas/QueuedThreadInput" },
            },
            queueLength: { type: "integer", minimum: 0 },
          },
        },
        PendingInputRequest: {
          type: "object",
          required: ["id", "questions", "threadId"],
          properties: {
            id: { type: "string" },
            questions: {
              type: "array",
              items: { $ref: "#/components/schemas/PendingInputRequestQuestion" },
            },
            threadId: { type: "string" },
            turnId: { type: "string" },
          },
        },
        PendingInputRequestQuestion: {
          type: "object",
          required: ["id", "question"],
          properties: {
            header: { type: "string" },
            id: { type: "string" },
            options: {
              type: "array",
              items: { $ref: "#/components/schemas/PendingInputRequestOption" },
            },
            question: { type: "string" },
          },
        },
        PendingInputRequestOption: {
          type: "object",
          required: ["label"],
          properties: {
            label: { type: "string" },
            description: { type: "string" },
          },
        },
        ThreadDetailResponse: {
          type: "object",
          required: ["thread", "messages"],
          properties: {
            thread: { $ref: "#/components/schemas/ThreadSummary" },
            messages: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
            pendingInputRequests: {
              type: "array",
              items: { $ref: "#/components/schemas/PendingInputRequest" },
            },
          },
        },
        ThreadMessageDetailResponse: {
          type: "object",
          required: ["field", "messageId", "originalLength", "value"],
          properties: {
            field: { type: "string", enum: ["output", "patch"] },
            messageId: { type: "string" },
            originalLength: { type: "integer", minimum: 0 },
            value: { type: "string" },
          },
        },
        StreamThreadRunEvent: {
          oneOf: [
            { type: "object", properties: { type: { const: "thread.message.created" } } },
            { type: "object", properties: { type: { const: "thread.message.delta" } } },
            { type: "object", properties: { type: { const: "thread.message.completed" } } },
            { type: "object", properties: { type: { const: "thread.state.changed" } } },
            { type: "object", properties: { type: { const: "thread.error" } } },
            {
              type: "object",
              properties: { type: { const: "thread.preview_target.detected" } },
            },
          ],
        },
        ListThreadsResponse: {
          type: "object",
          required: ["threads"],
          properties: {
            threads: {
              type: "array",
              items: { $ref: "#/components/schemas/ThreadSummary" },
            },
          },
        },
        ArchiveThreadResponse: {
          type: "object",
          required: ["archivedThreadId", "threads"],
          properties: {
            archivedThreadId: { type: "string" },
            source: { type: "string", enum: ["app-server", "memory"] },
            threads: {
              type: "array",
              items: { $ref: "#/components/schemas/ThreadSummary" },
            },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                issues: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}

function jsonRequest(schemaName: string) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  };
}

function jsonResponse(schemaName: string) {
  return {
    description: schemaName,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  };
}
