import type { VersionResponse } from "codex-relay/api-schema";

// Kept in the OTA-delivered JS bundle so compatibility can move with app updates.
export const relayCompatibilityPolicy = {
  packageVersion: "1.1.0",
} as const;
export const relayUpdateCommand = `npx codex-relay@${relayCompatibilityPolicy.packageVersion}`;

export type RelayVersionCompatibility =
  | {
      compatible: true;
      current: string;
      required: string;
      serverPackageVersion: string;
      updateCommand: string;
    }
  | {
      compatible: false;
      current: string;
      reason: string;
      required: string;
      serverPackageVersion?: string;
      updateCommand: string;
    };

export function evaluateRelayVersion(
  version: VersionResponse | undefined,
  error: unknown,
): RelayVersionCompatibility | undefined {
  if (error) {
    return {
      compatible: false,
      current: "Unavailable",
      reason:
        "The app could not verify the relay version. Update the relay if this server was started from an older install.",
      required: relayCompatibilityPolicy.packageVersion,
      updateCommand: relayUpdateCommand,
    };
  }

  if (!version) {
    return undefined;
  }

  const compatibility = compareRelayVersions(
    version.packageVersion,
    relayCompatibilityPolicy.packageVersion,
  );
  if (!compatibility.compatible) {
    return {
      compatible: false,
      current: version.packageVersion,
      reason: compatibility.reason,
      required: relayCompatibilityPolicy.packageVersion,
      serverPackageVersion: version.packageVersion,
      updateCommand: relayUpdateCommand,
    };
  }

  return {
    compatible: true,
    current: version.packageVersion,
    required: relayCompatibilityPolicy.packageVersion,
    serverPackageVersion: version.packageVersion,
    updateCommand: relayUpdateCommand,
  };
}

function compareRelayVersions(current: string, required: string) {
  const currentSemver = parseSemver(current);
  const requiredSemver = parseSemver(required);
  if (!currentSemver || !requiredSemver) {
    return {
      compatible: false,
      reason: "The relay version could not be parsed as semver.",
    };
  }

  if (currentSemver.major !== requiredSemver.major) {
    return {
      compatible: false,
      reason: `This app expects codex-relay ${requiredSemver.major}.x.`,
    };
  }

  if (compareSemver(currentSemver, requiredSemver) < 0) {
    return {
      compatible: false,
      reason: "This app expects a newer relay package than the connected server.",
    };
  }

  return { compatible: true, reason: "" };
}

function parseSemver(version: string) {
  const match = version
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareSemver(
  current: NonNullable<ReturnType<typeof parseSemver>>,
  required: NonNullable<ReturnType<typeof parseSemver>>,
) {
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = current[key] - required[key];
    if (diff !== 0) {
      return diff;
    }
  }

  return comparePrerelease(current.prerelease, required.prerelease);
}

function comparePrerelease(current: string[], required: string[]) {
  if (current.length === 0 && required.length === 0) {
    return 0;
  }
  if (current.length === 0) {
    return 1;
  }
  if (required.length === 0) {
    return -1;
  }

  const length = Math.max(current.length, required.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = current[index];
    const requiredPart = required[index];
    if (currentPart === undefined) {
      return -1;
    }
    if (requiredPart === undefined) {
      return 1;
    }
    const currentNumber = Number(currentPart);
    const requiredNumber = Number(requiredPart);
    const currentIsNumber = /^\d+$/.test(currentPart);
    const requiredIsNumber = /^\d+$/.test(requiredPart);
    if (currentIsNumber && requiredIsNumber) {
      const diff = currentNumber - requiredNumber;
      if (diff !== 0) {
        return diff;
      }
      continue;
    }
    if (currentIsNumber !== requiredIsNumber) {
      return currentIsNumber ? -1 : 1;
    }
    const diff = currentPart.localeCompare(requiredPart);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}
