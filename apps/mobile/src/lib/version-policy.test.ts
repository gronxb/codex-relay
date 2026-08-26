import { describe, expect, it } from "vitest";
import relayPackage from "codex-relay/package.json";

import {
  evaluateRelayVersion,
  relayCompatibilityPolicy,
  relayUpdateCommand,
} from "./version-policy";

function relayVersion(packageVersion: string) {
  return {
    ok: true as const,
    packageName: "codex-relay" as const,
    packageVersion,
    service: "codex-relay-server" as const,
  };
}

function previousPatchVersion(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch - 1}`;
}

function nextPatchVersion(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function nextMajorVersion(version: string) {
  const [major] = version.split(".").map(Number);
  return `${major + 1}.0.0`;
}

describe("relay version policy", () => {
  it("reports an older relay for the sidebar using the bundled relay package version", () => {
    const requiredVersion = relayPackage.version;
    const olderVersion = previousPatchVersion(requiredVersion);

    expect(relayCompatibilityPolicy.packageVersion).toBe(requiredVersion);
    expect(relayUpdateCommand).toBe("npx codex-relay@latest");
    expect(evaluateRelayVersion(relayVersion(olderVersion), undefined)).toMatchObject({
      compatible: false,
      current: olderVersion,
      required: requiredVersion,
    });
  });

  it("accepts the required release and newer same-major releases", () => {
    const newerVersion = nextPatchVersion(relayPackage.version);

    expect(evaluateRelayVersion(relayVersion(relayPackage.version), undefined)).toMatchObject({
      compatible: true,
      current: relayPackage.version,
    });
    expect(evaluateRelayVersion(relayVersion(newerVersion), undefined)).toMatchObject({
      compatible: true,
      current: newerVersion,
    });
  });

  it("rejects prereleases, unparseable versions, and unsupported major releases", () => {
    for (const packageVersion of [
      `${relayPackage.version}-beta.1`,
      "latest",
      nextMajorVersion(relayPackage.version),
    ]) {
      expect(evaluateRelayVersion(relayVersion(packageVersion), undefined)).toMatchObject({
        compatible: false,
        current: packageVersion,
      });
    }
  });

  it("reports an unavailable relay for the sidebar", () => {
    expect(evaluateRelayVersion(undefined, new Error("offline"))).toMatchObject({
      compatible: false,
      current: "Unavailable",
      required: relayPackage.version,
    });
  });
});
