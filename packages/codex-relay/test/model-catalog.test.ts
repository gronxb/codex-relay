import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { CodexAppServerClient } from "../src/app-server.js";
import type { CodexClient } from "../src/codex.js";

const unusedCodex: CodexClient = {
  resumeThread() {
    throw new Error("Unexpected resumeThread call");
  },
  startThread() {
    throw new Error("Unexpected startThread call");
  },
};

describe("model catalog", () => {
  it("returns GPT-5.6 models with their supported reasoning details", async () => {
    const appServer = new CodexAppServerClient();
    const models = [
      model({
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        defaultReasoningEffort: "low",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      }),
      model({
        id: "gpt-5.6-terra",
        displayName: "GPT-5.6-Terra",
        defaultReasoningEffort: "medium",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      }),
      model({
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6-Luna",
        defaultReasoningEffort: "medium",
        efforts: ["low", "medium", "high", "xhigh", "max", "future"],
      }),
    ];
    vi.spyOn(appServer, "listModels").mockResolvedValue(models);
    const app = createApp({
      appServer,
      codex: unusedCodex,
      workspacePath: "/tmp/codex-relay-model-catalog",
    });

    const response = await app.request("/v1/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toHaveLength(3);
    expect(body.models[0]).toMatchObject({
      model: "gpt-5.6-sol",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      reasoningEffortOptions: [
        { reasoningEffort: "low", description: "low description" },
        { reasoningEffort: "medium", description: "medium description" },
        { reasoningEffort: "high", description: "high description" },
        { reasoningEffort: "xhigh", description: "xhigh description" },
        { reasoningEffort: "max", description: "max description" },
        { reasoningEffort: "ultra", description: "ultra description" },
      ],
    });
    expect(body.models[2]).toMatchObject({
      model: "gpt-5.6-luna",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "future"],
      reasoningEffortOptions: expect.arrayContaining([
        { reasoningEffort: "future", description: "future description" },
      ]),
    });
  });
});

function model({
  defaultReasoningEffort,
  displayName,
  efforts,
  id,
}: {
  defaultReasoningEffort: string;
  displayName: string;
  efforts: string[];
  id: string;
}) {
  return {
    id,
    model: id,
    displayName,
    description: `${displayName} description`,
    defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} description`,
    })),
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
    ],
  };
}
