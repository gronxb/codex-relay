import type {
  ChatMessage,
  ContextWindowUsage,
  RateLimitBucket,
  ReasoningEffort,
  RuntimeMode,
  ThreadCollaborationMode,
} from "codex-relay/api-schema";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard } from "react-native";
import { hapticLightImpact, hapticSelection, hapticWarning } from "@/lib/haptics";
import { getComposerDraft, setComposerDraft } from "@/state/chat-store";

import { ChatControls } from "./ChatControls";
import { ChatShell } from "./ChatShell";
import { previewModels } from "./chat-preview-models";
import { reasoningEffortForModel } from "./model-picker-options";

const PREVIEW_THREAD_ID = "chat-preview";
const PREVIEW_INPUT_NATIVE_ID = "chat-preview-composer-input";

const previewContextUsage: ContextWindowUsage = {
  tokenLimit: 200000,
  tokensUsed: 64400,
};

const previewRateLimits: RateLimitBucket[] = [
  {
    limitId: "weekly",
    limitName: "Weekly",
    primary: {
      resetsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3,
      usedPercent: 37,
      windowDurationMins: 10080,
    },
  },
  {
    limitId: "daily",
    limitName: "Daily",
    primary: {
      resetsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
      usedPercent: 62,
      windowDurationMins: 1440,
    },
  },
];

export function ChatPreviewScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialPreviewMessages());
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("default");
  const [collaborationMode, setCollaborationMode] = useState<ThreadCollaborationMode>("default");
  const composerFocusRequestKey = 0;
  const [selectedModel, setSelectedModel] = useState("gpt-5.6-sol");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<
    ReasoningEffort | undefined
  >("medium");
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | undefined>();
  const commandCount = useMemo(() => commandList().length, []);
  const isPreviewRunning = messages.some(
    (message) => message.kind === "plan" && message.role === "status",
  );

  function changePreviewModel(model: string, reasoningEffort?: ReasoningEffort) {
    const nextModel = previewModels.find((candidate) => candidate.model === model);
    setSelectedModel(model);
    setSelectedReasoningEffort(
      reasoningEffortForModel(nextModel, reasoningEffort ?? selectedReasoningEffort),
    );
  }

  function sendPreviewPrompt(promptOverride?: string) {
    const isDraftPrompt = promptOverride === undefined;
    const prompt = (promptOverride ?? getComposerDraft(PREVIEW_THREAD_ID)).trim();
    if (!prompt) {
      return;
    }

    if (isDraftPrompt) {
      setComposerDraft("", PREVIEW_THREAD_ID);
    }
    Keyboard.dismiss();
    hapticLightImpact();
    setMessages((current) => [
      ...current,
      previewMessage({
        content: prompt,
        id: `user-${Date.now()}`,
        role: "user",
      }),
      ...messagesForCommand(prompt),
    ]);
  }

  function resetPreview() {
    hapticWarning();
    setMessages(initialPreviewMessages());
  }

  function implementPreviewPlan() {
    setCollaborationMode("default");
    sendPreviewPrompt("Implement plan");
  }

  function addPreviewPlanContext(context: string) {
    setCollaborationMode("plan");
    sendPreviewPrompt(context);
  }

  return (
    <ChatShell
      collaborationMode={collaborationMode}
      composerDisabled={false}
      composerFocusRequestKey={composerFocusRequestKey}
      composerFooter={
        <ChatControls
          models={previewModels}
          runtimeMode={runtimeMode}
          selectedModel={selectedModel}
          selectedReasoningEffort={selectedReasoningEffort}
          selectedServiceTier={selectedServiceTier}
          onRuntimeModeChange={setRuntimeMode}
          onSelectedModelChange={changePreviewModel}
          onSelectedReasoningEffortChange={setSelectedReasoningEffort}
          onSelectedServiceTierChange={setSelectedServiceTier}
        />
      }
      contextWindowUsage={previewContextUsage}
      inputNativeID={PREVIEW_INPUT_NATIVE_ID}
      isAttachingImage={false}
      isRunning={isPreviewRunning}
      leadingAction={{
        icon: "closeMenu",
        label: "Back to chat",
        onPress: () => {
          hapticSelection();
          router.replace("/");
        },
      }}
      messages={messages}
      onAttachImage={() => undefined}
      onCancel={() => undefined}
      onCollaborationModeChange={setCollaborationMode}
      onAddPlanContext={addPreviewPlanContext}
      onImplementPlan={implementPreviewPlan}
      onRefreshUsageStatus={() => undefined}
      onSend={() => sendPreviewPrompt()}
      queuedPrompts={[]}
      rateLimitBuckets={previewRateLimits}
      skills={[]}
      skillsLoadState="loaded"
      subtitle={`codex-relay://preview · ${commandCount} fixtures`}
      threadId={PREVIEW_THREAD_ID}
      title="Chat Preview"
      trailingActions={[
        {
          icon: "refresh",
          label: "Reset preview",
          onPress: resetPreview,
        },
      ]}
    />
  );
}

function initialPreviewMessages() {
  return [
    previewMessage({
      content:
        "Type `/approval`, `/input`, `/tools`, `/plan`, `/agents`, `/code`, `/diff`, `/error`, or `/all` to render canned chat components.",
      id: "preview-welcome",
      role: "assistant",
    }),
  ];
}

function commandList() {
  return ["/approval", "/input", "/tools", "/plan", "/agents", "/code", "/diff", "/error", "/all"];
}

function messagesForCommand(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (normalized === "/all") {
    return [
      ...approvalFixture(),
      ...inputFixture(),
      ...toolFixture(),
      ...planFixture(),
      ...codeFixture(),
      ...diffFixture(),
      ...errorFixture(),
    ];
  }
  if (normalized === "/approval") {
    return approvalFixture();
  }
  if (normalized === "/input") {
    return inputFixture();
  }
  if (normalized === "/tools") {
    return toolFixture();
  }
  if (normalized === "/plan") {
    return planFixture();
  }
  if (normalized === "/agents") {
    return subagentPlanFixture();
  }
  if (normalized === "/code") {
    return codeFixture();
  }
  if (normalized === "/diff") {
    return diffFixture();
  }
  if (normalized === "/error") {
    return errorFixture();
  }

  return [
    previewMessage({
      content: `Preview echo for \`${prompt}\`.\n\nTry one of: ${commandList().join(", ")}.`,
      id: `assistant-${Date.now()}`,
      role: "assistant",
    }),
  ];
}

function approvalFixture() {
  return [
    previewMessage({
      content: "Codex wants to run a local verification command.",
      details: {
        approvalId: `preview-command-${Date.now()}`,
        approvalKind: "commandExecution",
        command: "pnpm test",
        cwd: "/workspace/codex-relay",
        previewMode: true,
        reason: "Validate the server stream and approval routes.",
      },
      id: `approval-${Date.now()}`,
      kind: "approvalRequest",
      role: "status",
    }),
  ];
}

function inputFixture() {
  return [
    previewMessage({
      content: "Codex needs a short answer before continuing.",
      details: {
        approvalId: `preview-input-${Date.now()}`,
        approvalKind: "structuredUserInput",
        previewMode: true,
        questions: [
          {
            header: "Scope",
            id: "scope",
            options: [
              { description: "Render every canned state.", label: "All fixtures" },
              { description: "Only render approval-related cards.", label: "Approvals only" },
            ],
            question: "Which preview set should be shown?",
          },
        ],
      },
      id: `input-${Date.now()}`,
      kind: "approvalRequest",
      role: "status",
    }),
  ];
}

function toolFixture() {
  const stamp = Date.now();
  return [
    previewMessage({
      content: "Reviewing the current route tree before editing.",
      details: {
        plan: [
          { status: "completed", step: "Map existing chat screen structure" },
          { status: "in_progress", step: "Mount hidden preview route" },
          { status: "pending", step: "Verify mobile typecheck" },
        ],
      },
      id: `thinking-${stamp}`,
      kind: "thinking",
      role: "reasoning",
    }),
    previewMessage({
      content: 'rg "MessageTimeline" apps/mobile/src',
      details: {
        command: 'rg "MessageTimeline" apps/mobile/src',
        cwd: "/workspace/codex-relay",
        exitCode: 0,
        output:
          "apps/mobile/src/components/chat/ChatScreen.tsx\napps/mobile/src/components/chat/ChatPreviewScreen.tsx",
        status: "done",
      },
      id: `command-${stamp}`,
      kind: "commandExecution",
      role: "tool",
    }),
    previewMessage({
      content: "Updated preview route and chat timeline rendering.",
      details: {
        changes: [
          { kind: "added", path: "apps/mobile/src/app/preview.tsx" },
          { kind: "modified", path: "apps/mobile/src/components/chat/MessageTimeline.tsx" },
        ],
        patch:
          '+ <Drawer.Screen name="preview" />\n- messages.filter((message) => !isProtocolActivity(message))',
      },
      id: `file-${stamp}`,
      kind: "fileChange",
      role: "tool",
    }),
    previewMessage({
      content: "Preview fixture lookup",
      details: {
        query: "Expo Router hidden development deep link route",
        status: "done",
      },
      id: `web-${stamp}`,
      kind: "webSearch",
      role: "tool",
    }),
    previewMessage({
      content: "Called mobile preview fixture.",
      details: {
        server: "preview",
        status: "completed",
        tool: "renderChatState",
      },
      id: `tool-${stamp}`,
      kind: "toolActivity",
      role: "tool",
    }),
  ];
}

function planFixture() {
  return [
    previewMessage({
      content: "Preview plan updated.",
      details: {
        explanation: "Use the production chat renderer with fixture-only state.",
        plan: [
          { status: "completed", step: "Add hidden route" },
          { status: "in_progress", step: "Exercise approval and input cards" },
          { status: "pending", step: "Run verification" },
        ],
      },
      id: `plan-${Date.now()}`,
      kind: "plan",
      role: "status",
    }),
  ];
}

function subagentPlanFixture() {
  const stamp = Date.now();
  const turnId = `preview-agents-${stamp}`;
  return [
    previewMessage({
      content: "Preview plan updated with subagents.",
      details: {
        plan: [
          { status: "completed", step: "Map the current component tree" },
          { status: "in_progress", step: "Review compact subagent status" },
          { status: "pending", step: "Verify the expanded plan layout" },
        ],
      },
      id: `plan-agents-${stamp}`,
      kind: "plan",
      role: "status",
      turnId,
    }),
    previewMessage({
      content: "Spawned 4 subagents",
      details: {
        agentsStates: {
          "agent-a": { message: null, status: "running" },
          "agent-b": { message: null, status: "completed" },
          "agent-c": { message: null, status: "completed" },
          "agent-d": { message: "Fixture failure", status: "failed" },
        },
        receiverThreadIds: ["agent-a", "agent-b", "agent-c", "agent-d"],
        status: "completed",
        tool: "spawnAgent",
        type: "collabAgentToolCall",
      },
      id: `spawn-agents-${stamp}`,
      kind: "subagentAction",
      role: "tool",
      turnId,
    }),
    previewMessage({
      content: "component-reviewer started",
      details: {
        activityKind: "started",
        agentPath: "component-reviewer",
        agentThreadId: "agent-a",
        type: "subAgentActivity",
      },
      id: `agent-started-${stamp}`,
      kind: "subagentAction",
      role: "status",
      turnId,
    }),
  ];
}

function codeFixture() {
  return [
    previewMessage({
      content: [
        "Here is a Shiki-highlighted TypeScript block:",
        "",
        "```ts",
        'type PreviewCommand = "/approval" | "/input" | "/tools" | "/plan" | "/code";',
        "",
        "function nextFixture(command: PreviewCommand) {",
        "  const startedAt = new Date().toISOString();",
        '  return { command, startedAt, visible: command === "/code" };',
        "}",
        "```",
        "",
        "And a small shell block:",
        "",
        "```bash",
        "pnpm --filter @codex-relay/mobile typecheck",
        "```",
      ].join("\n"),
      id: `code-${Date.now()}`,
      role: "assistant",
    }),
  ];
}

function diffFixture() {
  const stamp = Date.now();
  return [
    previewMessage({
      content: [
        "Here is a Shiki-highlighted diff block:",
        "",
        "```diff",
        "diff --git a/apps/mobile/src/components/chat/ChatPreviewScreen.tsx b/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
        "index 31a0f2e..7c9b832 100644",
        "--- a/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
        "+++ b/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
        "@@ -164,7 +164,7 @@ function commandList() {",
        '-  return ["/approval", "/input", "/tools", "/plan", "/code", "/error", "/all"];',
        '+  return ["/approval", "/input", "/tools", "/plan", "/code", "/diff", "/error", "/all"];',
        " }",
        "```",
      ].join("\n"),
      id: `diff-code-${stamp}`,
      role: "assistant",
    }),
    previewMessage({
      content: "Preview diff fixture updated.",
      details: {
        changes: [
          { kind: "modified", path: "apps/mobile/src/components/chat/ChatPreviewScreen.tsx" },
        ],
        patch: [
          "diff --git a/apps/mobile/src/components/chat/ChatPreviewScreen.tsx b/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
          "index 31a0f2e..7c9b832 100644",
          "--- a/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
          "+++ b/apps/mobile/src/components/chat/ChatPreviewScreen.tsx",
          "@@ -164,7 +164,7 @@ function commandList() {",
          '-  return ["/approval", "/input", "/tools", "/plan", "/code", "/error", "/all"];',
          '+  return ["/approval", "/input", "/tools", "/plan", "/code", "/diff", "/error", "/all"];',
          " }",
        ].join("\n"),
      },
      id: `diff-file-${stamp}`,
      kind: "fileChange",
      role: "tool",
    }),
  ];
}

function errorFixture() {
  return [
    previewMessage({
      content: "Preview failure state: unable to reach the local Codex Relay server.",
      id: `error-${Date.now()}`,
      role: "error",
      state: "failed",
    }),
  ];
}

function previewMessage(
  message: Partial<ChatMessage> & Pick<ChatMessage, "content" | "id" | "role">,
) {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    kind: "chat",
    state: "completed",
    threadId: PREVIEW_THREAD_ID,
    updatedAt: now,
    ...message,
  } satisfies ChatMessage;
}
