import type { HotUpdaterProgressEvent } from "@hot-updater/react-native";
import { useSyncExternalStore } from "react";

export type HotUpdaterLogLevel = "info" | "success" | "warning" | "error";

export type HotUpdaterLogEntry = {
  id: number;
  level: HotUpdaterLogLevel;
  message: string;
  details?: string;
  timestamp: number;
};

const maxEntries = 100;
const maxProgressFiles = 4;
const hotUpdaterLogTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
let nextLogId = 1;
let entries: HotUpdaterLogEntry[] = [];
const subscribers = new Set<() => void>();

export function addHotUpdaterLog(level: HotUpdaterLogLevel, message: string, details?: string) {
  entries = [
    ...entries,
    {
      details,
      id: nextLogId,
      level,
      message,
      timestamp: Date.now(),
    },
  ].slice(-maxEntries);
  nextLogId += 1;

  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function clearHotUpdaterLogs() {
  entries = [];
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function formatHotUpdaterProgress(event: HotUpdaterProgressEvent) {
  const percent = Math.round(event.progress * 100);
  if (event.artifactType === "diff") {
    return [
      `${percent}% · diff ${event.details.completedFilesCount}/${event.details.totalFilesCount}`,
      formatDiffTotalBytes(event.details.files),
      formatDiffFiles(event.details.files),
    ]
      .filter((detail): detail is string => Boolean(detail))
      .join("\n");
  }

  return [`${percent}% · archive`, formatByteSummary(event.downloadedBytes, event.totalBytes)]
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function formatHotUpdaterLogTime(timestamp: number) {
  try {
    return hotUpdaterLogTimeFormatter.format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

export function hotUpdaterErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return undefined;
}

export function useHotUpdaterLogs() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function formatDiffFiles(
  files: HotUpdaterProgressEvent & { artifactType: "diff" } extends infer E
    ? E extends { details: { files: infer F } }
      ? F
      : never
    : never,
) {
  const visibleFiles = [...files]
    .filter((file) => file.status === "downloading" || file.status === "failed")
    .sort((left, right) => statusPriority(left.status) - statusPriority(right.status))
    .slice(0, maxProgressFiles);

  if (visibleFiles.length === 0) {
    return undefined;
  }

  return visibleFiles
    .map((file) => {
      const percent = Math.round(file.progress * 100);
      const bytes = formatByteSummary(file.downloadedBytes, file.totalBytes);
      return `${file.status.toUpperCase()} ${truncatePath(file.downloadPath)} · ${percent}%${
        bytes ? ` · ${bytes}` : ""
      }`;
    })
    .join("\n");
}

function statusPriority(status: string) {
  switch (status) {
    case "failed":
      return 0;
    case "downloading":
      return 1;
    default:
      return 2;
  }
}

function formatDiffTotalBytes(
  files: HotUpdaterProgressEvent & { artifactType: "diff" } extends infer E
    ? E extends { details: { files: infer F } }
      ? F
      : never
    : never,
) {
  const byteAwareFiles = files.filter(
    (file) => typeof file.downloadedBytes === "number" || typeof file.totalBytes === "number",
  );

  if (byteAwareFiles.length === 0) {
    return undefined;
  }

  const downloadedBytes = byteAwareFiles.reduce(
    (total, file) => total + (file.downloadedBytes ?? 0),
    0,
  );
  const totalBytes = byteAwareFiles.every((file) => typeof file.totalBytes === "number")
    ? byteAwareFiles.reduce((total, file) => total + (file.totalBytes ?? 0), 0)
    : undefined;

  return formatByteSummary(downloadedBytes, totalBytes);
}

function formatByteSummary(downloadedBytes: number | undefined, totalBytes: number | undefined) {
  if (typeof downloadedBytes !== "number" || !Number.isFinite(downloadedBytes)) {
    return undefined;
  }

  if (typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0) {
    return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  }

  return `${formatBytes(downloadedBytes)} downloaded`;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(maximumFractionDigits)} ${units[unitIndex]}`;
}

function truncatePath(path: string) {
  if (path.length <= 44) {
    return path;
  }

  return `${path.slice(0, 18)}…${path.slice(-23)}`;
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getSnapshot() {
  return entries;
}
