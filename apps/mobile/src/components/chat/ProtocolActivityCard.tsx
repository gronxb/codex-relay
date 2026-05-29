import type { ChatMessage, ThreadMessageDetailField } from "codex-relay/api-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { AppBottomSheet } from "@/components/ui/bottom-sheet";
import { Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getThreadMessageDetail, resolveApproval } from "@/lib/codex-relay-api";
import { hapticSelection, hapticSuccess, hapticWarning } from "@/lib/haptics";
import { markMessageApprovalResolvedState } from "@/lib/server-state";

const INLINE_PATCH_LINE_LIMIT = 48;

export function ProtocolActivityCard({ message }: { message: ChatMessage }) {
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [answer, setAnswer] = useState("");
  const [isResolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<string | undefined>();
  const [expandedFileChangePaths, setExpandedFileChangePaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const queryClient = useQueryClient();
  const theme = useTheme();
  const model = activityModel(message);
  const approvalId = stringDetail(message, "approvalId");
  const approvalKind = stringDetail(message, "approvalKind");
  const resolvedDecision = stringDetail(message, "approvalDecision");
  const displayedResolution = resolution ?? resolvedDecision;
  const isApprovalResolved =
    booleanDetail(message, "approvalResolved") || Boolean(displayedResolution);
  const isPreviewMode = booleanDetail(message, "previewMode");
  const canResolve = Boolean(approvalId && !isApprovalResolved);
  const userInputPrompt = inputRequestPrompt(message);
  const isInputRequest =
    approvalKind === "structuredUserInput" || approvalKind === "mcpElicitation";
  const needsUserAction = canResolve;

  async function submitDecision(decision: "approve" | "approve-for-session" | "deny" | "cancel") {
    if (!approvalId || isResolving) {
      return;
    }

    setResolving(true);
    hapticSelection();
    try {
      if (!isPreviewMode) {
        await resolveApproval(approvalId, {
          decision,
          answers: answer.trim() ? [answer.trim()] : undefined,
        });
      }
      setResolution(decision);
      markMessageApprovalResolvedState(queryClient, message.threadId, message.id, decision);
      hapticSuccess();
    } catch (caught) {
      hapticWarning();
      Alert.alert(
        "Approval failed",
        caught instanceof Error ? caught.message : "Unable to respond.",
      );
    } finally {
      setResolving(false);
    }
  }

  if (message.kind === "plan") {
    return (
      <>
        <Pressable
          accessibilityLabel="Open details for Plan"
          accessibilityRole="button"
          onPress={() => setIsDetailVisible(true)}
          style={({ pressed }) => [
            styles.planCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.backgroundSelected,
            },
            pressed && styles.rowPressed,
          ]}
        >
          <ThemedText type="code" style={[styles.planLabel, { color: model.color }]}>
            Plan
          </ThemedText>
          <PlanMarkdown markdown={planBody(message)} variant="compact" />
        </Pressable>

        <ActivityDetailSheet
          message={message}
          model={model}
          visible={isDetailVisible}
          onClose={() => setIsDetailVisible(false)}
        />
      </>
    );
  }

  if (message.kind === "fileChange") {
    const stats = fileChangeStats(message);
    const toggleFileChangePath = (id: string) => {
      hapticSelection();
      setExpandedFileChangePaths((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    };

    return (
      <>
        <View
          style={[
            styles.fileChangeCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.backgroundSelected,
            },
          ]}
        >
          <Pressable
            accessibilityLabel={`Open details for ${model.label}`}
            accessibilityRole="button"
            onPress={() => setIsDetailVisible(true)}
            style={({ pressed }) => [styles.fileChangeHeader, pressed && styles.rowPressed]}
          >
            <View style={styles.fileChangeHeaderTitleGroup}>
              <ThemedText type="code" style={[styles.fileChangeTitle, { color: model.color }]}>
                {model.label}
              </ThemedText>
              <FileChangeStats stats={stats} />
            </View>
          </Pressable>
          <FileChangeAccordion
            expandedPaths={expandedFileChangePaths}
            message={message}
            onTogglePath={toggleFileChangePath}
          />
        </View>

        <ActivityDetailSheet
          message={message}
          model={model}
          visible={isDetailVisible}
          onClose={() => setIsDetailVisible(false)}
        />
      </>
    );
  }

  return (
    <>
      <View
        style={[
          canResolve || resolution ? styles.actionWrap : undefined,
          canResolve &&
            isInputRequest && [
              styles.inputRequestCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ],
        ]}
      >
        <Pressable
          accessibilityLabel={`Open details for ${model.label}`}
          accessibilityRole="button"
          onPress={() => setIsDetailVisible(true)}
          style={({ pressed }) => [
            styles.row,
            needsUserAction && [
              styles.actionRow,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ],
            isInputRequest && styles.inputRequestHeader,
            pressed && styles.rowPressed,
          ]}
        >
          <ThemedText
            type="code"
            numberOfLines={1}
            style={[
              styles.label,
              needsUserAction && styles.actionLabel,
              { color: needsUserAction ? theme.text : model.color },
            ]}
          >
            {model.label}
          </ThemedText>
          {model.detail ? (
            <ThemedText
              type="code"
              themeColor="textSecondary"
              numberOfLines={1}
              style={[styles.detail, needsUserAction && styles.actionDetail]}
            >
              {model.detail}
            </ThemedText>
          ) : null}
        </Pressable>

        {canResolve ? (
          <View style={[styles.approvalActions, isInputRequest && styles.inputRequestActions]}>
            {isInputRequest ? (
              <>
                {userInputPrompt ? (
                  <ThemedText type="code" style={styles.inputPrompt}>
                    {userInputPrompt}
                  </ThemedText>
                ) : null}
                <TextInput
                  autoCapitalize="sentences"
                  editable={!isResolving}
                  multiline
                  onChangeText={setAnswer}
                  placeholder="Type your answer"
                  placeholderTextColor="rgba(176, 180, 186, 0.72)"
                  style={styles.answerInput}
                  value={answer}
                />
              </>
            ) : null}
            <View style={styles.approvalButtonRow}>
              <ApprovalButton
                disabled={isResolving}
                label={approvalKind === "structuredUserInput" ? "Send" : "Approve"}
                onPress={() => submitDecision("approve")}
                tone="accept"
              />
              {approvalKind === "commandExecution" || approvalKind === "fileChange" ? (
                <ApprovalButton
                  disabled={isResolving}
                  label="Session"
                  onPress={() => submitDecision("approve-for-session")}
                  tone="neutral"
                />
              ) : null}
              <ApprovalButton
                disabled={isResolving}
                label="Deny"
                onPress={() => submitDecision("deny")}
                tone="deny"
              />
            </View>
          </View>
        ) : null}

        {displayedResolution ? (
          <ThemedText type="code" themeColor="textSecondary" style={styles.resolvedText}>
            Responded: {displayedResolution}
          </ThemedText>
        ) : null}
      </View>

      <ActivityDetailSheet
        message={message}
        model={model}
        visible={isDetailVisible}
        onClose={() => setIsDetailVisible(false)}
      />
    </>
  );
}

function FileChangeAccordion({
  expandedPaths,
  message,
  onTogglePath,
}: {
  expandedPaths: ReadonlySet<string>;
  message: ChatMessage;
  onTogglePath: (id: string) => void;
}) {
  const entries = fileChangeEntries(message);
  if (entries.length === 0) {
    return (
      <ThemedText
        type="code"
        themeColor="textSecondary"
        style={[styles.fileChangePath, styles.fileChangeEmpty]}
      >
        {message.content}
      </ThemedText>
    );
  }

  return (
    <View style={styles.fileChangeAccordion}>
      {entries.map((entry) => {
        const isExpanded = expandedPaths.has(entry.id);

        return (
          <View key={entry.id} style={styles.fileChangeFileItem}>
            <Pressable
              accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} ${entry.path}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              onPress={() => onTogglePath(entry.id)}
              style={({ pressed }) => [
                styles.fileChangeFileRow,
                pressed && styles.fileChangeFileRowPressed,
              ]}
            >
              <ThemedText type="code" style={styles.fileChangeKind}>
                {shortChangeKind(entry.kind)}
              </ThemedText>
              <ThemedText type="code" style={styles.fileChangePath} numberOfLines={1}>
                {entry.path}
              </ThemedText>
              <FileChangeStats compact stats={entry.stats} />
              <Icon
                name={isExpanded ? "expand" : "chevronRight"}
                size={15}
                strokeWidth={2.25}
                tintColor="#8B98AA"
              />
            </Pressable>
            {isExpanded ? <InlinePatchPreview patch={entry.patch} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function FileChangeStats({
  compact,
  stats,
}: {
  compact?: boolean;
  stats?: { additions: number; deletions: number };
}) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) {
    return null;
  }

  return (
    <View style={[styles.fileChangeStatsGroup, compact && styles.fileChangeStatsGroupCompact]}>
      <ThemedText
        type="code"
        style={[
          styles.fileChangeStats,
          compact && styles.fileChangeStatsCompact,
          styles.fileChangeAdditions,
        ]}
      >
        +{stats.additions}
      </ThemedText>
      <ThemedText
        type="code"
        style={[
          styles.fileChangeStats,
          compact && styles.fileChangeStatsCompact,
          styles.fileChangeDeletions,
        ]}
      >
        -{stats.deletions}
      </ThemedText>
    </View>
  );
}

function InlinePatchPreview({ patch }: { patch: string | undefined }) {
  if (!patch) {
    return (
      <ThemedText type="code" themeColor="textSecondary" style={styles.inlinePatchEmpty}>
        Patch preview unavailable
      </ThemedText>
    );
  }

  const preview = diffPreviewLines(patch, INLINE_PATCH_LINE_LIMIT);
  if (preview.lines.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={styles.inlinePatchScroller}
    >
      <View style={styles.inlinePatchLines}>
        {preview.lines.map((line) => (
          <View key={line.id} style={[styles.inlinePatchLine, inlinePatchLineRowStyle(line.kind)]}>
            <Text selectable style={[styles.inlinePatchText, inlinePatchLineTextStyle(line.kind)]}>
              {line.text || " "}
            </Text>
          </View>
        ))}
        {preview.truncated ? (
          <View style={styles.inlinePatchLine}>
            <Text selectable style={[styles.inlinePatchText, styles.inlinePatchMuted]}>
              [... patch preview truncated]
            </Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ApprovalButton({
  disabled,
  label,
  onPress,
  tone,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone: "accept" | "deny" | "neutral";
}) {
  return (
    <Button
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      size="default"
      variant={tone === "accept" ? "default" : tone === "deny" ? "outline" : "secondary"}
      style={[styles.approvalButton, disabled && styles.approvalButtonDisabled]}
    >
      <Text style={styles.approvalButtonText}>{label}</Text>
    </Button>
  );
}

type ActivityModel = {
  color: string;
  detail?: string;
  label: string;
};

type DetailSection = {
  body: string;
  field?: ThreadMessageDetailField;
  large?: boolean;
  monospace?: boolean;
  originalLength?: string;
  title: string;
  truncated?: boolean;
};

function ActivityDetailSheet({
  message,
  model,
  onClose,
  visible,
}: {
  message: ChatMessage;
  model: ActivityModel;
  onClose: () => void;
  visible: boolean;
}) {
  const theme = useTheme();
  const isPlan = message.kind === "plan";
  const sections = isPlan ? [] : detailSections(message);
  const [fullDetails, setFullDetails] = useState<Partial<Record<ThreadMessageDetailField, string>>>(
    {},
  );
  const [loadingField, setLoadingField] = useState<ThreadMessageDetailField | undefined>();

  async function loadFullDetail(field: ThreadMessageDetailField) {
    if (loadingField || fullDetails[field]) {
      return;
    }
    setLoadingField(field);
    hapticSelection();
    try {
      const response = await getThreadMessageDetail(message.threadId, message.id, field);
      setFullDetails((current) => ({ ...current, [field]: response.value }));
      hapticSuccess();
    } catch (caught) {
      hapticWarning();
      Alert.alert(
        "Detail unavailable",
        caught instanceof Error ? caught.message : "Unable to load the full detail.",
      );
    } finally {
      setLoadingField(undefined);
    }
  }

  return (
    <AppBottomSheet
      onClose={onClose}
      subtitle={isPlan ? undefined : model.detail}
      title={model.label}
      visible={visible}
    >
      <View style={[styles.sheetAccent, { backgroundColor: model.color }]} />
      <View style={styles.sheetContent}>
        {isPlan ? (
          <View style={styles.planDetailBody}>
            <PlanMarkdown markdown={planBody(message)} selectable variant="detail" />
          </View>
        ) : (
          sections.map((section) => {
            const fullBody = section.field ? fullDetails[section.field] : undefined;
            const body = fullBody ?? section.body;
            const canLoadFull = Boolean(section.field && section.truncated && !fullBody);
            const isLoadingFull = loadingField === section.field;

            return (
              <View key={section.title} style={styles.detailSection}>
                <View style={styles.sectionHeadingRow}>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.sectionTitle}>
                    {section.title}
                  </ThemedText>
                  {canLoadFull && section.originalLength ? (
                    <ThemedText type="code" themeColor="textSecondary" style={styles.sectionMeta}>
                      {section.originalLength} chars
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText
                  selectable
                  type="code"
                  style={[
                    styles.sectionBody,
                    section.large && styles.largeSectionBody,
                    section.monospace && {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: "rgba(255, 255, 255, 0.08)",
                    },
                  ]}
                >
                  {body}
                </ThemedText>
                {canLoadFull && section.field ? (
                  <Button
                    accessibilityRole="button"
                    disabled={isLoadingFull}
                    onPress={() => loadFullDetail(section.field as ThreadMessageDetailField)}
                    size="sm"
                    variant="secondary"
                    style={styles.loadFullButton}
                  >
                    {isLoadingFull ? <ActivityIndicator color="#F3F4F6" size="small" /> : null}
                    <Text style={styles.loadFullButtonText}>
                      {isLoadingFull ? "Loading full detail" : `Load full ${section.field}`}
                    </Text>
                  </Button>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </AppBottomSheet>
  );
}

function activityModel(message: ChatMessage): ActivityModel {
  switch (message.kind) {
    case "commandExecution": {
      const command = stringDetail(message, "command") ?? message.content;
      const display = humanizeCommand(command);
      const status = stringDetail(message, "status") ?? exitStatus(message);
      return {
        color: "#B7A36A",
        label: display.label,
        detail: [display.detail, status].filter(Boolean).join(", "),
      };
    }
    case "fileChange":
      return {
        color: "#C7776A",
        label: fileChangeLabel(message),
        detail: fileChangeDetail(message),
      };
    case "webSearch":
      return {
        color: "#6FA8DC",
        label: "Searched",
        detail: stringDetail(message, "query") ?? message.content,
      };
    case "thinking":
      return {
        color: "#9B8BD4",
        label: "Thinking",
        detail: firstLine(message.content),
      };
    case "plan":
      return {
        color: "#9B8BD4",
        label: "Plan",
        detail: firstLine(planBody(message)),
      };
    case "structuredUserInput":
      return {
        color: "#6FA8DC",
        label: "Input requested",
        detail: structuredInputDetail(message),
      };
    case "approvalRequest":
      return {
        color: "#FF8A45",
        label: approvalLabel(message),
        detail: approvalDetail(message),
      };
    case "subagentAction":
      return {
        color: "#78B88B",
        label: "Subagents",
        detail: firstLine(message.content),
      };
    case "toolActivity":
    default:
      return {
        color: "#78B88B",
        label: "Called",
        detail: toolDetail(message),
      };
  }
}

function detailSections(message: ChatMessage): DetailSection[] {
  switch (message.kind) {
    case "commandExecution":
      return commandDetailSections(message);
    case "fileChange":
      return fileChangeDetailSections(message);
    case "toolActivity":
      return compactSections([
        detailSection("Server", stringDetail(message, "server")),
        detailSection("Tool", stringDetail(message, "tool")),
        detailSection("Status", stringDetail(message, "status")),
        detailSection("Raw", message.content, true),
      ]);
    case "webSearch":
      return compactSections([
        detailSection("Query", stringDetail(message, "query") ?? message.content),
        detailSection("Status", stringDetail(message, "status")),
      ]);
    case "structuredUserInput":
      return compactSections([
        detailSection("Questions", structuredInputBody(message)),
        detailSection("Raw", message.content, true),
      ]);
    case "approvalRequest":
      return compactSections([
        detailSection("Request", approvalDetail(message) ?? message.content),
        detailSection("Reason", stringDetail(message, "reason")),
        detailSection("Working Directory", stringDetail(message, "cwd")),
        detailSection("Raw", JSON.stringify(message.details ?? {}, null, 2), true),
      ]);
    case "subagentAction":
    case "thinking":
    default:
      return compactSections([detailSection("Details", message.content || "No details.")]);
  }
}

function commandDetailSections(message: ChatMessage) {
  const command = stringDetail(message, "command") ?? message.content;
  return compactSections([
    detailSection("Command", command, true),
    detailSection("Working Directory", stringDetail(message, "cwd")),
    detailSection("Status", stringDetail(message, "status") ?? exitStatus(message)),
    lazyDetailSection("Output", stringDetail(message, "output"), "output", message),
  ]);
}

function fileChangeDetailSections(message: ChatMessage) {
  const changes = fileChanges(message);
  const changeList = changes
    .map((change) => `${change.kind.padEnd(8, " ")} ${change.path}`)
    .join("\n");
  return compactSections([
    detailSection("Files", changeList || message.content, true),
    lazyDetailSection("Patch", stringDetail(message, "patch"), "patch", message),
  ]);
}

function stringDetail(message: ChatMessage, key: string) {
  const value = message.details?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberDetail(message: ChatMessage, key: string) {
  const value = message.details?.[key];
  return typeof value === "number" ? String(value) : undefined;
}

function booleanDetail(message: ChatMessage, key: string) {
  return message.details?.[key] === true;
}

function detailSection(title: string, body: string | undefined, monospace = false, large = false) {
  return body && body.trim() ? { body, large, monospace, title } : undefined;
}

function lazyDetailSection(
  title: string,
  body: string | undefined,
  field: ThreadMessageDetailField,
  message: ChatMessage,
) {
  const section = detailSection(title, body, true);
  if (!section) {
    return undefined;
  }
  return {
    ...section,
    field,
    originalLength: numberDetail(message, `${field}OriginalLength`),
    truncated: booleanDetail(message, `${field}Truncated`),
  };
}

function compactSections(sections: Array<DetailSection | undefined>) {
  return sections.filter((section): section is DetailSection => Boolean(section));
}

function PlanMarkdown({
  markdown,
  selectable = false,
  variant,
}: {
  markdown: string;
  selectable?: boolean;
  variant: "compact" | "detail";
}) {
  const theme = useTheme();
  return (
    <EnrichedMarkdownText
      allowFontScaling={false}
      maxFontSizeMultiplier={1}
      markdown={markdown || " "}
      markdownStyle={planMarkdownStyle(theme, variant)}
      selectable={selectable}
    />
  );
}

function planMarkdownStyle(
  theme: ReturnType<typeof useTheme>,
  variant: "compact" | "detail",
): MarkdownStyle {
  const isDetail = variant === "detail";
  const bodySize = 14;
  const bodyLineHeight = 21;
  const headingColor = theme.text;
  return {
    paragraph: {
      color: theme.text,
      fontFamily: Fonts.sans,
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
      marginBottom: isDetail ? 8 : 6,
      marginTop: 0,
    },
    h1: {
      color: headingColor,
      fontFamily: Fonts.sansSemiBold,
      fontSize: isDetail ? 18 : 15,
      lineHeight: isDetail ? 24 : 20,
      marginBottom: isDetail ? 10 : 6,
      marginTop: 0,
    },
    h2: {
      color: headingColor,
      fontFamily: Fonts.sansSemiBold,
      fontSize: isDetail ? 16 : 14,
      lineHeight: isDetail ? 22 : 20,
      marginBottom: 6,
      marginTop: isDetail ? 10 : 4,
    },
    h3: {
      color: headingColor,
      fontFamily: Fonts.sansSemiBold,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 5,
      marginTop: isDetail ? 8 : 3,
    },
    list: {
      color: theme.text,
      fontFamily: Fonts.sans,
      fontSize: bodySize,
      gapWidth: 8,
      lineHeight: bodyLineHeight,
      markerColor: theme.textSecondary,
      markerMinWidth: 14,
      marginBottom: isDetail ? 8 : 6,
      marginLeft: 16,
      marginTop: 0,
    },
    code: {
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      borderColor: "rgba(255, 255, 255, 0.12)",
      color: "#D7E0EA",
      fontFamily: Fonts.monoMedium,
      fontSize: 13,
    },
    codeBlock: {
      backgroundColor: theme.backgroundSelected,
      borderColor: "rgba(132, 145, 165, 0.25)",
      borderRadius: 8,
      borderWidth: 1,
      color: theme.text,
      fontFamily: Fonts.mono,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: isDetail ? 10 : 8,
      padding: 10,
    },
    link: {
      color: "#5fa7ff",
      fontFamily: Fonts.sans,
      underline: false,
    },
    strong: {
      color: theme.text,
      fontFamily: Fonts.sansSemiBold,
      fontWeight: "normal",
    },
    blockquote: {
      backgroundColor: "rgba(95, 167, 255, 0.08)",
      borderColor: "#5fa7ff",
      borderWidth: 2,
      color: theme.text,
      fontFamily: Fonts.sans,
      fontSize: bodySize,
      gapWidth: 8,
      lineHeight: bodyLineHeight,
      marginBottom: isDetail ? 10 : 8,
      marginTop: 0,
    },
  };
}

function exitStatus(message: ChatMessage) {
  const exitCode = numberDetail(message, "exitCode");
  if (!exitCode) {
    return undefined;
  }
  return exitCode === "0" ? "done" : `exit ${exitCode}`;
}

function toolDetail(message: ChatMessage) {
  const server = stringDetail(message, "server");
  const tool = stringDetail(message, "tool");
  return [server, tool].filter(Boolean).join(".") || firstLine(message.content);
}

function fileChangeLabel(message: ChatMessage) {
  const count = fileChangeEntries(message).length;
  if (count === 0) {
    return "Edited";
  }
  return `Edited ${count} file${count === 1 ? "" : "s"}`;
}

function fileChangeDetail(message: ChatMessage) {
  const entries = fileChangeEntries(message);
  if (entries.length === 0) {
    return firstLine(message.content);
  }
  const paths = entries.map((entry) => compactPath(entry.path));
  const shown = paths.slice(0, 2).join(", ");
  return paths.length > 2 ? `${shown}, +${paths.length - 2} more` : shown;
}

function fileChanges(message: ChatMessage) {
  const changes = message.details?.changes;
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes.flatMap((change) => {
    if (!change || typeof change !== "object") {
      return [];
    }
    const record = change as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : undefined;
    const kind = typeof record.kind === "string" ? record.kind : "modified";
    return path ? [{ kind, path }] : [];
  });
}

function fileChangeStats(message: ChatMessage) {
  const entries = fileChangeEntries(message);
  if (entries.length === 0) {
    return undefined;
  }
  const stats = entries.reduce(
    (result, entry) => ({
      additions: result.additions + entry.stats.additions,
      deletions: result.deletions + entry.stats.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return stats.additions > 0 || stats.deletions > 0 ? stats : undefined;
}

type FileChangeEntry = {
  id: string;
  kind: string;
  patch?: string;
  path: string;
  stats: {
    additions: number;
    deletions: number;
  };
};

function fileChangeEntries(message: ChatMessage): FileChangeEntry[] {
  const patch = stringDetail(message, "patch");
  const changes = fileChanges(message);

  if (patch) {
    const patchEntries = splitPatchSections(patch).flatMap((section) => {
      const path = patchSectionDisplayPath(section, changes);
      if (!path) {
        return [];
      }

      return [
        {
          id: normalizePatchPath(path),
          kind: patchSectionChangeKind(section, changes),
          patch: section,
          path,
          stats: countPatchStats(section),
        },
      ];
    });

    if (patchEntries.length > 0) {
      return mergeFileChangeEntries(patchEntries);
    }
  }

  return mergeFileChangeEntries(
    changes.map((change) => ({
      id: normalizePatchPath(change.path),
      kind: change.kind,
      patch: changes.length === 1 ? patch : undefined,
      path: change.path,
      stats:
        patch && changes.length === 1 ? countPatchStats(patch) : { additions: 0, deletions: 0 },
    })),
  );
}

function mergeFileChangeEntries(entries: FileChangeEntry[]) {
  const merged = new Map<string, FileChangeEntry>();
  for (const entry of entries) {
    const key = normalizePatchPath(entry.path);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...entry, id: key });
      continue;
    }

    merged.set(key, {
      ...existing,
      kind: mergeChangeKind(existing.kind, entry.kind),
      patch: [existing.patch, entry.patch].filter(Boolean).join("\n"),
      stats: {
        additions: existing.stats.additions + entry.stats.additions,
        deletions: existing.stats.deletions + entry.stats.deletions,
      },
    });
  }

  return Array.from(merged.values());
}

function splitPatchSections(patch: string) {
  return patch
    .split(/(?=^(?:diff --git |\*\*\* (?:Add|Update|Delete) File: ))/m)
    .map((section) => section.trimEnd())
    .filter(Boolean);
}

function patchSectionMatchesPath(section: string, path: string) {
  const target = normalizePatchPath(path);
  return patchSectionPaths(section).some((candidate) => {
    const normalized = normalizePatchPath(candidate);
    return (
      normalized === target ||
      normalized.endsWith(`/${target}`) ||
      target.endsWith(`/${normalized}`)
    );
  });
}

function patchSectionPaths(section: string) {
  const paths: string[] = [];
  const fileHeader = section.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m);
  if (fileHeader?.[1]) {
    paths.push(fileHeader[1]);
  }

  const diffHeader = section.match(/^diff --git a\/(.+) b\/(.+)$/m);
  if (diffHeader?.[1]) {
    paths.push(diffHeader[1]);
  }
  if (diffHeader?.[2]) {
    paths.push(diffHeader[2]);
  }

  for (const pattern of [/^--- [ab]\/(.+)$/m, /^\+\+\+ [ab]\/(.+)$/m]) {
    const match = section.match(pattern);
    if (match?.[1]) {
      paths.push(match[1]);
    }
  }

  return paths;
}

function patchSectionDisplayPath(
  section: string,
  changes: Array<{
    kind: string;
    path: string;
  }>,
) {
  const paths = patchSectionPaths(section);
  for (const change of changes) {
    if (patchSectionMatchesPath(section, change.path)) {
      return change.path;
    }
  }

  const patchPath = paths[1] ?? paths[0];
  if (patchPath) {
    return patchPath;
  }
  return undefined;
}

function patchSectionChangeKind(
  section: string,
  changes: Array<{
    kind: string;
    path: string;
  }>,
) {
  const matchedKinds = changes
    .filter((change) => patchSectionMatchesPath(section, change.path))
    .map((change) => change.kind);
  if (matchedKinds.length > 0) {
    return matchedKinds.reduce(mergeChangeKind);
  }
  if (/^\*\*\* Add File: /m.test(section) || /^--- \/dev\/null$/m.test(section)) {
    return "added";
  }
  if (/^\*\*\* Delete File: /m.test(section) || /^\+\+\+ \/dev\/null$/m.test(section)) {
    return "deleted";
  }
  return "modified";
}

function normalizePatchPath(path: string) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^"?[ab]\//, "")
    .replace(/"$/, "");
}

function mergeChangeKind(left: string, right: string) {
  if (left === right) {
    return left;
  }
  return "modified";
}

function countPatchStats(patch: string) {
  return patch.split("\n").reduce(
    (stats, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        stats.additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        stats.deletions += 1;
      }
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

type DiffPreviewLine = {
  id: string;
  kind: "added" | "context" | "deleted" | "hunk" | "meta";
  newLine?: number;
  oldLine?: number;
  text: string;
};

function diffPreviewLines(patch: string, limit: number) {
  const lines = patch.split("\n");
  const previewLines: DiffPreviewLine[] = [];
  const occurrences = new Map<string, number>();
  let oldLine: number | undefined;
  let newLine: number | undefined;

  for (const text of lines) {
    if (previewLines.length >= limit) {
      return { lines: previewLines, truncated: true };
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      previewLines.push(diffPreviewLine(text, "hunk", occurrences));
      continue;
    }

    if (text.startsWith("diff --git") || text.startsWith("index ") || text.startsWith("---")) {
      previewLines.push(diffPreviewLine(text, "meta", occurrences));
      continue;
    }
    if (text.startsWith("+++")) {
      previewLines.push(diffPreviewLine(text, "meta", occurrences));
      continue;
    }
    if (text.startsWith("+")) {
      previewLines.push(
        diffPreviewLine(text, "added", occurrences, {
          newLine,
        }),
      );
      if (newLine !== undefined) {
        newLine += 1;
      }
      continue;
    }
    if (text.startsWith("-")) {
      previewLines.push(
        diffPreviewLine(text, "deleted", occurrences, {
          oldLine,
        }),
      );
      if (oldLine !== undefined) {
        oldLine += 1;
      }
      continue;
    }

    previewLines.push(
      diffPreviewLine(text, "context", occurrences, {
        newLine,
        oldLine,
      }),
    );
    if (oldLine !== undefined) {
      oldLine += 1;
    }
    if (newLine !== undefined) {
      newLine += 1;
    }
  }

  return { lines: previewLines, truncated: false };
}

function diffPreviewLine(
  text: string,
  kind: DiffPreviewLine["kind"],
  occurrences: Map<string, number>,
  numbers: Pick<DiffPreviewLine, "newLine" | "oldLine"> = {},
): DiffPreviewLine {
  const occurrence = (occurrences.get(text) ?? 0) + 1;
  occurrences.set(text, occurrence);
  return {
    id: `${kind}:${text}:${occurrence}`,
    kind,
    text,
    ...numbers,
  };
}

function inlinePatchLineRowStyle(kind: DiffPreviewLine["kind"]) {
  switch (kind) {
    case "added":
      return styles.inlinePatchLineAdded;
    case "deleted":
      return styles.inlinePatchLineDeleted;
    case "hunk":
      return styles.inlinePatchLineHunk;
    default:
      return undefined;
  }
}

function inlinePatchLineTextStyle(kind: DiffPreviewLine["kind"]) {
  switch (kind) {
    case "added":
      return styles.inlinePatchTextAdded;
    case "deleted":
      return styles.inlinePatchTextDeleted;
    case "hunk":
      return styles.inlinePatchTextHunk;
    case "meta":
      return styles.inlinePatchMuted;
    default:
      return styles.inlinePatchTextContext;
  }
}

function shortChangeKind(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized.startsWith("add") || normalized === "created") {
    return "A";
  }
  if (normalized.startsWith("delete") || normalized === "removed") {
    return "D";
  }
  if (normalized.startsWith("rename") || normalized === "moved") {
    return "R";
  }
  return "M";
}

function planBody(message: ChatMessage) {
  const details = message.details;
  const explanation = meaningfulPlanText(stringDetail(message, "explanation"));
  const plan =
    planTextFromValue(details?.plan) ??
    planTextFromValue(details?.steps) ??
    planTextFromValue(details?.items);
  const content = meaningfulPlanText(message.content);
  return [explanation, plan ?? content].filter(Boolean).join("\n") || message.content;
}

function planTextFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return meaningfulPlanText(value);
  }
  if (Array.isArray(value)) {
    return (
      value
        .flatMap((step) => {
          const text = planStepText(step);
          return text ? [text] : [];
        })
        .join("\n") || undefined
    );
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return (
    planString(record, ["markdown", "content", "text", "message", "title", "description"]) ??
    planTextFromValue(record.plan) ??
    planTextFromValue(record.steps) ??
    planTextFromValue(record.items)
  );
}

function planStepText(step: unknown): string | undefined {
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
    planTextFromValue(record.steps);
  const status = typeof record.status === "string" ? record.status : undefined;
  return text ? (status ? `${status}: ${text}` : text) : undefined;
}

function planString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const text = meaningfulPlanText(value);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function meaningfulPlanText(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const proposed = value.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
  const text = (proposed?.[1] ?? value).trim();
  return text && text.toLowerCase() !== "plan" ? text : undefined;
}

function structuredInputDetail(message: ChatMessage) {
  const questions = structuredInputQuestionLines(message);
  if (questions.length > 0) {
    return questions.length > 1 ? `${questions.length} questions to answer` : "Reply to continue";
  }
  return firstLine(message.content);
}

function structuredInputBody(message: ChatMessage) {
  const questions = structuredInputQuestionLines(message);
  if (questions.length > 0) {
    return questions.join("\n\n");
  }
  return message.content;
}

function inputRequestPrompt(message: ChatMessage) {
  if (
    message.kind === "structuredUserInput" ||
    stringDetail(message, "approvalKind") === "structuredUserInput"
  ) {
    return structuredInputBody(message);
  }
  if (stringDetail(message, "approvalKind") === "mcpElicitation") {
    return stringDetail(message, "message") ?? firstLine(message.content);
  }
  return undefined;
}

function structuredInputQuestionLines(message: ChatMessage) {
  const questions = message.details?.questions;
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.flatMap((question) => {
    if (!question || typeof question !== "object") {
      return [];
    }
    const record = question as Record<string, unknown>;
    const header = typeof record.header === "string" ? record.header : undefined;
    const text = typeof record.question === "string" ? record.question : undefined;
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option) => {
          if (!option || typeof option !== "object") {
            return [];
          }
          const optionRecord = option as Record<string, unknown>;
          return typeof optionRecord.label === "string" ? [optionRecord.label] : [];
        })
      : [];
    const prompt = [header, text].filter(Boolean).join(": ");
    const optionText = options.length > 0 ? `Options: ${options.join(", ")}` : undefined;
    return [prompt, optionText].filter(Boolean).join("\n");
  });
}

function approvalLabel(message: ChatMessage) {
  switch (stringDetail(message, "approvalKind")) {
    case "commandExecution":
      return "Approve command";
    case "fileChange":
      return "Approve files";
    case "permissions":
      return "Approve permissions";
    case "structuredUserInput":
      return "Input requested";
    case "mcpElicitation":
      return "Approve input";
    default:
      return "Approval requested";
  }
}

function approvalDetail(message: ChatMessage) {
  if (stringDetail(message, "approvalKind") === "structuredUserInput") {
    return structuredInputDetail(message);
  }
  const command = stringDetail(message, "command");
  if (command) {
    return humanizeCommand(command).detail;
  }
  return (
    stringDetail(message, "reason") ??
    stringDetail(message, "message") ??
    stringDetail(message, "grantRoot") ??
    firstLine(message.content)
  );
}

function humanizeCommand(raw: string) {
  const command = unwrapShell(raw);
  const [tool = command, ...rest] = command.split(/\s+/);
  const args = rest.join(" ");
  const normalizedTool = compactPath(tool).toLowerCase();

  switch (normalizedTool) {
    case "cat":
    case "head":
    case "less":
    case "more":
    case "nl":
    case "sed":
    case "tail":
      return { detail: lastPath(args, "file"), label: "Read" };
    case "rg":
    case "grep":
      return { detail: searchTarget(args), label: "Searched" };
    case "ls":
      return { detail: lastPath(args, "directory"), label: "Listed" };
    case "git":
      return { detail: args || "repository", label: "Git" };
    default:
      return { detail: command, label: "Ran" };
  }
}

function unwrapShell(raw: string) {
  let result = raw.trim();
  const shellMatch = result.match(/^(?:\/usr\/bin\/)?(?:bash|sh)\s+-(?:l?c)\s+(['"])([\s\S]*)\1$/);
  if (shellMatch?.[2]) {
    result = shellMatch[2].trim();
  }
  const cdIndex = result.indexOf("&&");
  if (cdIndex >= 0) {
    result = result.slice(cdIndex + 2).trim();
  }
  return result.split(" | ")[0]?.trim() ?? result;
}

function lastPath(args: string, fallback: string) {
  const token = args
    .split(/\s+/)
    .reverse()
    .find((part) => part && !part.startsWith("-"));
  return token ? compactPath(token.replace(/^['"]|['"]$/g, "")) : fallback;
}

function compactPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : path;
}

function searchTarget(args: string) {
  const pieces = args.split(/\s+/).reduce<string[]>((result, part) => {
    if (part && !part.startsWith("-")) {
      result.push(part.replace(/^['"]|['"]$/g, ""));
    }
    return result;
  }, []);
  return pieces.slice(0, 2).join(" in ") || "workspace";
}

function firstLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const styles = StyleSheet.create({
  actionWrap: {
    alignSelf: "stretch",
    gap: Spacing.two,
    maxWidth: "100%",
  },
  planCard: {
    alignSelf: "stretch",
    borderRadius: 10,
    borderWidth: 1,
    gap: Spacing.two,
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  planLabel: {
    fontSize: 11,
    lineHeight: 15,
    opacity: 0.9,
  },
  planDetailBody: {
    paddingBottom: 2,
  },
  approvalActions: {
    alignSelf: "stretch",
    gap: Spacing.two,
    maxWidth: 420,
  },
  inputRequestCard: {
    borderRadius: 9,
    borderWidth: 1,
    maxWidth: 420,
    padding: Spacing.three,
  },
  inputRequestHeader: {
    backgroundColor: "transparent",
    borderWidth: 0,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  inputRequestActions: {
    maxWidth: "100%",
  },
  approvalButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  approvalButton: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 34,
    minWidth: 74,
    paddingHorizontal: Spacing.two,
    paddingVertical: 7,
  },
  approvalButtonDisabled: {
    opacity: 0.5,
  },
  approvalButtonText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  answerInput: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.10)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#F3F4F6",
    fontFamily: Fonts.sans,
    fontSize: 13,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    paddingVertical: 7,
    textAlignVertical: "top",
  },
  inputPrompt: {
    color: "#F3F4F6",
    fontSize: 12,
    lineHeight: 17,
    maxWidth: 420,
    opacity: 0.9,
  },
  resolvedText: {
    fontSize: 10,
    lineHeight: 13,
    opacity: 0.72,
  },
  row: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    borderColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    minHeight: 18,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  actionRow: {
    alignSelf: "stretch",
    borderWidth: 1,
    gap: Spacing.two,
    maxWidth: 420,
    minHeight: 42,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  rowPressed: {
    opacity: 0.68,
  },
  fileChangeCard: {
    alignSelf: "stretch",
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 0,
    maxWidth: "100%",
    overflow: "hidden",
  },
  fileChangeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  fileChangeHeaderTitleGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minWidth: 0,
  },
  fileChangeTitle: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  fileChangeStatsGroup: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 5,
  },
  fileChangeStatsGroupCompact: {
    gap: 4,
  },
  fileChangeStats: {
    fontSize: 11,
    lineHeight: 15,
  },
  fileChangeStatsCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  fileChangeAdditions: {
    color: "#3DDC84",
  },
  fileChangeDeletions: {
    color: "#FF7B72",
  },
  fileChangeAccordion: {
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fileChangeFileItem: {
    borderTopColor: "rgba(255, 255, 255, 0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fileChangeFileRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 30,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  fileChangeFileRowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
  },
  fileChangeKind: {
    color: "#8B98AA",
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    width: 14,
  },
  fileChangePath: {
    color: "#D7E0EA",
    flex: 1,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0,
  },
  fileChangeEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  inlinePatchScroller: {
    backgroundColor: "rgba(5, 8, 13, 0.74)",
    borderTopColor: "rgba(255, 255, 255, 0.07)",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inlinePatchLines: {
    minWidth: 620,
    paddingVertical: Spacing.two,
  },
  inlinePatchEmpty: {
    backgroundColor: "rgba(5, 8, 13, 0.52)",
    borderTopColor: "rgba(255, 255, 255, 0.07)",
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  inlinePatchLine: {
    alignItems: "flex-start",
    flexDirection: "row",
    minHeight: 17,
    paddingLeft: Spacing.two,
  },
  inlinePatchLineAdded: {
    backgroundColor: "rgba(46, 160, 67, 0.16)",
  },
  inlinePatchLineDeleted: {
    backgroundColor: "rgba(248, 81, 73, 0.15)",
  },
  inlinePatchLineHunk: {
    backgroundColor: "rgba(255, 255, 255, 0.075)",
  },
  inlinePatchText: {
    flexShrink: 0,
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 17,
    minWidth: 480,
    paddingRight: Spacing.three,
  },
  inlinePatchTextAdded: {
    color: "#A7F3C1",
  },
  inlinePatchTextDeleted: {
    color: "#FFB3B3",
  },
  inlinePatchTextHunk: {
    color: "#D7E0EA",
  },
  inlinePatchTextContext: {
    color: "#B9C0CA",
  },
  inlinePatchMuted: {
    color: "#8B98AA",
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 13,
    opacity: 0.95,
  },
  detail: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    opacity: 0.86,
  },
  actionLabel: {
    fontSize: 13,
    lineHeight: 17,
  },
  actionDetail: {
    fontSize: 12,
    lineHeight: 16,
  },
  planInlineDetail: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  sheetAccent: {
    borderRadius: 999,
    height: 3,
    marginHorizontal: 6,
    marginTop: 2,
    opacity: 0.82,
  },
  sheetContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
    paddingHorizontal: 6,
    paddingTop: Spacing.three,
  },
  detailSection: {
    gap: Spacing.one,
  },
  sectionHeadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  sectionTitle: {
    flexShrink: 1,
    opacity: 0.72,
    textTransform: "uppercase",
  },
  sectionMeta: {
    fontSize: 10,
    lineHeight: 13,
    opacity: 0.64,
  },
  sectionBody: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 13,
    fontFamily: Fonts.mono,
    lineHeight: 18,
    padding: Spacing.two,
  },
  largeSectionBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  loadFullButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    minHeight: 32,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
  loadFullButtonText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
});
