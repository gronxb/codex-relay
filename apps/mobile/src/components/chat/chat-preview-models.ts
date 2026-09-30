import type { CodexModel, ReasoningEffort } from "codex-relay/api-schema";

export const previewModels: CodexModel[] = [
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Frontier intelligence for the most demanding work.",
    displayName: "GPT-6-Astra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    fastDescription: "2x speed, increased usage",
    id: "gpt-6-astra",
    isDefault: true,
  }),
  previewModel({
    defaultReasoningEffort: "low",
    description: "Latest workhorse model for coding and everyday work.",
    displayName: "GPT-6.1-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    fastDescription: "2x speed, increased usage",
    id: "gpt-6.1-sol",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Previous generation workhorse model.",
    displayName: "GPT-6-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    fastDescription: "1.5x speed",
    id: "gpt-6-sol",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Fast and affordable model for easier tasks.",
    displayName: "GPT-6-Luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fastDescription: "1.5x speed",
    id: "gpt-6-luna",
  }),
  previewModel({
    defaultReasoningEffort: "low",
    description: "Older coding model for complex work.",
    displayName: "GPT-5.6-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    id: "gpt-5.6-sol",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Older balanced model for straightforward work.",
    displayName: "GPT-5.6-Terra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    id: "gpt-5.6-terra",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Older fast and efficient model.",
    displayName: "GPT-5.6-Luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    id: "gpt-5.6-luna",
  }),
  previewModel({
    defaultReasoningEffort: "medium",
    description: "Legacy coding model.",
    displayName: "GPT-5.5",
    efforts: ["low", "medium", "high", "xhigh"],
    id: "gpt-5.5",
  }),
];

function previewModel({
  defaultReasoningEffort,
  description,
  displayName,
  efforts,
  fastDescription = "1.5x speed, increased usage",
  id,
  isDefault = false,
}: {
  defaultReasoningEffort: ReasoningEffort;
  description: string;
  displayName: string;
  efforts: ReasoningEffort[];
  fastDescription?: string;
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
        description: fastDescription,
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
