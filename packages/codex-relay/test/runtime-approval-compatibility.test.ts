import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";

const cases: Array<{
  name: string;
  options: Record<string, string>;
  preferences?: Record<string, string>;
  approvalPolicy: string;
  sandbox: string;
  sandboxType: string;
}> = [
  {
    name: "default",
    options: {},
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxType: "workspaceWrite",
  },
  {
    name: "auto",
    options: { runtimeMode: "auto" },
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxType: "workspaceWrite",
  },
  {
    name: "saved auto preference",
    options: {},
    preferences: { runtimeMode: "auto" },
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxType: "workspaceWrite",
  },
  {
    name: "legacy explicit",
    options: { approvalPolicy: "on-failure" },
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxType: "workspaceWrite",
  },
  {
    name: "full-access",
    options: { runtimeMode: "full-access" },
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    sandboxType: "dangerFullAccess",
  },
  {
    name: "valid explicit",
    options: { runtimeMode: "auto", approvalPolicy: "never", sandboxMode: "read-only" },
    approvalPolicy: "never",
    sandbox: "read-only",
    sandboxType: "readOnly",
  },
];

function requireCurrentPolicy(params: unknown) {
  const policy = (params as { approvalPolicy: string }).approvalPolicy;
  if (!["untrusted", "on-request", "never"].includes(policy)) {
    throw new Error(`Invalid request: unsupported approvalPolicy ${policy}`);
  }
}

describe("native approval compatibility", () => {
  it.each(cases)(
    "normalizes $name for thread create, resume and turn start",
    async ({ options, preferences, approvalPolicy, sandbox, sandboxType }) => {
      const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-approval-"));
      const handlers = new Set<(notification: unknown) => void>();
      const now = Date.now() / 1000;
      const thread = {
        id: "approval-thread",
        createdAt: now,
        updatedAt: now,
        cwd: workspacePath,
        modelProvider: "openai",
        name: "Approval test",
        preview: "Approval test",
        source: "app",
        status: "idle",
        turns: [],
      };
      const appServer = {
        onNotification(handler: (notification: unknown) => void) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
        onRequest() {
          return () => undefined;
        },
        isThreadSubscribed() {
          return false;
        },
        startThread: vi.fn(async (params: unknown) => {
          requireCurrentPolicy(params);
          return thread;
        }),
        resumeThread: vi.fn(async (params: unknown) => {
          requireCurrentPolicy(params);
          return thread;
        }),
        startTurn: vi.fn(async (params: unknown) => {
          requireCurrentPolicy(params);
          queueMicrotask(() => {
            for (const handler of handlers) {
              handler({
                method: "item/agentMessage/delta",
                params: {
                  delta: "verified",
                  itemId: "reply",
                  threadId: thread.id,
                  turnId: "turn-1",
                },
              });
              handler({
                method: "turn/completed",
                params: { status: "completed", threadId: thread.id, turnId: "turn-1" },
              });
            }
          });
          return { id: "turn-1", items: [], status: "completed", startedAt: now, completedAt: now };
        }),
      };
      const app = createApp({ appServer: appServer as never, codex: {} as never, workspacePath });
      if (preferences) {
        const saved = await app.request("/v1/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(preferences),
        });
        expect(saved.status).toBe(200);
      }
      const created = await app.request("/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Approval test", ...options }),
      });
      expect(created.status).toBe(201);
      if (options.approvalPolicy) {
        expect((await created.json()).thread.approvalPolicy).toBe(approvalPolicy);
      }
      const streamed = await app.request(`/v1/threads/${thread.id}/runs/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Verify", ...options }),
      });
      const output = await streamed.text();
      expect(streamed.status).toBe(200);
      expect(output).toContain("verified");
      expect(appServer.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ approvalPolicy, sandbox }),
      );
      expect(appServer.resumeThread).toHaveBeenCalledWith(
        expect.objectContaining({ approvalPolicy, sandbox, threadId: thread.id }),
      );
      expect(appServer.startTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy,
          sandboxPolicy: expect.objectContaining({ type: sandboxType }),
          threadId: thread.id,
        }),
      );
      if (sandbox === "workspace-write") {
        expect(appServer.startTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            sandboxPolicy: expect.objectContaining({
              writableRoots: [workspacePath],
              networkAccess: false,
            }),
          }),
        );
      }
    },
  );

  it.each([{ runtimeMode: "auto" }, { approvalPolicy: "on-failure" }])(
    "normalizes SDK options %j",
    async (options) => {
      const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-sdk-approval-"));
      const thread = {
        id: "sdk-approval-thread",
        run: vi.fn(async () => ({ finalResponse: "verified" })),
      };
      const codex = { startThread: vi.fn(() => thread), resumeThread: vi.fn(() => thread) };
      const app = createApp({ codex: codex as never, workspacePath });
      const created = await app.request("/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "SDK test", ...options }),
      });
      expect(created.status).toBe(201);
      expect(codex.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ approvalPolicy: "on-request", sandboxMode: "workspace-write" }),
      );
      const run = await app.request(`/v1/threads/${thread.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Verify", ...options }),
      });
      expect(run.status).toBe(200);
      expect(codex.resumeThread).toHaveBeenCalledWith(
        thread.id,
        expect.objectContaining({ approvalPolicy: "on-request", sandboxMode: "workspace-write" }),
      );
    },
  );
});
