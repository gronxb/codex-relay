import type { CodexModel, ReasoningEffort } from "codex-relay/api-schema";

export const previewModels: CodexModel[] = [
  previewModel({
    defaultReasoningEffort: "low",
    description: "Latest frontier agentic coding model.",
    displayName: "GPT-5.6-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    id: "gpt-5.6-sol",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Balanced agentic coding model for everyday work.",
    displayName: "GPT-5.6-Terra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    id: "gpt-5.6-terra",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Fast and affordable agentic coding model.",
    displayName: "GPT-5.6-Luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    id: "gpt-5.6-luna",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Previous-generation Codex model.",
    displayName: "GPT-5.5",
    efforts: ["low", "medium", "high", "xhigh"],
    id: "gpt-5.5",
    isDefault: true,
  }),
];

function previewModel({
  defaultReasoningEffort,
  description,
  displayName,
  efforts,
  id,
  isDefault = false,
}: {
  defaultReasoningEffort: ReasoningEffort;
  description: string;
  displayName: string;
  efforts: ReasoningEffort[];
  id: string;
  isDefault?: boolean;
}): CodexModel {
  return {
    defaultReasoningEffort,
    description,
    displayName,
    id,
    isDefault,
    model: id,
    reasoningEffortOptions: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningDescription(reasoningEffort),
    })),
    serviceTiers: [
      {
        description: "1.5x speed, more usage",
        id: "priority",
        name: "Fast",
      },
    ],
    supportedReasoningEfforts: efforts,
  };
}

function reasoningDescription(effort: ReasoningEffort) {
  switch (effort) {
    case "minimal":
      return "Minimal reasoning for the fastest replies";
    case "low":
      return "Fast responses with light reasoning";
    case "medium":
      return "Balanced reasoning for everyday work";
    case "high":
      return "Deeper reasoning for complex work";
    case "xhigh":
      return "Extra reasoning for difficult problems";
    case "max":
      return "Maximum reasoning depth for the hardest problems";
    case "ultra":
      return "Maximum reasoning with automatic task delegation";
  }
}
