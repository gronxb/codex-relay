import {
  rateLimitRemainingPercent,
  type RateLimitBucket,
  type RateLimitWindow,
} from "codex-relay/api-schema";

export type RateLimitDisplayRow = {
  id: string;
  label: string;
  window: RateLimitWindow & { remainingPercent: number };
};

export function visibleRateLimitRows(buckets: RateLimitBucket[]) {
  const rows = buckets.flatMap((bucket) => {
    const base = bucket.limitName?.trim() || bucket.limitId;
    return [
      bucket.primary
        ? {
            id: `${bucket.limitId}:primary`,
            label: durationLabel(bucket.primary) ?? base,
            window: bucket.primary,
          }
        : undefined,
      bucket.secondary
        ? {
            id: `${bucket.limitId}:secondary`,
            label: durationLabel(bucket.secondary) ?? base,
            window: bucket.secondary,
          }
        : undefined,
    ].flatMap((row) => {
      if (!row) {
        return [];
      }
      return [
        {
          ...row,
          window: {
            ...row.window,
            remainingPercent: rateLimitRemainingPercent(row.window.usedPercent),
          },
        },
      ];
    });
  });

  const byLabel = new Map<string, RateLimitDisplayRow>();
  for (const row of rows) {
    const existing = byLabel.get(row.label);
    if (!existing || row.window.remainingPercent < existing.window.remainingPercent) {
      byLabel.set(row.label, row);
    }
  }

  const sortedRows = Array.from(byLabel.values());
  sortedRows.sort(
    (left, right) =>
      (left.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER) -
      (right.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER),
  );
  return sortedRows;
}

export function formatRateLimitRemaining(window: RateLimitWindow & { remainingPercent: number }) {
  const reset = window.resetsAt ? ` until ${formatReset(window.resetsAt)}` : "";
  return `${window.remainingPercent}%${reset}`;
}

function durationLabel(window: RateLimitWindow) {
  const minutes = window.windowDurationMins;
  if (!minutes) {
    return undefined;
  }
  if (minutes % 10080 === 0) {
    return minutes === 10080 ? "Weekly" : `${minutes / 10080}w`;
  }
  if (minutes % 1440 === 0) {
    return minutes === 1440 ? "Daily" : `${minutes / 1440}d`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

function formatReset(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
