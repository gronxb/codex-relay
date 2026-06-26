import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes, utf8ToBytes } from "@noble/ciphers/utils.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromByteArray, toByteArray } from "base64-js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { CodexClient, CodexThread } from "../src/codex.js";
import { createTursoPairingSessionStore } from "../src/pairing-store.js";
import { createFileRuntimePreferencesStore } from "../src/preferences-store.js";
import { createServerIdentity } from "../src/secure-transport.js";

const execFileAsync = promisify(execFile);

function createMockCodex(handlers?: {
  onResumeThread?: (threadId: string, options: Parameters<CodexClient["resumeThread"]>[1]) => void;
  onStartThread?: (options: Parameters<CodexClient["startThread"]>[0]) => void;
}): CodexClient {
  const threads = new Map<string, CodexThread>();

  return {
    startThread(options) {
      handlers?.onStartThread?.(options);
      const id = `thread-${threads.size + 1}`;
      const thread = {
        id,
        async run(prompt: string) {
          return { finalResponse: `result: ${prompt}` };
        },
        async runStreamed(prompt: string) {
          async function* events() {
            yield { type: "turn.started" };
            yield {
              type: "item.completed",
              item: { id: "item-1", type: "agent_message", text: `streamed: ${prompt}` },
            };
            yield {
              type: "turn.completed",
              usage: {
                input_tokens: 1,
                cached_input_tokens: 0,
                output_tokens: 1,
                reasoning_output_tokens: 0,
              },
            };
          }

          return { events: events() };
        },
      };
      threads.set(id, thread);
      return thread;
    },
    resumeThread(threadId: string, options) {
      handlers?.onResumeThread?.(threadId, options);
      const thread = threads.get(threadId);
      if (!thread) {
        throw new Error("missing mock thread");
      }
      return thread;
    },
  };
}

function testPairingTranscript(input: {
  approvalCode: string;
  clientEphemeralPublicKey: string;
  clientNonce: string;
  keyEpoch: number;
  serverEphemeralPublicKey: string;
  serverIdentityPublicKey: string;
  serverNonce: string;
  serverUrl: string;
}) {
  return utf8ToBytes(
    JSON.stringify({
      tag: "codex-relay-e2ee-v1",
      approvalCode: input.approvalCode,
      clientEphemeralPublicKey: input.clientEphemeralPublicKey,
      clientNonce: input.clientNonce,
      keyEpoch: input.keyEpoch,
      serverEphemeralPublicKey: input.serverEphemeralPublicKey,
      serverIdentityPublicKey: input.serverIdentityPublicKey,
      serverNonce: input.serverNonce,
      serverUrl: input.serverUrl,
    }),
  );
}

function testDeriveSession(sharedSecret: Uint8Array, transcript: Uint8Array, keyEpoch: number) {
  const salt = sha256(transcript);
  const infoPrefix = `codex-relay-e2ee-v1|${keyEpoch}|${fromByteArray(sha256(transcript))}`;
  return {
    serverToMobileKey: hkdf(
      sha256,
      sharedSecret,
      salt,
      utf8ToBytes(`${infoPrefix}|serverToMobile`),
      32,
    ),
  };
}

function testDecrypt(
  key: Uint8Array,
  sender: "mobile" | "server",
  counter: number,
  ciphertext: string,
) {
  return new TextDecoder().decode(
    gcm(key, testNonceFor(sender, counter)).decrypt(toByteArray(ciphertext)),
  );
}

function testNonceFor(sender: "mobile" | "server", counter: number) {
  const nonce = new Uint8Array(12);
  nonce[0] = sender === "mobile" ? 1 : 2;
  new DataView(nonce.buffer).setBigUint64(4, BigInt(counter), false);
  return nonce;
}

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function waitUntil(assertion: () => void | Promise<void>) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > 1000) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("Codex Relay server routes", () => {
  it("returns relay package version", async () => {
    const app = createApp({ codex: createMockCodex(), workspacePath: "/tmp/codex-relay" });

    const response = await app.request("/version");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "codex-relay-server",
      packageName: "codex-relay",
      packageVersion: expect.any(String),
    });
  });

  it("returns status", async () => {
    const app = createApp({ codex: createMockCodex(), workspacePath: "/tmp/codex-relay" });

    const response = await app.request("/v1/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "codex-relay-server",
      sdkAvailable: true,
      machineName: expect.any(String),
      workspacePath: "/tmp/codex-relay",
      threadCount: 0,
      preferences: { runtimeMode: "default" },
    });
  });

  it("updates and returns runtime preferences", async () => {
    const app = createApp({ codex: createMockCodex(), workspacePath: "/tmp/codex-relay" });

    const update = await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        serviceTier: "priority",
        reasoningEffort: "high",
        runtimeMode: "full-access",
      }),
    });
    const updateBody = await update.json();
    const status = await app.request("/v1/status");
    const statusBody = await status.json();

    expect(update.status).toBe(200);
    expect(updateBody).toMatchObject({
      preferences: {
        model: "gpt-5.5",
        serviceTier: "priority",
        reasoningEffort: "high",
        runtimeMode: "full-access",
      },
    });
    expect(statusBody).toMatchObject(updateBody);
  });

  it("updates model and reasoning preferences on the thread workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });
    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Thread scoped settings" }),
    });
    const createBody = await createResponse.json();

    const update = await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        serviceTier: "priority",
        reasoningEffort: "high",
        runtimeMode: "auto",
        threadId: createBody.thread.id,
      }),
    });
    const updateBody = await update.json();
    const detail = await app.request(`/v1/threads/${createBody.thread.id}`);
    const detailBody = await detail.json();
    const status = await app.request("/v1/status");
    const statusBody = await status.json();

    expect(update.status).toBe(200);
    expect(updateBody).toMatchObject({
      preferences: {
        model: "gpt-5.5",
        serviceTier: "priority",
        reasoningEffort: "high",
        runtimeMode: "auto",
      },
      workspacePath,
    });
    expect(updateBody).not.toHaveProperty("threadId");
    expect(detailBody.thread).not.toHaveProperty("model");
    expect(detailBody.thread).not.toHaveProperty("reasoningEffort");
    expect(detailBody.thread).not.toHaveProperty("runtimeMode");
    expect(statusBody.preferences).toEqual({
      model: "gpt-5.5",
      serviceTier: "priority",
      reasoningEffort: "high",
      runtimeMode: "auto",
    });
  });

  it("returns app-server service tiers with models", async () => {
    const appServer = {
      listModels: vi.fn<() => Promise<unknown[]>>(async () => [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          serviceTiers: [
            {
              id: "priority",
              name: "Fast",
              description: "1.5x speed, increased usage",
            },
          ],
        },
      ]),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath: "/tmp/codex-relay",
    });

    const response = await app.request("/v1/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models[0]).toMatchObject({
      model: "gpt-5.5",
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
    });
  });

  it("keeps legacy file runtime preferences after server restarts", async () => {
    const workspacePath = "/tmp/codex-relay";
    const preferencesPath = join(
      await mkdtemp(join(tmpdir(), "codex-relay-preferences-")),
      "preferences.json",
    );
    await writeFile(
      preferencesPath,
      `${JSON.stringify({
        model: "gpt-5.5",
        reasoningEffort: "high",
        runtimeMode: "full-access",
      })}\n`,
    );

    let app = createApp({
      codex: createMockCodex(),
      preferences: createFileRuntimePreferencesStore(preferencesPath),
      workspacePath,
    });
    let status = await app.request("/v1/status");
    let statusBody = await status.json();

    expect(statusBody.preferences).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    });

    await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        reasoningEffort: "low",
        runtimeMode: "auto",
        workspacePath,
      }),
    });
    app = createApp({
      codex: createMockCodex(),
      preferences: createFileRuntimePreferencesStore(preferencesPath),
      workspacePath,
    });
    status = await app.request("/v1/status");
    statusBody = await status.json();

    expect(statusBody.preferences).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "low",
      runtimeMode: "auto",
    });
    expect(statusBody.runtimePreferencesByWorkspacePath).toEqual({
      [workspacePath]: {
        model: "gpt-5.4",
        reasoningEffort: "low",
        runtimeMode: "auto",
      },
    });
  });

  it("persists active thread runtime preferences to the selected workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const preferencesPath = join(
      await mkdtemp(join(tmpdir(), "codex-relay-preferences-")),
      "preferences.json",
    );
    let app = createApp({
      codex: createMockCodex(),
      preferences: createFileRuntimePreferencesStore(preferencesPath),
      workspacePath,
    });
    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Workspace permissions" }),
    });
    const createBody = await createResponse.json();

    const update = await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        reasoningEffort: "high",
        runtimeMode: "full-access",
        threadId: createBody.thread.id,
        workspacePath,
      }),
    });
    const updateBody = await update.json();
    const status = await app.request("/v1/status");
    const statusBody = await status.json();

    expect(update.status).toBe(200);
    expect(updateBody).toMatchObject({
      preferences: {
        model: "gpt-5.5",
        reasoningEffort: "high",
        runtimeMode: "full-access",
      },
      runtimePreferencesByWorkspacePath: {
        [workspacePath]: {
          model: "gpt-5.5",
          reasoningEffort: "high",
          runtimeMode: "full-access",
        },
      },
      workspacePath,
    });
    expect(updateBody).not.toHaveProperty("threadId");
    expect(statusBody.preferences).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    });

    app = createApp({
      codex: createMockCodex(),
      preferences: createFileRuntimePreferencesStore(preferencesPath),
      workspacePath,
    });
    const restartedStatus = await app.request("/v1/status");
    const restartedStatusBody = await restartedStatus.json();

    expect(restartedStatusBody.preferences).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    });
  });

  it("defers runtime preferences until a thread starts running", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const startOptions: Parameters<CodexClient["startThread"]>[0][] = [];
    const resumeOptions: Parameters<CodexClient["resumeThread"]>[1][] = [];
    const app = createApp({
      codex: createMockCodex({
        onResumeThread: (_threadId, options) => resumeOptions.push(options),
        onStartThread: (options) => startOptions.push(options),
      }),
      workspacePath,
    });

    await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        runtimeMode: "auto",
      }),
    });
    const response = await app.request("/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New chat" }),
    });
    const createBody = await response.json();

    expect(response.status).toBe(201);
    expect(startOptions[0]).toMatchObject({
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    });
    expect(createBody.thread).not.toHaveProperty("model");
    expect(createBody.thread).not.toHaveProperty("reasoningEffort");
    expect(createBody.thread).not.toHaveProperty("runtimeMode");

    const runResponse = await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalPolicy: "never",
        prompt: "Continue",
        sandboxMode: "danger-full-access",
      }),
    });
    const runBody = await runResponse.json();

    expect(runResponse.status).toBe(200);
    expect(resumeOptions[0]).toMatchObject({
      approvalPolicy: "never",
      model: "gpt-5.5",
      modelReasoningEffort: "xhigh",
      sandboxMode: "danger-full-access",
    });
    expect(runBody.thread).toMatchObject({
      approvalPolicy: "never",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      runtimeMode: "auto",
      sandboxMode: "danger-full-access",
    });

    await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        reasoningEffort: "low",
        runtimeMode: "default",
      }),
    });
    const followupResponse = await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Continue again" }),
    });
    const followupBody = await followupResponse.json();

    expect(followupResponse.status).toBe(200);
    expect(resumeOptions[1]).toMatchObject({
      approvalPolicy: "on-request",
      model: "gpt-5.4",
      modelReasoningEffort: "low",
      sandboxMode: "workspace-write",
    });
    expect(followupBody.thread).toMatchObject({
      approvalPolicy: "on-request",
      model: "gpt-5.4",
      reasoningEffort: "low",
      runtimeMode: "default",
      sandboxMode: "workspace-write",
    });
  });

  it("uses the current directory as the default workspace", async () => {
    const app = createApp({ codex: createMockCodex() });

    const response = await app.request("/v1/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      workspacePath: process.cwd(),
    });
  });

  it("lists workspace directories within the configured workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await mkdir(join(workspacePath, "apps"));
    await mkdir(join(workspacePath, ".hidden"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace-directories");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      rootPath: workspacePath,
      path: workspacePath,
      parentPath: dirname(workspacePath),
      directories: [{ name: "apps", path: join(workspacePath, "apps") }],
    });
  });

  it("lists available workspace skills", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const skillPath = join(workspacePath, ".agents", "skills", "agent-device");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      [
        "---",
        "name: agent-device",
        "description: Automates interactions for mobile devices.",
        "---",
        "",
        "# Agent Device",
        "",
      ].join("\n"),
    );
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/skills");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent-device",
          displayName: "Agent Device",
          description: "Automates interactions for mobile devices.",
          source: "workspace",
          sourceLabel: basename(workspacePath),
        }),
      ]),
    );
  });

  it("lists workspace skills from symlinked skill directories", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const vendorPath = await mkdtemp(join(tmpdir(), "codex-relay-vendor-skills-"));
    const vendorSkillPath = join(vendorPath, "marimo-notebook");
    const workspaceSkillsPath = join(workspacePath, ".agents", "skills");
    const workspaceSkillLink = join(workspaceSkillsPath, "marimo-notebook");
    await mkdir(vendorSkillPath, { recursive: true });
    await mkdir(workspaceSkillsPath, { recursive: true });
    await writeFile(
      join(vendorSkillPath, "SKILL.md"),
      [
        "---",
        "name: marimo-notebook",
        "description: Write marimo notebooks.",
        "---",
        "",
        "# Marimo Notebook",
        "",
      ].join("\n"),
    );
    await symlink(vendorSkillPath, workspaceSkillLink, "dir");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/skills");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "marimo-notebook",
          displayName: "Marimo Notebook",
          description: "Write marimo notebooks.",
          path: join(workspaceSkillLink, "SKILL.md"),
          source: "workspace",
          sourceLabel: basename(workspacePath),
        }),
      ]),
    );
  });

  it("parses folded descriptions and ignores headings inside code fences", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const skillPath = join(workspacePath, ".agents", "skills", "marimo-pair");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      [
        "---",
        "name: marimo-pair",
        "description: >-",
        "  Drive a live marimo notebook as a workspace.",
        "  Inspect live notebook state.",
        "---",
        "",
        "Introductory text without a top-level heading.",
        "",
        "```python",
        "# Public definitions: values, total, i, value, mean",
        "values = [1, 2, 3]",
        "```",
        "",
      ].join("\n"),
    );
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/skills");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "marimo-pair",
          displayName: "Marimo Pair",
          description: "Drive a live marimo notebook as a workspace. Inspect live notebook state.",
        }),
      ]),
    );
  });

  it("lists directories outside the configured workspace when a cwd points there", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const externalPath = await mkdtemp(join(tmpdir(), "codex-relay-external-"));
    await mkdir(join(externalPath, "sibling-project"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request(
      `/v1/workspace-directories?path=${encodeURIComponent(externalPath)}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      rootPath: workspacePath,
      path: externalPath,
      parentPath: dirname(externalPath),
      directories: [{ name: "sibling-project", path: join(externalPath, "sibling-project") }],
    });
  });

  it("creates, reads, writes, and closes a workspace terminal session", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const startResponse = await app.request("/v1/workspace/terminal/sessions", {
      method: "POST",
      body: JSON.stringify({ cols: 80, rows: 24 }),
      headers: { "content-type": "application/json" },
    });
    const startBody = await startResponse.json();

    expect(startResponse.status).toBe(200);
    expect(startBody).toMatchObject({
      cols: 80,
      rows: 24,
      workspacePath,
    });
    expect(startBody.sessionId).toEqual(expect.any(String));

    const legacyInputResponse = await app.request(
      `/v1/workspace/terminal/sessions/${startBody.sessionId}/input`,
      {
        method: "POST",
        body: JSON.stringify({ input: "printf legacy-terminal-smoke\\n\n" }),
        headers: { "content-type": "application/json" },
      },
    );
    expect(legacyInputResponse.status).toBe(204);

    const inputResponse = await app.request(
      `/v1/workspace/terminal/sessions/${startBody.sessionId}/input`,
      {
        method: "POST",
        body: JSON.stringify({ data: "printf terminal-smoke\\n\nexit\n" }),
        headers: { "content-type": "application/json" },
      },
    );
    expect(inputResponse.status).toBe(204);

    await waitUntil(async () => {
      const outputResponse = await app.request(
        `/v1/workspace/terminal/sessions/${startBody.sessionId}/output?since=0`,
      );
      const outputBody = await outputResponse.json();
      expect(outputResponse.status).toBe(200);
      const output = outputBody.chunks.map((chunk: { data: string }) => chunk.data).join("");
      expect(output).toContain("legacy-terminal-smoke");
      expect(output).toContain("terminal-smoke");
    });

    const closeResponse = await app.request(
      `/v1/workspace/terminal/sessions/${startBody.sessionId}`,
      { method: "DELETE" },
    );
    expect(closeResponse.status).toBe(204);
  });

  it("starts Tailscale Serve for a workspace web preview URL", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const servedUrls: string[] = [];
    const app = createApp({
      codex: createMockCodex(),
      tailscaleServeForPreviewUrl: async ({ url }) => {
        servedUrls.push(url);
        return {
          port: 3000,
          url: "https://device.tailnet.ts.net",
        };
      },
      workspacePath,
    });

    const response = await app.request("/v1/workspace/tailscale/serve", {
      method: "POST",
      body: JSON.stringify({ url: "http://100.103.76.81:3000/" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(servedUrls).toEqual(["http://100.103.76.81:3000/"]);
    expect(body).toEqual({
      port: 3000,
      url: "https://device.tailnet.ts.net",
    });
  });

  it("rejects non-Tailscale workspace web preview URLs before starting Serve", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/tailscale/serve", {
      method: "POST",
      body: JSON.stringify({ url: "http://192.168.1.4:3000/" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "invalid_tailscale_preview_url",
      },
    });
  });

  it("streams workspace terminal output without repeated output reads", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const startResponse = await app.request("/v1/workspace/terminal/sessions", {
      method: "POST",
      body: JSON.stringify({ cols: 80, rows: 24 }),
      headers: { "content-type": "application/json" },
    });
    const startBody = await startResponse.json();
    const streamResponse = await app.request(
      `/v1/workspace/terminal/sessions/${startBody.sessionId}/output/stream?since=0`,
    );
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");

    const inputResponse = await app.request(
      `/v1/workspace/terminal/sessions/${startBody.sessionId}/input`,
      {
        method: "POST",
        body: JSON.stringify({ data: "printf terminal-stream-smoke\\n\nexit\n" }),
        headers: { "content-type": "application/json" },
      },
    );
    expect(inputResponse.status).toBe(204);

    const reader = streamResponse.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let streamedText = "";
    await Promise.race([
      (async () => {
        for (;;) {
          const result = await reader!.read();
          if (result.done) {
            return;
          }
          streamedText += decoder.decode(result.value, { stream: true });
          if (streamedText.includes("terminal-stream-smoke")) {
            await reader!.cancel();
            return;
          }
        }
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for terminal stream output.")), 1000),
      ),
    ]);

    expect(streamedText).toContain("event: output");
    expect(streamedText).toContain("terminal-stream-smoke");
  });

  it("returns git status and diff for workspace changes", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await git(workspacePath, ["init", "-b", "main"]);
    await git(workspacePath, ["config", "user.email", "test@example.com"]);
    await git(workspacePath, ["config", "user.name", "Test User"]);
    await writeFile(join(workspacePath, ".gitignore"), "ignored/\n");
    await writeFile(join(workspacePath, "README.md"), "hello\n");
    await git(workspacePath, ["add", ".gitignore", "README.md"]);
    await git(workspacePath, ["commit", "-m", "initial"]);
    await writeFile(join(workspacePath, "README.md"), "hello mobile\n");
    await mkdir(join(workspacePath, "ignored"));
    await writeFile(join(workspacePath, "ignored", "cache.log"), "ignored\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/changes");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      workspacePath,
      hasChanges: true,
      currentBranch: "main",
      branches: [{ current: true, name: "main" }],
    });
    expect(body.status).toContain("M README.md");
    expect(body.diff).toContain("-hello");
    expect(body.diff).toContain("+hello mobile");
    expect(body.files).not.toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining("ignored"),
      }),
    );
    expect(body.stats).toMatchObject({
      additions: 1,
      deletions: 1,
      filesChanged: 1,
    });
    expect(body.files).toEqual([
      expect.objectContaining({
        additions: 1,
        deletions: 1,
        oldPath: "README.md",
        path: "README.md",
        status: "Modified",
      }),
    ]);
    expect(body.files[0].patch).toContain("diff --git a/README.md b/README.md");
  }, 15_000);

  it("returns git status and diff for a selected thread workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const threadWorkspacePath = join(workspacePath, "apps", "mobile");
    await mkdir(threadWorkspacePath, { recursive: true });
    await git(threadWorkspacePath, ["init", "-b", "main"]);
    await git(threadWorkspacePath, ["config", "user.email", "test@example.com"]);
    await git(threadWorkspacePath, ["config", "user.name", "Test User"]);
    await writeFile(join(threadWorkspacePath, "README.md"), "hello\n");
    await git(threadWorkspacePath, ["add", "README.md"]);
    await git(threadWorkspacePath, ["commit", "-m", "initial"]);
    await writeFile(join(threadWorkspacePath, "README.md"), "hello thread\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request(
      `/v1/workspace/changes?workspacePath=${encodeURIComponent(threadWorkspacePath)}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      workspacePath: threadWorkspacePath,
      hasChanges: true,
      currentBranch: "main",
    });
    expect(body.diff).toContain("+hello thread");
  }, 15_000);

  it("checks out a workspace branch", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await git(workspacePath, ["init", "-b", "main"]);
    await git(workspacePath, ["config", "user.email", "test@example.com"]);
    await git(workspacePath, ["config", "user.name", "Test User"]);
    await writeFile(join(workspacePath, "README.md"), "hello\n");
    await git(workspacePath, ["add", "README.md"]);
    await git(workspacePath, ["commit", "-m", "initial"]);
    await git(workspacePath, ["checkout", "-b", "feature/mobile"]);
    await git(workspacePath, ["checkout", "main"]);
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const checkoutResponse = await app.request("/v1/workspace/checkout", {
      method: "POST",
      body: JSON.stringify({ branch: "feature/mobile" }),
      headers: { "content-type": "application/json" },
    });
    const checkoutBody = await checkoutResponse.json();

    expect(checkoutResponse.status).toBe(200);
    expect(checkoutBody).toMatchObject({
      branch: "feature/mobile",
      message: "Checked out feature/mobile.",
    });

    const changesResponse = await app.request("/v1/workspace/changes");
    const changesBody = await changesResponse.json();
    expect(changesBody).toMatchObject({
      currentBranch: "feature/mobile",
      branches: expect.arrayContaining([
        { current: true, name: "feature/mobile" },
        { current: false, name: "main" },
      ]),
    });
  }, 15_000);

  it("creates and checks out a missing workspace branch", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await git(workspacePath, ["init", "-b", "main"]);
    await git(workspacePath, ["config", "user.email", "test@example.com"]);
    await git(workspacePath, ["config", "user.name", "Test User"]);
    await writeFile(join(workspacePath, "README.md"), "hello\n");
    await git(workspacePath, ["add", "README.md"]);
    await git(workspacePath, ["commit", "-m", "initial"]);
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const checkoutResponse = await app.request("/v1/workspace/checkout", {
      method: "POST",
      body: JSON.stringify({ branch: "feature/new-mobile-flow" }),
      headers: { "content-type": "application/json" },
    });
    const checkoutBody = await checkoutResponse.json();

    expect(checkoutResponse.status).toBe(200);
    expect(checkoutBody).toMatchObject({
      branch: "feature/new-mobile-flow",
      message: "Created and checked out feature/new-mobile-flow.",
    });

    const changesResponse = await app.request("/v1/workspace/changes");
    const changesBody = await changesResponse.json();
    expect(changesBody).toMatchObject({
      currentBranch: "feature/new-mobile-flow",
      branches: expect.arrayContaining([
        { current: true, name: "feature/new-mobile-flow" },
        { current: false, name: "main" },
      ]),
    });
  }, 15_000);

  it("requires secure pairing when pairing is enabled", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        createClientToken: () => "client-token",
        hashClientToken: (token) => token,
        sessions,
        tokenTtlMs: 60_000,
      },
    });

    const unauthenticated = await app.request("/v1/status");
    expect(unauthenticated.status).toBe(401);

    const version = await app.request("/version");
    expect(version.status).toBe(200);

    const insecurePairing = await app.request("/v1/pair", {
      method: "POST",
      body: JSON.stringify({ clientName: "test phone" }),
      headers: { "content-type": "application/json" },
    });
    expect(insecurePairing.status).toBe(400);
  });

  it("rejects expired client tokens", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    await sessions.createSession("expired-client-token", { expiresAt: Date.now() - 1 });
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        createClientToken: () => "client-token",
        hashClientToken: (token) => token,
        sessions,
        tokenTtlMs: 60_000,
      },
    });

    const authenticated = await app.request("/v1/status", {
      headers: { authorization: "Bearer expired-client-token" },
    });
    expect(authenticated.status).toBe(401);
    expect(await sessions.getValidSession("expired-client-token", Date.now())).toBeUndefined();
  });

  it("counts active clients by stable client session id and replaces stale tokens", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;

    await sessions.createSession("legacy-client-token", {
      clientName: "test phone",
      expiresAt,
    });
    await sessions.createSession("client-token-1", {
      clientName: "test phone",
      clientSessionId: "phone-session",
      expiresAt,
    });
    expect(await sessions.countActive(Date.now())).toBe(1);

    await sessions.createSession("client-token-2", {
      clientName: "test phone",
      clientSessionId: "phone-session",
      expiresAt,
    });

    expect(await sessions.countActive(Date.now())).toBe(1);
    expect(await sessions.getValidSession("legacy-client-token", Date.now())).toBeUndefined();
    expect(await sessions.getValidSession("client-token-1", Date.now())).toBeUndefined();
    expect(await sessions.getValidSession("client-token-2", Date.now())).toMatchObject({
      clientName: "test phone",
      clientSessionId: "phone-session",
    });
  });

  it("rejects secure tokens when the in-process e2ee session is gone", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    await sessions.createSession("client-token", { expiresAt: Date.now() + 60_000 });
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        createClientToken: () => "client-token",
        hashClientToken: (token) => token,
        serverIdentity: createServerIdentity(),
        sessions,
        tokenTtlMs: 60_000,
      },
    });

    const authenticated = await app.request("/v1/status", {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await authenticated.json();

    expect(authenticated.status).toBe(401);
    expect(body).toMatchObject({
      error: {
        code: "secure_session_required",
      },
    });
  });

  it("clears paired sessions and pending pairing requests from a local clear command", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("client-token", { clientName: "test phone", expiresAt });
    await sessions.createPendingPairing({
      approvalCode: "1234-5678",
      approved: false,
      clientEphemeralPublicKey: "client-public-key",
      clientNonce: "client-nonce",
      expiresAt,
      serverUrl: "http://127.0.0.1",
    });
    const onPairingsCleared =
      vi.fn<(result: { pendingPairingsCleared: number; sessionsCleared: number }) => void>();
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        approvalSecret: "approve-secret",
        createClientToken: () => "client-token",
        hashClientToken: (token) => token,
        onPairingsCleared,
        sessions,
        tokenTtlMs: 60_000,
      },
    });

    const authenticated = await app.request("/v1/status", {
      headers: { authorization: "Bearer client-token" },
    });
    expect(authenticated.status).toBe(200);

    const unauthorizedClear = await app.request("/v1/sessions/clear", {
      method: "POST",
    });
    expect(unauthorizedClear.status).toBe(401);

    const clear = await app.request("/v1/sessions/clear", {
      method: "POST",
      headers: { "x-codex-relay-approve-secret": "approve-secret" },
    });
    const clearBody = await clear.json();

    expect(clear.status).toBe(200);
    expect(clearBody).toMatchObject({
      ok: true,
      pendingPairingsCleared: 1,
      sessionsCleared: 1,
    });
    expect(onPairingsCleared).toHaveBeenCalledWith({
      pendingPairingsCleared: 1,
      sessionsCleared: 1,
    });
    expect(await sessions.countActive(Date.now())).toBe(0);
    expect(await sessions.getPendingPairing("1234-5678", Date.now())).toBeUndefined();

    const afterClear = await app.request("/v1/status", {
      headers: { authorization: "Bearer client-token" },
    });
    expect(afterClear.status).toBe(401);
  });

  it("approves pairing requests and encrypts paired responses", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const serverIdentity = createServerIdentity();
    const tokens = ["client-token", "client-token-2"];
    const onPairApprovalRequested =
      vi.fn<(client: { approvalCode: string; clientName?: string }) => void>();
    const onPairApproved = vi.fn<(client: { approvalCode: string; clientName?: string }) => void>();
    const onPaired = vi.fn<(client: { clientName?: string; tokenCount: number }) => void>();
    const onTokenRefreshed = vi.fn<(client: { clientName?: string; tokenCount: number }) => void>();
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        approvalSecret: "approve-secret",
        createClientToken: () => tokens.shift()!,
        hashClientToken: (token) => token,
        onPairApprovalRequested,
        onPairApproved,
        onPaired,
        onTokenRefreshed,
        serverIdentity,
        sessions,
        tokenTtlMs: 60_000,
      },
      workspacePath: "/tmp/codex-relay",
    });
    const clientPrivateKey = x25519.utils.randomSecretKey();
    const clientPublicKey = fromByteArray(x25519.getPublicKey(clientPrivateKey));
    const clientNonce = fromByteArray(randomBytes(32));

    const pairing = await app.request("http://127.0.0.1/v1/pair", {
      method: "POST",
      body: JSON.stringify({
        clientSessionId: "phone-session",
        clientName: "test phone",
        secure: {
          clientEphemeralPublicKey: clientPublicKey,
          clientNonce,
          protocolVersion: 1,
        },
      }),
      headers: { "content-type": "application/json" },
    });
    const pairingBody = await pairing.json();

    expect(pairing.status).toBe(202);
    expect(pairingBody.approvalCode).toEqual(expect.any(String));
    expect(pairingBody.secure).toBeUndefined();
    expect(onPairApprovalRequested).toHaveBeenCalledWith({
      approvalCode: pairingBody.approvalCode,
      clientName: "test phone",
    });

    const pending = await app.request(`/v1/pair/${pairingBody.approvalCode}`);
    expect(pending.status).toBe(202);

    const unauthorizedApproval = await app.request("/v1/pair/approve", {
      method: "POST",
      body: JSON.stringify({ approvalCode: pairingBody.approvalCode }),
      headers: { "content-type": "application/json" },
    });
    expect(unauthorizedApproval.status).toBe(401);

    const approval = await app.request("/v1/pair/approve", {
      method: "POST",
      body: JSON.stringify({ approvalCode: pairingBody.approvalCode }),
      headers: {
        "content-type": "application/json",
        "x-codex-relay-approve-secret": "approve-secret",
      },
    });
    expect(approval.status).toBe(200);
    expect(onPairApproved).toHaveBeenCalledWith({
      approvalCode: pairingBody.approvalCode,
      clientName: "test phone",
    });

    const approved = await app.request(`/v1/pair/${pairingBody.approvalCode}`);
    const approvedBody = await approved.json();

    expect(approved.status).toBe(201);
    expect(approvedBody.clientToken).toBeUndefined();
    expect(approvedBody.secure?.encryptedPayload).toEqual(expect.any(String));
    expect(onPaired).toHaveBeenCalledWith({ clientName: "test phone", tokenCount: 1 });

    const transcript = testPairingTranscript({
      approvalCode: pairingBody.approvalCode,
      clientEphemeralPublicKey: clientPublicKey,
      clientNonce,
      keyEpoch: approvedBody.secure.keyEpoch,
      serverEphemeralPublicKey: approvedBody.secure.serverEphemeralPublicKey,
      serverIdentityPublicKey: serverIdentity.publicKey,
      serverNonce: approvedBody.secure.serverNonce,
      serverUrl: "http://127.0.0.1",
    });
    expect(
      ed25519.verify(
        toByteArray(approvedBody.secure.serverSignature),
        transcript,
        toByteArray(serverIdentity.publicKey),
      ),
    ).toBe(true);

    const sharedSecret = x25519.getSharedSecret(
      clientPrivateKey,
      toByteArray(approvedBody.secure.serverEphemeralPublicKey),
    );
    const keys = testDeriveSession(sharedSecret, transcript, approvedBody.secure.keyEpoch);
    const tokenPayload = JSON.parse(
      testDecrypt(keys.serverToMobileKey, "server", 0, approvedBody.secure.encryptedPayload),
    );
    expect(tokenPayload.clientToken).toBe("client-token");
    expect(await sessions.getValidSession("client-token", Date.now())).toMatchObject({
      clientName: "test phone",
      clientSessionId: "phone-session",
    });

    const status = await app.request("/v1/status", {
      headers: { authorization: "Bearer client-token" },
    });
    const statusEnvelope = await status.json();
    expect(statusEnvelope.sender).toBe("server");
    const statusBody = JSON.parse(
      testDecrypt(keys.serverToMobileKey, "server", 1, statusEnvelope.ciphertext),
    );
    expect(statusBody).toMatchObject({
      ok: true,
      machineName: expect.any(String),
      workspacePath: "/tmp/codex-relay",
    });

    const refresh = await app.request("/v1/session/refresh", {
      method: "POST",
      headers: { authorization: "Bearer client-token" },
    });
    expect(refresh.status).toBe(201);
    expect(await sessions.getValidSession("client-token", Date.now())).toBeUndefined();
    expect(await sessions.getValidSession("client-token-2", Date.now())).toMatchObject({
      clientName: "test phone",
      clientSessionId: "phone-session",
    });
    expect(onTokenRefreshed).toHaveBeenCalledWith({ clientName: "test phone", tokenCount: 1 });
  }, 15_000);

  it("auto-approves pairing when the dangerous auto-approve option is enabled", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const serverIdentity = createServerIdentity();
    const onPairApprovalRequested =
      vi.fn<(client: { approvalCode: string; clientName?: string }) => void>();
    const onPairApproved = vi.fn<(client: { approvalCode: string; clientName?: string }) => void>();
    const app = createApp({
      codex: createMockCodex(),
      pairing: {
        approvalSecret: "approve-secret",
        createClientToken: () => "client-token",
        hashClientToken: (token) => token,
        onPairApprovalRequested,
        onPairApproved,
        dangerouslyAutoApprove: true,
        serverIdentity,
        sessions,
        tokenTtlMs: 60_000,
      },
      workspacePath: "/tmp/codex-relay",
    });

    const clientPrivateKey = x25519.utils.randomSecretKey();
    const matchedPairing = await app.request("http://127.0.0.1/v1/pair", {
      method: "POST",
      body: JSON.stringify({
        clientName: "test phone",
        secure: {
          clientEphemeralPublicKey: fromByteArray(x25519.getPublicKey(clientPrivateKey)),
          clientNonce: fromByteArray(randomBytes(32)),
          protocolVersion: 1,
        },
      }),
      headers: { "content-type": "application/json" },
    });
    const matchedBody = await matchedPairing.json();
    expect(matchedPairing.status).toBe(202);
    expect((await app.request(`/v1/pair/${matchedBody.approvalCode}`)).status).toBe(201);
    expect(onPairApproved).toHaveBeenCalledWith({
      approvalCode: matchedBody.approvalCode,
      clientName: "test phone",
    });
    expect(onPairApprovalRequested).not.toHaveBeenCalled();
  });

  it("starts a thread and runs an initial prompt", async () => {
    const app = createApp({ codex: createMockCodex() });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ prompt: "Inspect the project" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "thread-1",
      title: "Inspect the project",
      state: "completed",
      lastPrompt: "Inspect the project",
    });
    expect(body.result).toBe("result: Inspect the project");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: "user", content: "Inspect the project" });
    expect(body.messages[1]).toMatchObject({
      role: "assistant",
      content: "result: Inspect the project",
    });
  });

  it("persists collaboration mode in thread summaries", async () => {
    const app = createApp({ codex: createMockCodex() });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ collaborationMode: "plan", title: "Plan thread" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();
    const listResponse = await app.request("/v1/threads");
    const listBody = await listResponse.json();

    expect(response.status).toBe(201);
    expect(body.thread).toMatchObject({ collaborationMode: "plan" });
    expect(listBody.threads[0]).toMatchObject({ collaborationMode: "plan" });
  });

  it("starts a new thread in the selected workspace directory", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const externalPath = await mkdtemp(join(tmpdir(), "codex-relay-external-"));
    const appPath = join(externalPath, "apps");
    await mkdir(appPath);
    const startOptions: Parameters<CodexClient["startThread"]>[0][] = [];
    const app = createApp({
      codex: createMockCodex({ onStartThread: (options) => startOptions.push(options) }),
      workspacePath,
    });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Mobile app", workspacePath: appPath }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(startOptions[0]).toMatchObject({ workingDirectory: appPath });
    expect(body.thread).toMatchObject({ cwd: appPath });
  });

  it("archives in-memory threads", async () => {
    const app = createApp({ codex: createMockCodex() });

    const firstResponse = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "First thread" }),
      headers: { "content-type": "application/json" },
    });
    const firstBody = await firstResponse.json();
    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Second thread" }),
      headers: { "content-type": "application/json" },
    });

    const archiveResponse = await app.request(`/v1/threads/${firstBody.thread.id}`, {
      method: "DELETE",
    });
    const archiveBody = await archiveResponse.json();
    const detailResponse = await app.request(`/v1/threads/${firstBody.thread.id}`);

    expect(archiveResponse.status).toBe(200);
    expect(archiveBody).toMatchObject({
      archivedThreadId: firstBody.thread.id,
      source: "memory",
    });
    expect(archiveBody.threads).toHaveLength(1);
    expect(archiveBody.threads[0].title).toBe("Second thread");
    expect(detailResponse.status).toBe(404);
  });

  it("archives app-server threads through the Codex app-server", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const remainingThread = {
      id: "app-thread-remaining",
      preview: "Remaining thread",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      cwd: workspacePath,
      source: "app-server",
      modelProvider: "openai",
      name: "Remaining thread",
      turns: [],
    };
    const archiveThread = vi.fn<(params: { threadId: string }) => Promise<void>>(
      async () => undefined,
    );
    const appServer = {
      archiveThread,
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [remainingThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => remainingThread),
      startThread: vi.fn<() => Promise<unknown>>(async () => remainingThread),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-archive", { method: "DELETE" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(archiveThread).toHaveBeenCalledWith({ threadId: "app-thread-archive" });
    expect(body).toMatchObject({
      archivedThreadId: "app-thread-archive",
      source: "app-server",
    });
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({
      id: "app-thread-remaining",
      title: "Remaining thread",
    });
  });

  it("reads an app-server thread goal", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-goal",
      preview: "Thread with goal",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      cwd: workspacePath,
      source: "app",
      modelProvider: "openai",
      name: "Thread with goal",
      turns: [],
    };
    const appServer = {
      getThreadGoal: vi.fn<() => Promise<unknown>>(async () => ({
        threadId: "app-thread-goal",
        objective: "Ship goal UI",
        status: "active",
        tokenBudget: null,
        tokensUsed: 321,
        timeUsedSeconds: 42,
        createdAt: now,
        updatedAt: now,
      })),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-goal/goal");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(appServer.getThreadGoal).toHaveBeenCalledWith({ threadId: "app-thread-goal" });
    expect(body).toMatchObject({
      goal: {
        objective: "Ship goal UI",
        status: "active",
        timeUsedSeconds: 42,
        tokensUsed: 321,
      },
      thread: {
        goal: {
          objective: "Ship goal UI",
          status: "active",
        },
        id: "app-thread-goal",
      },
    });
  });

  it("updates and clears an app-server thread goal", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-goal-actions",
      preview: "Thread with editable goal",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      cwd: workspacePath,
      source: "app",
      modelProvider: "openai",
      name: "Thread with editable goal",
      turns: [],
    };
    const setThreadGoal = vi.fn<() => Promise<unknown>>(async () => ({
      threadId: "app-thread-goal-actions",
      objective: "Updated objective",
      status: "paused",
      tokenBudget: null,
      tokensUsed: 7,
      timeUsedSeconds: 11,
      createdAt: now,
      updatedAt: now,
    }));
    const clearThreadGoal = vi.fn<() => Promise<void>>(async () => undefined);
    const appServer = {
      clearThreadGoal,
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      setThreadGoal,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const updateResponse = await app.request("/v1/threads/app-thread-goal-actions/goal", {
      method: "POST",
      body: JSON.stringify({ objective: "Updated objective", status: "paused" }),
      headers: { "content-type": "application/json" },
    });
    const updateBody = await updateResponse.json();
    const clearResponse = await app.request("/v1/threads/app-thread-goal-actions/goal", {
      method: "DELETE",
    });
    const clearBody = await clearResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(setThreadGoal).toHaveBeenCalledWith({
      threadId: "app-thread-goal-actions",
      objective: "Updated objective",
      status: "paused",
      tokenBudget: undefined,
    });
    expect(updateBody.thread.goal).toMatchObject({
      objective: "Updated objective",
      status: "paused",
    });
    expect(clearResponse.status).toBe(200);
    expect(clearThreadGoal).toHaveBeenCalledWith({ threadId: "app-thread-goal-actions" });
    expect(clearBody.goal).toBeNull();
    expect(clearBody.thread.goal).toBeNull();
  });

  it("preserves active state for empty app-server threads", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-empty-active",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Empty active",
        preview: "Empty active",
        source: "app",
        status: { type: "active" },
        turns: [],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "New chat" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.thread).toMatchObject({
      id: "app-thread-empty-active",
      state: "running",
      messageCount: 0,
    });
  });

  it("attaches to an already-running empty app-server thread", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-empty-stream",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Empty stream",
      preview: "Empty stream",
      source: "app",
      status: { type: "active" },
      turns: [],
      updatedAt: now,
    };
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "thread/status/changed",
              params: { status: { type: "idle" }, threadId: "app-thread-empty-stream" },
            });
          }
        });
        return appThread;
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-empty-stream/runs/stream", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(appServer.readThread).toHaveBeenCalled();
    expect(body).toContain('"state":"running"');
    expect(body).toContain('"state":"idle"');
  });

  it("keeps attached running app-server streams alive through transient idle status", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-transient-idle",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Transient idle",
      preview: "Transient idle",
      source: "app",
      status: { type: "active" },
      turns: [],
      updatedAt: now,
    };
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "turn/started",
              params: {
                threadId: "app-thread-transient-idle",
                turnId: "turn-transient-idle",
              },
            });
            handler({
              method: "thread/status/changed",
              params: {
                status: { type: "idle" },
                threadId: "app-thread-transient-idle",
              },
            });
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "still running",
                itemId: "assistant-transient-idle",
                threadId: "app-thread-transient-idle",
                turnId: "turn-transient-idle",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-transient-idle",
                turn: {
                  id: "turn-transient-idle",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return appThread;
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-transient-idle/runs/stream", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const idleIndex = body.indexOf('"state":"idle"');
    const deltaIndex = body.indexOf("still running");
    const completedIndex = body.indexOf('"state":"completed"');

    expect(response.status).toBe(200);
    expect(idleIndex).toBe(-1);
    expect(deltaIndex).toBeGreaterThan(-1);
    expect(completedIndex).toBeGreaterThan(deltaIndex);
  });

  it("treats an in-progress app-server turn as a running thread", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-in-progress-turn",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "In progress turn",
        preview: "In progress turn",
        source: "app",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-in-progress",
            completedAt: null,
            items: [],
            startedAt: now,
            status: "inProgress",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-in-progress-turn");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "app-thread-in-progress-turn",
      state: "running",
    });
  });

  it("treats non-terminal in-flight turn status variants as running", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-working-turn",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Working turn",
        preview: "Working turn",
        source: "app",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-working",
            completedAt: null,
            items: [],
            startedAt: now,
            status: { type: "working" },
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-working-turn");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "app-thread-working-turn",
      state: "running",
    });
  });

  it("does not treat completed working turn status as running", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-completed-working-turn",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Completed working turn",
        preview: "Completed working turn",
        source: "app",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-working-completed",
            completedAt: now,
            items: [],
            startedAt: now,
            status: { type: "working" },
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-completed-working-turn");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "app-thread-completed-working-turn",
      state: "idle",
    });
  });

  it("truncates large app server tool details in thread detail responses", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const largeOutput = `stdout-start\n${"o".repeat(12000)}\nstdout-end`;
    const largePatch = `diff-start\n${"p".repeat(12000)}\ndiff-end`;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-large-details",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Large details",
        preview: "Large details",
        source: "app",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-large-details",
            completedAt: now,
            items: [
              {
                id: "command-large",
                type: "commandExecution",
                command: "pnpm test",
                aggregatedOutput: largeOutput,
                status: "completed",
              },
              {
                id: "patch-large",
                type: "fileChange",
                changes: [{ kind: "modified", path: "src/app.ts" }],
                patch: largePatch,
              },
            ],
            startedAt: now,
            status: { type: "completed" },
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-large-details");
    const body = await response.json();
    const commandDetails = body.messages[0].details;
    const patchDetails = body.messages[1].details;

    expect(response.status).toBe(200);
    expect(commandDetails.output).toContain("[... truncated ");
    expect(commandDetails.output).toContain("stdout-start");
    expect(commandDetails.output).toContain("stdout-end");
    expect(commandDetails.output.length).toBeLessThan(largeOutput.length);
    expect(commandDetails.outputOriginalLength).toBe(largeOutput.length);
    expect(commandDetails.outputTruncated).toBe(true);
    expect(body.messages[1]).toMatchObject({
      content: "1 file changed: src/app.ts",
      id: "patch-large",
      kind: "fileChange",
      role: "tool",
    });
    expect(patchDetails.patch).toContain("[... truncated ");
    expect(patchDetails.patch).toContain("diff-start");
    expect(patchDetails.patch).toContain("diff-end");
    expect(patchDetails.patch.length).toBeLessThan(largePatch.length);
    expect(patchDetails.patchOriginalLength).toBe(largePatch.length);
    expect(patchDetails.patchTruncated).toBe(true);

    const outputResponse = await app.request(
      "/v1/threads/app-thread-large-details/messages/command-large/details/output",
    );
    const outputBody = await outputResponse.json();
    const patchResponse = await app.request(
      "/v1/threads/app-thread-large-details/messages/patch-large/details/patch",
    );
    const patchBody = await patchResponse.json();

    expect(outputResponse.status).toBe(200);
    expect(outputBody).toEqual({
      field: "output",
      messageId: "command-large",
      originalLength: largeOutput.length,
      value: largeOutput,
    });
    expect(patchResponse.status).toBe(200);
    expect(patchBody).toEqual({
      field: "patch",
      messageId: "patch-large",
      originalLength: largePatch.length,
      value: largePatch,
    });
  });

  it("adds plan-only guidance for SDK fallback plan mode", async () => {
    const app = createApp({ codex: createMockCodex() });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ collaborationMode: "plan", prompt: "Sketch the migration" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toContain("# Plan Mode (Conversational)");
    expect(body.result).toContain("wrap it in a `<proposed_plan>` block");
    expect(body.result).toContain("User request:\nSketch the migration");
  });

  it("passes app-server collaboration mode on streamed plan runs", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async (_params) => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: { status: "completed", threadId: "app-thread-1", turnId: "turn-1" },
          });
        }
      });
      return { id: "turn-1", items: [], status: "completed", startedAt: null, completedAt: null };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-1",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Plan thread",
        preview: "Plan thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Plan thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-1/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        collaborationMode: "plan",
        model: "gpt-5.5",
        prompt: "Plan this",
        reasoningEffort: "high",
      }),
      headers: { "content-type": "application/json" },
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: {
            developer_instructions: null,
            model: "gpt-5.5",
            reasoning_effort: "high",
          },
        },
      }),
    );
  });

  it("passes selected skills as structured app-server input items", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: { status: "completed", threadId: "app-thread-skills", turnId: "turn-1" },
          });
        }
      });
      return { id: "turn-1", items: [], status: "completed", startedAt: null, completedAt: null };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-skills",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Skill thread",
        preview: "Skill thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });
    const skillPath = join(workspacePath, ".agents", "skills", "dogfood", "SKILL.md");

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Skill thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-skills/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        prompt: `Use this skill [$dogfood](${skillPath})`,
        skills: [
          {
            name: "dogfood",
            path: skillPath,
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`Use this skill [$dogfood](${skillPath})`);
    expect(body).not.toContain('"details":{"skills"');
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          {
            type: "text",
            text: `Use this skill [$dogfood](${skillPath})`,
            text_elements: [],
          },
          { type: "skill", name: "dogfood", path: skillPath },
        ],
      }),
    );
  });

  it("passes image attachments as structured app-server local image input", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const imagePath = join(workspacePath, "photo.png");
    await writeFile(imagePath, Buffer.from("image"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: { status: "completed", threadId: "app-thread-image", turnId: "turn-1" },
          });
        }
      });
      return { id: "turn-1", items: [], status: "completed", startedAt: null, completedAt: null };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-image",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Image thread",
        preview: "Image thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });
    const attachment = {
      mimeType: "image/png",
      name: "photo.png",
      path: imagePath,
      type: "image" as const,
      url: "/v1/attachments/images/photo.png",
    };

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Image thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-image/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        attachments: [attachment],
        prompt: "Describe this",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Describe this");
    expect(body).toContain("Attached image 1 (photo.png)");
    expect(body).toContain('"content":"Describe this\\n\\nAttached image 1 (photo.png)"');
    expect(body).not.toContain("data:image/png;base64");
    expect(body).not.toContain('"dataUri"');
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          { type: "text", text: "Describe this", text_elements: [] },
          { type: "localImage", path: imagePath },
        ],
      }),
    );
  });

  it("uploads multiple image attachments from repeated multipart fields", async () => {
    const app = createApp({ codex: createMockCodex(), workspacePath: "/tmp/codex-relay" });
    const formData = new FormData();
    formData.append("images", new Blob([Buffer.from("one")], { type: "image/png" }), "one.png");
    formData.append("images", new Blob([Buffer.from("two")], { type: "image/png" }), "two.png");
    formData.append("images", new Blob([Buffer.from("three")], { type: "image/png" }), "three.png");

    const response = await app.request("/v1/attachments/images", {
      method: "POST",
      body: formData,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.attachments).toHaveLength(3);
    expect(body.attachments.map((attachment: { name: string }) => attachment.name)).toEqual([
      "one.png",
      "two.png",
      "three.png",
    ]);
    for (const attachment of body.attachments as Array<{ url: string }>) {
      const imageResponse = await app.request(attachment.url);
      expect(imageResponse.status).toBe(200);
    }
  });

  it("normalizes markdown skill mentions from app-server user message history", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const skillPath = join(workspacePath, ".agents", "skills", "dogfood", "SKILL.md");
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-skill-history",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Skill history",
        preview: "Skill history",
        source: "app",
        status: "idle",
        turns: [
          {
            id: "turn-1",
            completedAt: now,
            items: [
              {
                id: "user-1",
                content: [
                  {
                    text: `Review this [$dogfood](${skillPath})`,
                    text_elements: [],
                    type: "text",
                  },
                  { name: "dogfood", path: skillPath, type: "skill" },
                ],
                type: "userMessage",
              },
            ],
            startedAt: now,
            status: "completed",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-skill-history");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      expect.objectContaining({
        content: `Review this [$dogfood](${skillPath})`,
        id: "user-1",
        role: "user",
      }),
    ]);
  });

  it("returns local app-server image history as attachment URLs for mobile thread detail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const imagePath = join(workspacePath, "photo.png");
    await writeFile(imagePath, Buffer.from("image"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-local-image-history",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "이미지 테스트",
        preview: "이미지 테스트",
        source: "app",
        status: "idle",
        turns: [
          {
            id: "turn-1",
            completedAt: now,
            items: [
              {
                id: "user-1",
                content: [
                  { text: "이미지 테스트", text_elements: [], type: "text" },
                  { path: imagePath, type: "localImage" },
                ],
                type: "userMessage",
              },
            ],
            startedAt: now,
            status: "completed",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-local-image-history");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      content: "이미지 테스트\n\nAttached image 1",
      id: "user-1",
      role: "user",
    });
    expect(body.messages[0].details.attachments[0]).toMatchObject({
      mimeType: "image/png",
      name: "photo.png",
      path: expect.any(String),
      type: "image",
      url: expect.stringMatching(/^\/v1\/attachments\/images\/.+\.png\?v=\d+$/),
    });
    expect(body.messages[0].details.attachments[0]).not.toHaveProperty("dataUri");
  });

  it("returns local markdown images in assistant history as attachment URLs", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const imagePath = join(workspacePath, "md-preview-chat.png");
    await writeFile(imagePath, Buffer.from("image"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-assistant-markdown-image-history",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "이미지 응답 테스트",
        preview: "이미지 응답 테스트",
        source: "app",
        status: "idle",
        turns: [
          {
            id: "turn-1",
            completedAt: now,
            items: [
              {
                id: "assistant-1",
                text: `증거 스크린샷:\n![WorkspacePreview on iPhone 17](${imagePath})\n\n완료`,
                type: "agentMessage",
              },
            ],
            startedAt: now,
            status: "completed",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-assistant-markdown-image-history");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      content: "증거 스크린샷:\n\n완료",
      id: "assistant-1",
      role: "assistant",
    });
    expect(body.messages[0].details.attachments[0]).toMatchObject({
      mimeType: "image/png",
      name: "WorkspacePreview on iPhone 17",
      path: expect.any(String),
      type: "image",
      url: expect.stringMatching(/^\/v1\/attachments\/images\/.+\.png\?v=\d+$/),
    });
    expect(body.messages[0].details.attachments[0]).not.toHaveProperty("dataUri");
  });

  it("returns app-server document history as markdown attachments for mobile thread detail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const markdownPath = join(workspacePath, "hermes-v1-async-await-root-cause.md");
    await writeFile(markdownPath, "# Hermes root cause\n");
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-document-history",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "문서 테스트",
        preview: "문서 테스트",
        source: "app",
        status: "idle",
        turns: [
          {
            id: "turn-1",
            completedAt: now,
            items: [
              {
                id: "user-1",
                content: [
                  { text: "문서 테스트", text_elements: [], type: "text" },
                  {
                    mimeType: "text/markdown",
                    name: "hermes-v1-async-await-root-cause.md",
                    path: markdownPath,
                    type: "document",
                  },
                ],
                type: "userMessage",
              },
            ],
            startedAt: now,
            status: "completed",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-document-history");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      content: "문서 테스트",
      id: "user-1",
      role: "user",
    });
    expect(body.messages[0].details.attachments[0]).toMatchObject({
      mimeType: "text/markdown",
      name: "hermes-v1-async-await-root-cause.md",
      path: markdownPath,
      type: "document",
    });
  });

  it("lists workspace files for @ mention completion", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await mkdir(join(workspacePath, "apps", "mobile"), { recursive: true });
    await mkdir(join(workspacePath, "packages", "codex-relay"), { recursive: true });
    await writeFile(join(workspacePath, "package.json"), "{}\n");
    await writeFile(join(workspacePath, "apps", "mobile", "package.json"), "{}\n");
    await writeFile(join(workspacePath, "packages", "codex-relay", "package.json"), "{}\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/files?query=pac");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      directory: "",
      parentDirectory: null,
      query: "pac",
      workspacePath,
    });
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          name: "package.json",
          path: "package.json",
        }),
        expect.objectContaining({
          kind: "file",
          name: "package.json",
          path: "apps/mobile/package.json",
        }),
        expect.objectContaining({
          kind: "directory",
          name: "packages",
          path: "packages",
        }),
      ]),
    );
  });

  it("lists direct workspace file children for folder browsing", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await mkdir(join(workspacePath, "apps", "mobile", "src"), { recursive: true });
    await writeFile(join(workspacePath, "apps", "mobile", "package.json"), "{}\n");
    await writeFile(join(workspacePath, "apps", "mobile", "src", "app.tsx"), "export {};\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request(
      `/v1/workspace/files?directory=${encodeURIComponent("apps/mobile")}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      directory: "apps/mobile",
      parentDirectory: "apps",
      query: "",
      workspacePath,
    });
    expect(body.files).toEqual([
      expect.objectContaining({
        directory: "apps/mobile",
        kind: "directory",
        name: "src",
        path: "apps/mobile/src",
      }),
      expect.objectContaining({
        directory: "apps/mobile",
        kind: "file",
        name: "package.json",
        path: "apps/mobile/package.json",
      }),
    ]);
  });

  it("hides paths matched by root gitignore from workspace file browsing", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await git(workspacePath, ["init", "-b", "main"]);
    await mkdir(join(workspacePath, "apps", "mobile"), { recursive: true });
    await mkdir(join(workspacePath, "ignored"), { recursive: true });
    await mkdir(join(workspacePath, "apps", "mobile", "dist"), { recursive: true });
    await mkdir(join(workspacePath, "dogfood-output-latest"), { recursive: true });
    await writeFile(
      join(workspacePath, ".gitignore"),
      "ignored/\n*.log\nnode_modules/\ndist/\ndogfood-output-*\n",
    );
    await writeFile(join(workspacePath, "apps", "mobile", "package.json"), "{}\n");
    await writeFile(join(workspacePath, "apps", "mobile", "dist", "bundle.js"), "bundle\n");
    await writeFile(join(workspacePath, "dogfood-output-latest", "report.md"), "report\n");
    await writeFile(join(workspacePath, "ignored", "cache.txt"), "cache\n");
    await writeFile(join(workspacePath, "debug.log"), "debug\n");
    await writeFile(join(workspacePath, "README.md"), "hello\n");
    await git(workspacePath, ["add", ".gitignore", "README.md", "apps/mobile/package.json"]);
    await git(workspacePath, ["add", "-f", "debug.log"]);
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/files");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "directory",
          name: "apps",
          path: "apps",
        }),
        expect.objectContaining({
          kind: "file",
          name: "README.md",
          path: "README.md",
        }),
      ]),
    );
    expect(body.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining("ignored"),
        }),
        expect.objectContaining({
          path: expect.stringContaining("dist"),
        }),
        expect.objectContaining({
          path: expect.stringContaining("dogfood-output"),
        }),
        expect.objectContaining({
          path: "debug.log",
        }),
      ]),
    );

    const nestedResponse = await app.request(
      `/v1/workspace/files?directory=${encodeURIComponent("apps/mobile")}`,
    );
    const nestedBody = await nestedResponse.json();

    expect(nestedResponse.status).toBe(200);
    expect(nestedBody.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "apps/mobile/dist",
        }),
      ]),
    );

    const searchResponse = await app.request("/v1/workspace/files?query=dogfood");
    const searchBody = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    expect(searchBody.files).toEqual([]);
  });

  it("reads workspace file content for preview", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await mkdir(join(workspacePath, "docs"), { recursive: true });
    await writeFile(join(workspacePath, "docs", "readme.md"), "# Hello\n\nWorkspace preview.\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request(
      `/v1/workspace/file?path=${encodeURIComponent("docs/readme.md")}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      binary: false,
      content: "# Hello\n\nWorkspace preview.\n",
      directory: "docs",
      language: "markdown",
      name: "readme.md",
      path: "docs/readme.md",
      truncated: false,
      workspacePath,
    });
    expect(body.size).toBeGreaterThan(0);
  });

  it("updates workspace file content for mobile editing", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    await mkdir(join(workspacePath, "docs"), { recursive: true });
    await writeFile(join(workspacePath, "docs", "readme.md"), "# Hello\n");
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/file", {
      body: JSON.stringify({
        content: "# Updated\n\nSaved from mobile.\n",
        path: "docs/readme.md",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      binary: false,
      content: "# Updated\n\nSaved from mobile.\n",
      directory: "docs",
      language: "markdown",
      name: "readme.md",
      path: "docs/readme.md",
      truncated: false,
      workspacePath,
    });
    await expect(readFile(join(workspacePath, "docs", "readme.md"), "utf8")).resolves.toBe(
      "# Updated\n\nSaved from mobile.\n",
    );
  });

  it("rejects workspace file updates outside the workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request("/v1/workspace/file", {
      body: JSON.stringify({
        content: "nope\n",
        path: "../outside.txt",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "invalid_workspace_file_path",
      },
    });
  });

  it("rejects workspace file previews outside the workspace", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    const response = await app.request(
      `/v1/workspace/file?path=${encodeURIComponent("../outside.txt")}`,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "invalid_workspace_file_path",
      },
    });
  });

  it("streams concrete app-server plan content instead of a placeholder", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/plan/updated",
            params: {
              explanation: "plan",
              plan: ["Inspect README.md", "Update the title line", "Run formatting checks"],
              threadId: "app-thread-plan-content",
              turnId: "turn-plan-content",
            },
          });
          handler({
            method: "turn/completed",
            params: {
              status: "completed",
              threadId: "app-thread-plan-content",
              turnId: "turn-plan-content",
            },
          });
        }
      });
      return {
        completedAt: null,
        id: "turn-plan-content",
        items: [],
        startedAt: null,
        status: "completed",
      };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-plan-content",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Plan content",
        preview: "Plan content",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Plan content" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-plan-content/runs/stream", {
      method: "POST",
      body: JSON.stringify({ collaborationMode: "plan", prompt: "Plan README title update" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"kind":"plan"');
    expect(body).toContain("Inspect README.md");
    expect(body).toContain("Update the title line");
  });

  it("does not treat plain app-server agent messages as implementable plans", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const persistedThread = {
      id: "app-thread-mobile-plan-agent",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Mobile plan",
      preview: "Mobile plan",
      source: "app",
      status: "idle",
      turns: [
        {
          id: "turn-mobile-plan-agent",
          completedAt: now,
          items: [
            {
              id: "assistant-mobile-plan",
              type: "agentMessage",
              text: [
                "Concise plan: update only the README title.",
                "",
                "1. Inspect the current heading.",
                "2. Replace the first heading.",
                "3. Run checks.",
              ].join("\n"),
            },
          ],
          startedAt: now,
          status: "completed",
        },
      ],
      updatedAt: now,
    };
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => ({
      id: "turn-mobile-plan-agent",
      completedAt: now,
      items: persistedThread.turns[0].items,
      startedAt: now,
      status: "completed",
    }));
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        ...persistedThread,
        turns: [],
      })),
      startTurn,
      readThread: vi.fn<() => Promise<unknown>>(async () => persistedThread),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Mobile plan" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request(
      "/v1/threads/app-thread-mobile-plan-agent/runs/stream",
      {
        method: "POST",
        body: JSON.stringify({ collaborationMode: "plan", prompt: "Plan a README title update" }),
        headers: { "content-type": "application/json" },
      },
    );
    const streamBody = await streamResponse.text();
    const detailResponse = await app.request("/v1/threads/app-thread-mobile-plan-agent");
    const detailBody = await detailResponse.json();

    expect(streamResponse.status).toBe(200);
    expect(streamBody).not.toContain('"kind":"plan"');
    expect(streamBody).toContain("Concise plan: update only the README title.");
    expect(detailResponse.status).toBe(200);
    const assistantMessage = detailBody.messages.find(
      (message: { id: string }) => message.id === "assistant-mobile-plan",
    );
    expect(assistantMessage).toMatchObject({
      id: "assistant-mobile-plan",
      content: expect.stringContaining("Run checks."),
    });
    expect(assistantMessage.kind).not.toBe("plan");
  });

  it("maps proposed_plan app-server agent messages as implementable plans", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const persistedThread = {
      id: "app-thread-proposed-plan-agent",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Proposed plan",
      preview: "Proposed plan",
      source: "app",
      status: "idle",
      turns: [
        {
          id: "turn-proposed-plan-agent",
          completedAt: now,
          items: [
            {
              id: "assistant-proposed-plan",
              type: "agentMessage",
              text: [
                "<proposed_plan>",
                "# README Title Update",
                "",
                "## Summary",
                "Update only the README title.",
                "",
                "## Key Changes",
                "1. Inspect README.md.",
                "2. Replace the first heading.",
                "3. Run checks.",
                "</proposed_plan>",
              ].join("\n"),
            },
          ],
          startedAt: now,
          status: "completed",
        },
      ],
      updatedAt: now,
    };
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => persistedThread),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-proposed-plan-agent");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      id: "assistant-proposed-plan",
      kind: "plan",
      content: expect.stringContaining("# README Title Update"),
    });
    expect(body.messages[0].content).not.toContain("<proposed_plan>");
  });

  it("maps persisted app-server plan items to their Markdown content", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-persisted-plan",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Persisted plan",
        preview: "Persisted plan",
        source: "app",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-persisted-plan",
            completedAt: now,
            items: [
              {
                id: "plan-item",
                type: "plan",
                explanation: "plan",
                plan: [
                  { status: "pending", step: "Inspect README.md" },
                  { status: "pending", step: "Update only the title" },
                ],
              },
            ],
            startedAt: now,
            status: "completed",
          },
        ],
        updatedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-persisted-plan");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      kind: "plan",
      content: expect.stringContaining("Inspect README.md"),
    });
    expect(body.messages[0].content).toContain("Update only the title");
  });

  it("keeps app-server plan mode when no model override is provided", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async (_params) => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: { status: "completed", threadId: "app-thread-plan-default", turnId: "turn-1" },
          });
        }
      });
      return { id: "turn-1", items: [], status: "completed", startedAt: null, completedAt: null };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-plan-default",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Plan thread",
        preview: "Plan thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Plan thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-plan-default/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        collaborationMode: "plan",
        prompt: "Plan this without a model override",
      }),
      headers: { "content-type": "application/json" },
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: {
            developer_instructions: null,
            model: "gpt-5.5",
            reasoning_effort: null,
          },
        },
        model: null,
      }),
    );
  });

  it("passes explicit app-server default collaboration mode", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async (_params) => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: { status: "completed", threadId: "app-thread-default-mode", turnId: "turn-1" },
          });
        }
      });
      return { id: "turn-1", items: [], status: "completed", startedAt: null, completedAt: null };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-default-mode",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Plan thread",
        preview: "Plan thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Plan thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-default-mode/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        collaborationMode: "default",
        prompt: "Implement plan",
      }),
      headers: { "content-type": "application/json" },
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationMode: {
          mode: "default",
          settings: {
            developer_instructions: null,
            model: "gpt-5.5",
            reasoning_effort: null,
          },
        },
      }),
    );
  });

  it("does not treat app-server modelProvider as a runnable model", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: {
              status: "completed",
              threadId: "app-thread-provider",
              turnId: "turn-provider",
            },
          });
        }
      });
      return {
        id: "turn-provider",
        items: [],
        status: "running",
        startedAt: now,
        completedAt: null,
      };
    });
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-provider",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "openai",
        name: "Provider thread",
        preview: "Provider thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        serviceTier: "priority",
        reasoningEffort: "high",
        runtimeMode: "default",
      }),
    });
    const createResponse = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Provider thread" }),
      headers: { "content-type": "application/json" },
    });
    const createBody = await createResponse.json();
    const streamResponse = await app.request("/v1/threads/app-thread-provider/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
      headers: { "content-type": "application/json" },
    });
    await streamResponse.text();

    expect(createResponse.status).toBe(201);
    expect(createBody.thread).not.toHaveProperty("model");
    expect(streamResponse.status).toBe(200);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: "high",
        model: "gpt-5.5",
        serviceTier: "priority",
      }),
    );
  });

  it("preserves app-server thread runtime metadata selected from mobile across refreshes", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-runtime",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "base-model",
      name: "Runtime thread",
      preview: "Runtime thread",
      source: "app",
      status: "idle",
      turns: [],
      updatedAt: now,
    };
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      queueMicrotask(() => {
        for (const handler of notificationHandlers) {
          handler({
            method: "turn/completed",
            params: {
              status: "completed",
              threadId: "app-thread-runtime",
              turnId: "turn-runtime",
            },
          });
        }
      });
      return {
        id: "turn-runtime",
        items: [],
        status: "running",
        startedAt: null,
        completedAt: null,
      };
    });
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [appThread]),
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Runtime thread" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request("/v1/threads/app-thread-runtime/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        approvalPolicy: "never",
        model: "gpt-5.5",
        prompt: "Use selected runtime",
        reasoningEffort: "high",
        runtimeMode: "auto",
        sandboxMode: "danger-full-access",
      }),
      headers: { "content-type": "application/json" },
    });
    await streamResponse.text();
    const listResponse = await app.request("/v1/threads");
    const listBody = await listResponse.json();

    expect(streamResponse.status).toBe(200);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: "never",
        effort: "high",
        model: "gpt-5.5",
        sandboxPolicy: { type: "dangerFullAccess" },
      }),
    );
    expect(listBody.threads[0]).toMatchObject({
      id: "app-thread-runtime",
      approvalPolicy: "never",
      model: "gpt-5.5",
      reasoningEffort: "high",
      runtimeMode: "auto",
      sandboxMode: "danger-full-access",
    });
  });

  it("interrupts the active app-server turn instead of only clearing local state", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers: Array<
      (notification: { method: string; params?: unknown }) => void
    > = [];
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-interrupt",
      preview: "Interruptible thread",
      createdAt: now,
      updatedAt: now,
      status: { type: "running" },
      cwd: workspacePath,
      source: "app-server",
      modelProvider: "openai",
      name: "Interruptible thread",
      turns: [
        {
          id: "turn-interrupt",
          items: [],
          status: { type: "running" },
          startedAt: now,
          completedAt: null,
        },
      ],
    };
    const interruptTurn = vi.fn<() => Promise<void>>(async () => undefined);
    const startTurn = vi.fn<() => Promise<unknown>>(async () => ({
      id: "turn-interrupt",
      items: [],
      status: { type: "running" },
      startedAt: now,
      completedAt: null,
    }));
    const appServer = {
      interruptTurn,
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [appThread]),
      onNotification(handler: (notification: { method: string; params?: unknown }) => void) {
        notificationHandlers.push(handler);
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Interruptible thread" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request("/v1/threads/app-thread-interrupt/runs/stream", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Start long turn",
        runtimeMode: "full-access",
      }),
      headers: { "content-type": "application/json" },
    });
    await waitUntil(() => expect(startTurn).toHaveBeenCalledTimes(1));

    const interruptResponse = await app.request("/v1/threads/app-thread-interrupt/runs/interrupt", {
      method: "POST",
    });
    const interruptBody = await interruptResponse.json();

    expect(interruptResponse.status).toBe(200);
    expect(interruptTurn).toHaveBeenCalledWith({
      threadId: "app-thread-interrupt",
      turnId: "turn-interrupt",
    });
    expect(interruptBody.thread).toMatchObject({
      id: "app-thread-interrupt",
      state: "completed",
      runtimeMode: "full-access",
      sandboxMode: "danger-full-access",
    });

    for (const handler of notificationHandlers) {
      handler({
        method: "turn/cancelled",
        params: { status: "cancelled", threadId: "app-thread-interrupt", turnId: "turn-interrupt" },
      });
    }
    await streamResponse.text();
  });

  it("streams assistant items returned directly from app-server startTurn", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-direct-turn",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Direct turn",
        preview: "Direct turn",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => ({
        id: "turn-direct",
        items: [{ id: "assistant-direct", text: "direct reply", type: "agentMessage" }],
        status: "completed",
        startedAt: now,
        completedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Direct turn" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-direct-turn/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Reply directly" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("thread.message.created");
    expect(body).toContain("thread.message.completed");
    expect(body).toContain("direct reply");
    expect(body).toContain('"state":"completed"');
  });

  it("normalizes cumulative app-server deltas before streaming them to mobile", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-cumulative-delta",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Cumulative delta",
        preview: "Cumulative delta",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "Hello",
                itemId: "assistant-cumulative-delta",
                threadId: "app-thread-cumulative-delta",
                turnId: "turn-cumulative-delta",
              },
            });
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "Hello world",
                itemId: "assistant-cumulative-delta",
                threadId: "app-thread-cumulative-delta",
                turnId: "turn-cumulative-delta",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                status: "completed",
                threadId: "app-thread-cumulative-delta",
                turnId: "turn-cumulative-delta",
              },
            });
          }
        });
        return {
          id: "turn-cumulative-delta",
          items: [],
          status: "running",
          startedAt: null,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Cumulative delta" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-cumulative-delta/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Reply cumulatively" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"delta":"Hello"');
    expect(body).toContain('"delta":" world"');
    expect(body).not.toContain('"delta":"Hello world"');
    expect(body).toContain('"content":"Hello world"');
  });

  it("fails app-server streamed turns that complete without any response", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const appServer = {
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-empty-direct-turn",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Empty direct turn",
        preview: "Empty direct turn",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => ({
        id: "turn-empty-direct",
        items: [],
        status: "completed",
        startedAt: now,
        completedAt: now,
      })),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Empty direct turn" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-empty-direct-turn/runs/stream", {
      method: "POST",
      body: JSON.stringify({ collaborationMode: "plan", prompt: "Plan this" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("thread.error");
    expect(body).toContain("codex_empty_response");
    expect(body).toContain("Codex finished this turn without returning a plan or response.");
    expect(body).toContain('"state":"failed"');
  });

  it("does not stream terminal thread status before late assistant items", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-out-of-order",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Out of order",
        preview: "Out of order",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "turn/started",
              params: { threadId: "app-thread-out-of-order", turnId: "turn-out-of-order" },
            });
            handler({
              method: "thread/status/changed",
              params: { status: { type: "idle" }, threadId: "app-thread-out-of-order" },
            });
            handler({
              method: "item/completed",
              params: {
                item: { id: "assistant-out-of-order", text: "late reply", type: "agentMessage" },
                threadId: "app-thread-out-of-order",
                turnId: "turn-out-of-order",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-out-of-order",
                turn: {
                  id: "turn-out-of-order",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-out-of-order",
          items: [],
          status: "inProgress",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Out of order" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-out-of-order/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Reply after idle" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const assistantIndex = body.indexOf("late reply");
    const completedStateIndex = body.indexOf('"state":"completed"', assistantIndex);

    expect(response.status).toBe(200);
    expect(assistantIndex).toBeGreaterThan(-1);
    expect(completedStateIndex).toBeGreaterThan(assistantIndex);
  });

  it("waits for late assistant notifications when startTurn returns completed without items", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-empty-completed",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Empty completed",
        preview: "Empty completed",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/completed",
              params: {
                item: {
                  id: "assistant-empty-completed",
                  text: "late completed reply",
                  type: "agentMessage",
                },
                threadId: "app-thread-empty-completed",
                turnId: "turn-empty-completed",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-empty-completed",
                turn: {
                  id: "turn-empty-completed",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-empty-completed",
          items: [],
          status: "completed",
          startedAt: now,
          completedAt: now,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Empty completed" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-empty-completed/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Reply after empty completed" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("late completed reply");
    expect(body).toContain('"state":"completed"');
  });

  it("starts the first streamed turn when an app-server thread is not materialized yet", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => {
        throw new Error(
          "thread app-thread-unmaterialized is not materialized yet; includeTurns is unavailable before first user message",
        );
      }),
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-unmaterialized",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Unmaterialized",
        preview: "Unmaterialized",
        source: "app",
        status: { type: "active" },
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/completed",
              params: {
                item: {
                  id: "assistant-unmaterialized",
                  text: "first reply",
                  type: "agentMessage",
                },
                threadId: "app-thread-unmaterialized",
                turnId: "turn-unmaterialized",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-unmaterialized",
                turn: {
                  id: "turn-unmaterialized",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-unmaterialized",
          items: [],
          status: "inProgress",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Unmaterialized" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-unmaterialized/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "First prompt" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(appServer.readThread).toHaveBeenCalled();
    expect(appServer.startTurn).toHaveBeenCalledTimes(1);
    expect(body).toContain("first reply");
    expect(body).toContain('"state":"completed"');
  });

  it("resumes not-loaded app-server threads before continuing a streamed turn", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appThread = {
      id: "app-thread-not-loaded",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Past thread",
      preview: "First message",
      source: "app",
      status: { type: "notLoaded" },
      turns: [
        {
          id: "turn-existing",
          items: [
            {
              id: "existing-user",
              type: "userMessage",
              content: [{ type: "text", text: "First message", text_elements: [] }],
            },
            { id: "existing-assistant", text: "First reply", type: "agentMessage" },
          ],
          status: "completed",
          startedAt: now,
          completedAt: now,
        },
      ],
      updatedAt: now,
    };
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      resumeThread: vi.fn<() => Promise<unknown>>(async () => ({
        ...appThread,
        status: { type: "idle" },
      })),
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "continued reply",
                itemId: "assistant-continued",
                threadId: "app-thread-not-loaded",
                turnId: "turn-continued",
              },
            });
            handler({
              method: "turn/completed",
              params: {
                threadId: "app-thread-not-loaded",
                turn: {
                  id: "turn-continued",
                  items: [],
                  status: "completed",
                  error: null,
                  startedAt: now,
                  completedAt: now,
                  durationMs: 1,
                },
              },
            });
          }
        });
        return {
          id: "turn-continued",
          items: [],
          status: "inProgress",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-not-loaded/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Continue this" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(appServer.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTurns: false,
        persistExtendedHistory: true,
        threadId: "app-thread-not-loaded",
      }),
    );
    expect(appServer.startTurn).toHaveBeenCalledTimes(1);
    expect(body).toContain("continued reply");
  });

  it("waits for an externally active app-server thread before starting a streamed turn", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    let readCount = 0;
    const appThread = {
      id: "app-thread-wait",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Wait thread",
      preview: "Wait thread",
      source: "app",
      status: { type: "active" },
      turns: [],
      updatedAt: now,
    };
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => ({
        ...appThread,
        status: readCount++ === 0 ? { type: "active" } : { type: "idle" },
      })),
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: "pong",
                itemId: "assistant-wait",
                threadId: "app-thread-wait",
                turnId: "turn-wait",
              },
            });
            handler({
              method: "turn/completed",
              params: { status: "completed", threadId: "app-thread-wait", turnId: "turn-wait" },
            });
          }
        });
        return {
          id: "turn-wait",
          items: [],
          status: "running",
          startedAt: null,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Wait thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-wait/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Run after current turn" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(appServer.readThread).toHaveBeenCalled();
    expect(appServer.startTurn).toHaveBeenCalledTimes(1);
    expect(body).toContain("thread.message.delta");
    expect(body).toContain("pong");
  });

  it("closes app-server streams when a turn is aborted", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-aborted",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Abort thread",
        preview: "Abort thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "turn/aborted",
              params: {
                reason: "Approval request timed out.",
                threadId: "app-thread-aborted",
                turnId: "turn-aborted",
              },
            });
          }
        });
        return {
          id: "turn-aborted",
          items: [],
          status: "running",
          startedAt: null,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Abort thread" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request("/v1/threads/app-thread-aborted/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Run this" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("thread.error");
    expect(body).toContain("Approval request timed out.");
    expect(body).toContain('"state":"failed"');
  });

  it("treats duplicate app-server approval resolutions as already successful", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const requestHandlers = new Set<(request: unknown) => void>();
    const now = Date.now() / 1000;
    let approvalRequested = false;
    let releaseResponse: (() => void) | undefined;
    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const appThread = {
      id: "app-thread-approval",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Approval thread",
      preview: "Approval thread",
      source: "app",
      status: "idle",
      turns: [],
      updatedAt: now,
    };
    const respondToRequest = vi.fn<() => Promise<void>>(async () => {
      await responseReleased;
      for (const handler of notificationHandlers) {
        handler({
          method: "turn/completed",
          params: {
            status: "completed",
            threadId: "app-thread-approval",
            turnId: "turn-approval",
          },
        });
      }
    });
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest(handler: (request: unknown) => void) {
        requestHandlers.add(handler);
        return () => requestHandlers.delete(handler);
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      respondToRequest,
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          approvalRequested = true;
          for (const handler of requestHandlers) {
            handler({
              id: 42,
              method: "item/commandExecution/requestApproval",
              params: {
                command: "echo approved",
                threadId: "app-thread-approval",
                turnId: "turn-approval",
              },
            });
          }
        });
        return {
          id: "turn-approval",
          items: [],
          status: "running",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Approval thread" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request("/v1/threads/app-thread-approval/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Needs approval" }),
      headers: { "content-type": "application/json" },
    });
    await waitUntil(() => expect(approvalRequested).toBe(true));

    const firstApproval = app.request("/v1/approvals/approval-42", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    await waitUntil(() => expect(respondToRequest).toHaveBeenCalledTimes(1));
    const duplicateApproval = app.request("/v1/approvals/approval-42", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    releaseResponse?.();

    const [firstResponse, duplicateResponse] = await Promise.all([
      firstApproval,
      duplicateApproval,
    ]);
    await streamResponse.text();
    const detailResponse = await app.request("/v1/threads/app-thread-approval");
    const detailBody = await detailResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(respondToRequest).toHaveBeenCalledTimes(1);
    expect(detailBody.messages).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          approvalDecision: "approve",
          approvalResolved: true,
        }),
      }),
    );
  });

  it("resumes app-server turns after pending input request is answered", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const requestHandlers = new Set<(request: unknown) => void>();
    const now = Date.now() / 1000;
    let inputRequested = false;
    const appThread = {
      id: "app-thread-input",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Input thread",
      preview: "Input thread",
      source: "app",
      status: "idle",
      turns: [],
      updatedAt: now,
    };
    const respondToRequest = vi.fn<() => Promise<void>>(async () => {
      for (const handler of notificationHandlers) {
        handler({
          method: "turn/completed",
          params: {
            status: "completed",
            threadId: "app-thread-input",
            turnId: "turn-input",
          },
        });
      }
    });
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest(handler: (request: unknown) => void) {
        requestHandlers.add(handler);
        return () => requestHandlers.delete(handler);
      },
      readThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      respondToRequest,
      startThread: vi.fn<() => Promise<unknown>>(async () => appThread),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        queueMicrotask(() => {
          inputRequested = true;
          for (const handler of requestHandlers) {
            handler({
              id: 7,
              method: "item/tool/requestUserInput",
              params: {
                questions: [
                  {
                    header: "Scope",
                    id: "scope",
                    question: "What should Codex do next?",
                  },
                ],
                threadId: "app-thread-input",
                turnId: "turn-input",
              },
            });
          }
        });
        return {
          id: "turn-input",
          items: [],
          status: "running",
          startedAt: now,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Input thread" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request("/v1/threads/app-thread-input/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Needs input" }),
      headers: { "content-type": "application/json" },
    });
    await waitUntil(() => expect(inputRequested).toBe(true));

    const detailBeforeResponse = await app.request("/v1/threads/app-thread-input");
    const detailBeforeBody = await detailBeforeResponse.json();
    expect(detailBeforeBody.pendingInputRequests).toContainEqual(
      expect.objectContaining({
        id: "approval-7",
        questions: [
          expect.objectContaining({
            id: "scope",
            question: "What should Codex do next?",
          }),
        ],
      }),
    );
    expect(detailBeforeBody.messages).not.toContainEqual(
      expect.objectContaining({ kind: "structuredUserInput" }),
    );

    const approvalResponse = await app.request("/v1/approvals/approval-7", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", answers: ["Restart Vite"] }),
      headers: { "content-type": "application/json" },
    });
    const streamBody = await streamResponse.text();
    const detailResponse = await app.request("/v1/threads/app-thread-input");
    const detailBody = await detailResponse.json();

    expect(approvalResponse.status).toBe(200);
    expect(streamBody).toContain("thread.input_request.created");
    expect(respondToRequest).toHaveBeenCalledWith(7, {
      answers: { scope: { answers: ["Restart Vite"] } },
    });
    expect(streamBody).toContain('"state":"completed"');
    expect(detailBody.messages).not.toContainEqual(
      expect.objectContaining({ kind: "structuredUserInput" }),
    );
  });

  it("recovers a missing app-server thread even after prior messages exist", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    const now = Date.now() / 1000;
    let turnCount = 0;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-stale",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Stale thread",
        preview: "Stale thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn: vi.fn<() => Promise<unknown>>(async () => {
        turnCount += 1;
        if (turnCount === 2) {
          throw new Error("Thread not found");
        }
        const reply = turnCount === 1 ? "first reply" : "recovered reply";
        const turnId = `turn-stale-${turnCount}`;
        const itemId = `assistant-stale-${turnCount}`;
        queueMicrotask(() => {
          for (const handler of notificationHandlers) {
            handler({
              method: "item/agentMessage/delta",
              params: {
                delta: reply,
                itemId,
                threadId: "app-thread-stale",
                turnId,
              },
            });
            handler({
              method: "turn/completed",
              params: { status: "completed", threadId: "app-thread-stale", turnId },
            });
          }
        });
        return {
          id: turnId,
          items: [],
          status: "running",
          startedAt: null,
          completedAt: null,
        };
      }),
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Stale thread" }),
      headers: { "content-type": "application/json" },
    });
    const firstResponse = await app.request("/v1/threads/app-thread-stale/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "First run" }),
      headers: { "content-type": "application/json" },
    });
    await firstResponse.text();

    const secondResponse = await app.request("/v1/threads/app-thread-stale/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Continue existing thread" }),
      headers: { "content-type": "application/json" },
    });
    const body = await secondResponse.text();

    expect(secondResponse.status).toBe(200);
    expect(appServer.startThread).toHaveBeenCalledTimes(2);
    expect(body).not.toContain("thread.error");
    expect(body).toContain("recovered reply");
    expect(body).toContain('"id":"app-thread-stale"');
  });

  it("queues additional running-thread input on the server", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const notificationHandlers = new Set<(notification: unknown) => void>();
    let turnCount = 0;
    const startTurn = vi.fn<(params: unknown) => Promise<unknown>>(async () => {
      turnCount += 1;
      return {
        id: `turn-${turnCount}`,
        items: [],
        status: "running",
        startedAt: null,
        completedAt: null,
      };
    });
    const now = Date.now() / 1000;
    const appServer = {
      onNotification(handler: (notification: unknown) => void) {
        notificationHandlers.add(handler);
        return () => notificationHandlers.delete(handler);
      },
      onRequest() {
        return () => undefined;
      },
      startThread: vi.fn<() => Promise<unknown>>(async () => ({
        id: "app-thread-queue",
        createdAt: now,
        cwd: workspacePath,
        modelProvider: "gpt-5.5",
        name: "Queue thread",
        preview: "Queue thread",
        source: "app",
        status: "idle",
        turns: [],
        updatedAt: now,
      })),
      startTurn,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });
    const skillPath = join(workspacePath, ".agents", "skills", "dogfood", "SKILL.md");
    const imagePath = join(workspacePath, "queued.png");
    await writeFile(imagePath, Buffer.from("queued"));
    const attachment = {
      mimeType: "image/png",
      name: "queued.png",
      path: imagePath,
      type: "image" as const,
      url: "/v1/attachments/images/queued.png",
    };

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Queue thread" }),
      headers: { "content-type": "application/json" },
    });
    const streamResponse = await app.request("/v1/threads/app-thread-queue/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Initial run" }),
      headers: { "content-type": "application/json" },
    });

    const firstQueuedResponse = await app.request("/v1/threads/app-thread-queue/input", {
      method: "POST",
      body: JSON.stringify({
        approvalPolicy: "never",
        attachments: [attachment],
        model: "gpt-5.5",
        prompt: "Run after first",
        reasoningEffort: "high",
        runtimeMode: "auto",
        sandboxMode: "danger-full-access",
        skills: [{ name: "dogfood", path: skillPath }],
      }),
      headers: { "content-type": "application/json" },
    });
    const secondQueuedResponse = await app.request("/v1/threads/app-thread-queue/input", {
      method: "POST",
      body: JSON.stringify({ prompt: "Run after second" }),
      headers: { "content-type": "application/json" },
    });

    expect(firstQueuedResponse.status).toBe(202);
    await expect(firstQueuedResponse.json()).resolves.toMatchObject({
      acceptedAs: "queued",
      queueLength: 1,
      thread: {
        approvalPolicy: "never",
        model: "gpt-5.5",
        reasoningEffort: "high",
        runtimeMode: "auto",
        sandboxMode: "danger-full-access",
      },
      input: {
        attachments: [attachment],
        skills: [{ name: "dogfood", path: skillPath }],
      },
    });
    expect(secondQueuedResponse.status).toBe(202);
    await expect(secondQueuedResponse.json()).resolves.toMatchObject({
      acceptedAs: "queued",
      queueLength: 2,
    });
    expect(startTurn).toHaveBeenCalledTimes(1);

    for (const handler of notificationHandlers) {
      handler({
        method: "turn/completed",
        params: { status: "completed", threadId: "app-thread-queue", turnId: "turn-1" },
      });
    }
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(startTurn).toHaveBeenCalledTimes(2);
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        approvalPolicy: "never",
        effort: "high",
        model: "gpt-5.5",
        sandboxPolicy: { type: "dangerFullAccess" },
        threadId: "app-thread-queue",
        input: [
          { type: "text", text: "Run after first", text_elements: [] },
          { type: "localImage", path: imagePath },
          { type: "skill", name: "dogfood", path: skillPath },
        ],
      }),
    );

    for (const handler of notificationHandlers) {
      handler({
        method: "turn/completed",
        params: { status: "completed", threadId: "app-thread-queue", turnId: "turn-2" },
      });
    }
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(startTurn).toHaveBeenCalledTimes(3);

    for (const handler of notificationHandlers) {
      handler({
        method: "turn/completed",
        params: { status: "completed", threadId: "app-thread-queue", turnId: "turn-3" },
      });
    }
    expect(await streamResponse.text()).toContain("thread.state.changed");
  });

  it("runs a prompt on a known thread", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const appPath = join(workspacePath, "apps");
    await mkdir(appPath);
    const resumeOptions: Parameters<CodexClient["resumeThread"]>[1][] = [];
    const app = createApp({
      codex: createMockCodex({
        onResumeThread: (_threadId, options) => resumeOptions.push(options),
      }),
      workspacePath,
    });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Existing", workspacePath: appPath }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "Continue" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resumeOptions[0]).toMatchObject({ workingDirectory: appPath });
    expect(body.result).toBe("result: Continue");
    expect(body.thread.state).toBe("completed");
    expect(body.messages).toHaveLength(2);
  });

  it("accepts image attachments on a thread run", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const imagePath = join(workspacePath, "sketch.png");
    await writeFile(imagePath, Buffer.from("hello"));
    const app = createApp({ codex: createMockCodex(), workspacePath });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Existing" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      body: JSON.stringify({
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            name: "sketch.png",
            path: imagePath,
          },
        ],
        prompt: "Describe this",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toContain("Describe this");
    expect(body.result).toContain("Attached image 1 (sketch.png):");
    expect(body.result).toContain(imagePath);
    expect(body.result).not.toContain("data:image/png;base64");
    expect(body.messages[0].details.attachments[0]).toMatchObject({
      mimeType: "image/png",
      name: "sketch.png",
      path: imagePath,
      type: "image",
    });
    expect(body.messages[0].details.attachments[0]).not.toHaveProperty("dataUri");
  });

  it("returns thread detail with message history", async () => {
    const app = createApp({ codex: createMockCodex() });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Existing" }),
      headers: { "content-type": "application/json" },
    });
    await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "Continue" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads/thread-1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread.messageCount).toBe(2);
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("returns the full thread detail history without pagination fields", async () => {
    const app = createApp({ codex: createMockCodex() });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Existing" }),
      headers: { "content-type": "application/json" },
    });
    await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "First" }),
      headers: { "content-type": "application/json" },
    });
    await app.request("/v1/threads/thread-1/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "Second" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads/thread-1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("hasMoreMessages");
    expect(body).not.toHaveProperty("olderMessagesCursor");
    expect(body).not.toHaveProperty("oldestMessageId");
    expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
      "First",
      "result: First",
      "Second",
      "result: Second",
    ]);
  });

  it("loads all app-server thread messages on thread detail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const longThread = {
      id: "app-thread-long",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Long thread",
      preview: "Long thread",
      source: "app",
      status: { type: "idle" },
      turns: Array.from({ length: 121 }, (_value, index) => ({
        id: `turn-${index}`,
        completedAt: now,
        items: [
          {
            id: `user-${index}`,
            type: "userMessage",
            content: [{ type: "text", text: `Message ${index}`, text_elements: [] }],
          },
        ],
        startedAt: now,
        status: { type: "completed" },
      })),
      updatedAt: now,
    };
    const readThread = vi.fn<
      (_threadId: string, options?: { includeTurns?: boolean }) => Promise<unknown>
    >(async (_threadId, options) => ({
      ...longThread,
      turns: options?.includeTurns === false ? undefined : longThread.turns,
    }));
    const appServer = {
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [longThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    await app.request("/v1/threads");
    const response = await app.request("/v1/threads/app-thread-long");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readThread).toHaveBeenNthCalledWith(1, "app-thread-long", { includeTurns: false });
    expect(readThread).toHaveBeenNthCalledWith(2, "app-thread-long", { includeTurns: true });
    expect(readThread).toHaveBeenCalledTimes(2);
    expect(body.messages).toHaveLength(121);
    expect(body.messages.at(0)?.content).toBe("Message 0");
    expect(body.messages.at(-1)?.content).toBe("Message 120");
    expect(body).not.toHaveProperty("hasMoreMessages");
    expect(body).not.toHaveProperty("olderMessagesCursor");
  });

  it("loads app-server history from the rollout file when full thread reads hang", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: { message: "hello from rollout", type: "user_message" },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: { message: "loaded from rollout", type: "agent_message" },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const now = Date.now() / 1000;
    const appThread = {
      id: threadId,
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Rollout backed thread",
      preview: "Rollout backed thread",
      source: "app",
      status: { type: "notLoaded" },
      updatedAt: now,
    };
    const readThread = vi.fn<
      (_threadId: string, options?: { includeTurns?: boolean }) => Promise<unknown>
    >(async () => appThread);
    const appServer = {
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [appThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readThread).toHaveBeenNthCalledWith(1, threadId, { includeTurns: false });
      expect(readThread).toHaveBeenCalledTimes(1);
      expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
        "hello from rollout",
        "loaded from rollout",
      ]);
      expect(body).not.toHaveProperty("hasMoreMessages");
      expect(body).not.toHaveProperty("olderMessagesCursor");
      expect(body.thread.messageCount).toBe(2);
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads rollout image attachments into mobile thread detail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-image";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: {
            images: ["data:image/png;base64,aW1hZ2U="],
            local_images: [],
            message: "이미지 테스트\n",
            text_elements: [],
            type: "user_message",
          },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: { message: "이미지 잘 보입니다.", type: "agent_message" },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.messages[0]).toMatchObject({
        content: "이미지 테스트\n",
        role: "user",
      });
      expect(body.messages[0].details.attachments[0]).toMatchObject({
        mimeType: "image/png",
        name: "image-1.png",
        path: expect.any(String),
        type: "image",
        url: expect.stringMatching(/^\/v1\/attachments\/images\/.+\.png\?v=\d+$/),
      });
      expect(body.messages[0].details.attachments[0]).not.toHaveProperty("dataUri");
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads rollout assistant markdown images into mobile thread detail", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const imagePath = join(workspacePath, "md-preview-chat.png");
    await writeFile(imagePath, Buffer.from("image"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-assistant-image";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: {
            message: `증거 스크린샷:\n![WorkspacePreview on iPhone 17](${imagePath})\n\n완료`,
            type: "agent_message",
          },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.messages[0]).toMatchObject({
        content: "증거 스크린샷:\n\n완료",
        role: "assistant",
      });
      expect(body.messages[0].details.attachments[0]).toMatchObject({
        mimeType: "image/png",
        name: "WorkspacePreview on iPhone 17",
        path: expect.any(String),
        type: "image",
        url: expect.stringMatching(/^\/v1\/attachments\/images\/.+\.png\?v=\d+$/),
      });
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads rollout patch apply events as mobile file change cards", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-patch";
    const changedPath = join(workspacePath, "src", "app.ts");
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: {
            changes: {
              [changedPath]: {
                type: "update",
                unified_diff: patch,
              },
            },
            type: "patch_apply_end",
          },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.messages[0]).toMatchObject({
        content: "1 file changed: src/app.ts",
        kind: "fileChange",
        role: "tool",
      });
      expect(body.messages[0].details.changes).toEqual([
        {
          kind: "modified",
          path: "src/app.ts",
        },
      ]);
      expect(body.messages[0].details.patch).toContain("+new");
      expect(body.messages[0].details.patchOriginalLength).toBe(patch.length);
      expect(body.messages[0].details.patchTruncated).toBe(false);
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads rollout patch_apply_end bare hunks without duplicate apply_patch output cards", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-bare-patch-hunks";
    const readmePath = join(workspacePath, "README.md");
    const trademarkPath = join(workspacePath, "TRADEMARKS.md");
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: {
            call_id: "call_apply_patch",
            changes: {
              [readmePath]: {
                type: "update",
                unified_diff: ["@@ -1 +1,2 @@", " hello", "+world"].join("\n"),
              },
              [trademarkPath]: {
                type: "update",
                unified_diff: ["@@ -3,2 +3 @@", "-old", " kept"].join("\n"),
              },
            },
            type: "patch_apply_end",
          },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: {
            call_id: "call_apply_patch",
            output: JSON.stringify({
              output: [
                "Success. Updated the following files:",
                `M ${readmePath}`,
                `M ${trademarkPath}`,
              ].join("\n"),
            }),
            type: "custom_tool_call_output",
          },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "response_item",
        }),
        JSON.stringify({
          payload: { type: "task_complete" },
          timestamp: "2026-05-02T00:00:02.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();
      const fileChanges = body.messages.filter(
        (message: { kind: string }) => message.kind === "fileChange",
      );

      expect(response.status).toBe(200);
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].details.changes).toEqual([
        {
          kind: "modified",
          path: "README.md",
        },
        {
          kind: "modified",
          path: "TRADEMARKS.md",
        },
      ]);
      expect(fileChanges[0].details.patch).toContain("*** Update File: README.md");
      expect(fileChanges[0].details.patch).toContain("*** Update File: TRADEMARKS.md");
      expect(fileChanges[0].details.patch).toContain("+world");
      expect(fileChanges[0].details.patch).toContain("-old");
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads rollout apply_patch output as a file change card after the final answer", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-apply-patch";
    const addedPath = join(workspacePath, "apps", "mobile", "src", "components", "ui", "toast.tsx");
    const modifiedPath = join(
      workspacePath,
      "apps",
      "mobile",
      "src",
      "components",
      "ui",
      "status-toast.tsx",
    );
    const patch = [
      "*** Begin Patch",
      `*** Add File: ${addedPath}`,
      "+export function AppToast() {",
      "+  return null;",
      "+}",
      `*** Update File: ${modifiedPath}`,
      "@@",
      '-import { View } from "react-native";',
      '+import { AppToast } from "@/components/ui/toast";',
      "*** End Patch",
    ].join("\n");
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: {
            call_id: "call_apply_patch",
            input: patch,
            name: "apply_patch",
            type: "custom_tool_call",
          },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "response_item",
        }),
        JSON.stringify({
          payload: {
            call_id: "call_apply_patch",
            output: JSON.stringify({
              output: [
                "Success. Updated the following files:",
                `A ${addedPath}`,
                `M ${modifiedPath}`,
              ].join("\n"),
            }),
            type: "custom_tool_call_output",
          },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "response_item",
        }),
        JSON.stringify({
          payload: {
            message: "토스트를 재사용 가능한 구조로 분리해뒀습니다.",
            type: "agent_message",
          },
          timestamp: "2026-05-02T00:00:02.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: { type: "task_complete" },
          timestamp: "2026-05-02T00:00:03.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(
        body.messages.map((message: { kind: string; role: string }) => [
          message.role,
          message.kind,
        ]),
      ).toEqual([
        ["assistant", "chat"],
        ["tool", "fileChange"],
      ]);
      expect(body.messages[1]).toMatchObject({
        content:
          "2 files changed: apps/mobile/src/components/ui/toast.tsx, apps/mobile/src/components/ui/status-toast.tsx",
        kind: "fileChange",
        role: "tool",
      });
      expect(body.messages[1].details.changes).toEqual([
        {
          kind: "added",
          path: "apps/mobile/src/components/ui/toast.tsx",
        },
        {
          kind: "modified",
          path: "apps/mobile/src/components/ui/status-toast.tsx",
        },
      ]);
      expect(body.messages[1].details.patch).toContain("*** Add File");
      expect(body.messages[1].details.patchOriginalLength).toBe(patch.length);
      expect(body.messages[1].details.patchTruncated).toBe(false);
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("keeps app-server running state while loading full rollout messages", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-running-rollout";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: { message: "running prompt", type: "user_message" },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: { message: "streaming answer", type: "agent_message" },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const now = Date.now() / 1000;
    const appThread = {
      id: threadId,
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Running rollout backed thread",
      preview: "Running rollout backed thread",
      source: "app",
      status: { type: "active" },
      updatedAt: now,
    };
    const readThread = vi.fn<
      (_threadId: string, options?: { includeTurns?: boolean }) => Promise<unknown>
    >(async () => appThread);
    const appServer = {
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [appThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readThread).toHaveBeenCalledTimes(1);
      expect(readThread).toHaveBeenNthCalledWith(1, threadId, { includeTurns: false });
      expect(body.thread.state).toBe("running");
      expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
        "running prompt",
        "streaming answer",
      ]);
      expect(body).not.toHaveProperty("hasMoreMessages");
      expect(body).not.toHaveProperty("olderMessagesCursor");
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("deduplicates cached live messages when rollout history arrives with different ids", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const createResponse = await app.request("/v1/threads", {
        method: "POST",
        body: JSON.stringify({ title: "Deduped rollout" }),
        headers: { "content-type": "application/json" },
      });
      const createBody = await createResponse.json();
      const threadId = createBody.thread.id;
      await app.request(`/v1/threads/${threadId}/runs/stream`, {
        method: "POST",
        body: JSON.stringify({ prompt: "Hi" }),
        headers: { "content-type": "application/json" },
      });
      const cachedResponse = await app.request(`/v1/threads/${threadId}`);
      const cachedBody = await cachedResponse.json();
      const [userMessage, assistantMessage] = cachedBody.messages;
      await writeFile(
        join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
        [
          JSON.stringify({
            payload: { message: userMessage.content, type: "user_message" },
            timestamp: userMessage.createdAt,
            type: "event_msg",
          }),
          JSON.stringify({
            payload: { message: assistantMessage.content, type: "agent_message" },
            timestamp: assistantMessage.createdAt,
            type: "event_msg",
          }),
        ].join("\n"),
      );

      const detailResponse = await app.request(`/v1/threads/${threadId}`);
      const detailBody = await detailResponse.json();

      expect(detailResponse.status).toBe(200);
      expect(detailBody.messages.map((message: { content: string }) => message.content)).toEqual([
        "Hi",
        "streamed: Hi",
      ]);
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("preserves known running state when rollout history is already available", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-known-running-rollout";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: { message: "known running prompt", type: "user_message" },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const now = Date.now() / 1000;
    const listedThread = {
      id: threadId,
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Known running rollout backed thread",
      preview: "Known running rollout backed thread",
      source: "app",
      status: { type: "active" },
      updatedAt: now,
    };
    const staleDetailThread = {
      ...listedThread,
      status: { type: "idle" },
    };
    const readThread = vi.fn<
      (_threadId: string, options?: { includeTurns?: boolean }) => Promise<unknown>
    >(async () => staleDetailThread);
    const appServer = {
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [listedThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      await app.request("/v1/threads");
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readThread).toHaveBeenCalledTimes(1);
      expect(readThread).toHaveBeenNthCalledWith(1, threadId, { includeTurns: false });
      expect(body.thread.state).toBe("running");
      expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
        "known running prompt",
      ]);
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads the full readable rollout conversation when tool events are newest", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "05", "02");
    await mkdir(sessionsDir, { recursive: true });
    const threadId = "app-thread-rollout-tool-tail";
    await writeFile(
      join(sessionsDir, `rollout-2026-05-02T00-00-00-${threadId}.jsonl`),
      [
        JSON.stringify({
          payload: { message: "older prompt", type: "user_message" },
          timestamp: "2026-05-02T00:00:00.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: { message: "useful answer", type: "agent_message" },
          timestamp: "2026-05-02T00:00:01.000Z",
          type: "event_msg",
        }),
        ...[1, 2, 3, 4].map((index) =>
          JSON.stringify({
            payload: {
              call_id: `call_${index}`,
              command: ["/bin/echo", String(index)],
              exit_code: 0,
              type: "exec_command_end",
            },
            timestamp: `2026-05-02T00:00:0${index + 1}.000Z`,
            type: "event_msg",
          }),
        ),
      ].join("\n"),
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const app = createApp({
      codex: createMockCodex(),
      workspacePath,
    });

    try {
      const response = await app.request(`/v1/threads/${threadId}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
        "older prompt",
        "useful answer",
        "/bin/echo 1",
        "/bin/echo 2",
        "/bin/echo 3",
        "/bin/echo 4",
      ]);
      expect(body).not.toHaveProperty("hasMoreMessages");
      expect(body).not.toHaveProperty("olderMessagesCursor");
    } finally {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("loads app-server history in the background while a thread is running", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-workspace-"));
    const now = Date.now() / 1000;
    const runningThread = {
      id: "app-thread-running-long",
      createdAt: now,
      cwd: workspacePath,
      modelProvider: "gpt-5.5",
      name: "Running long thread",
      preview: "Running long thread",
      source: "app",
      status: { type: "active" },
      updatedAt: now,
    };
    const readThread = vi.fn<
      (_threadId: string, options?: { includeTurns?: boolean }) => Promise<unknown>
    >(async (_threadId, options) => {
      if (options?.includeTurns === true) {
        return new Promise(() => undefined);
      }
      return runningThread;
    });
    const appServer = {
      listThreads: vi.fn<() => Promise<unknown[]>>(async () => [runningThread]),
      onNotification() {
        return () => undefined;
      },
      onRequest() {
        return () => undefined;
      },
      readThread,
    };
    const app = createApp({
      appServer: appServer as never,
      codex: createMockCodex(),
      workspacePath,
    });

    const response = await app.request("/v1/threads/app-thread-running-long");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readThread).toHaveBeenNthCalledWith(1, "app-thread-running-long", {
      includeTurns: false,
    });
    expect(readThread).toHaveBeenNthCalledWith(2, "app-thread-running-long", {
      includeTurns: true,
    });
    expect(body.thread.state).toBe("running");
    expect(body.messages).toEqual([]);
    expect(body).not.toHaveProperty("hasMoreMessages");
    expect(body).not.toHaveProperty("olderMessagesCursor");
  });

  it("streams run events for a known thread", async () => {
    const app = createApp({ codex: createMockCodex() });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Streaming" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads/thread-1/runs/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Stream this" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("thread.message.created");
    expect(body).toContain("thread.message.delta");
    expect(body).toContain("streamed: Stream this");
  });

  it("rejects invalid payloads with a structured error", async () => {
    const app = createApp({ codex: createMockCodex() });

    const response = await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ prompt: "" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.issues[0]).toContain("prompt");
  });

  it("lists locally known threads", async () => {
    const app = createApp({ codex: createMockCodex() });

    await app.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Listed thread" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/v1/threads");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].title).toBe("Listed thread");
  });
});
