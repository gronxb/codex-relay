import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isMobileShipRelease, nextMobileShipVersion } from "./mobile-release-version.mjs";
import { splitMixedChangesets } from "./version-packages.mjs";

const mixedReleaseChangeset = {
  id: "mixed-release",
  releases: [
    { name: "codex-relay", type: "patch" },
    { name: "@codex-relay/mobile", type: "patch" },
  ],
  summary: "Ship one feature through both release channels.",
};

test("starts ship numbering from the configured app version", () => {
  assert.equal(nextMobileShipVersion("1.0.0", "1.4.0", "patch"), "1.4.0-ship.1");
});

test("increments ship numbering while the app version stays the same", () => {
  assert.equal(nextMobileShipVersion("1.4.0-ship.1", "1.4.0", "patch"), "1.4.0-ship.2");
});

test("resets ship numbering when the app version changes", () => {
  assert.equal(nextMobileShipVersion("1.4.0-ship.8", "1.5.0", "patch"), "1.5.0-ship.1");
});

test("rejects non-patch mobile changesets before versioning", () => {
  assert.throws(() => nextMobileShipVersion("1.4.0-ship.2", "1.4.0", "minor"), TypeError);
});

test("detects only sequential ship releases", () => {
  assert.equal(isMobileShipRelease("1.0.0", "1.4.0-ship.1"), true);
  assert.equal(isMobileShipRelease("1.4.0-ship.1", "1.4.0-ship.2"), true);
  assert.equal(isMobileShipRelease("1.4.0-ship.8", "1.5.0-ship.1"), true);
  assert.equal(isMobileShipRelease("1.4.0-ship.1", "1.4.0-ship.3"), false);
  assert.equal(isMobileShipRelease("1.4.0-ship.1", "1.4.1"), false);
});

test("keeps the mobile release when preparing a mixed npm changeset", () => {
  // Given a changeset shared by the npm and mobile release channels
  const ignoredPackages = ["@codex-relay/mobile", "react-native-direct-fetch"];

  // When the changeset is scoped to the npm release branch
  const scopedChangesets = splitMixedChangesets([mixedReleaseChangeset], ignoredPackages);

  // Then npm is selected and the mobile release remains pending
  assert.deepEqual(scopedChangesets, [
    {
      id: "mixed-release",
      originalReleases: mixedReleaseChangeset.releases,
      remainingReleases: [{ name: "@codex-relay/mobile", type: "patch" }],
      selectedReleases: [{ name: "codex-relay", type: "patch" }],
      summary: mixedReleaseChangeset.summary,
    },
  ]);
});

test("keeps the npm release when preparing a mixed mobile changeset", () => {
  // Given a changeset shared by the npm and mobile release channels
  const ignoredPackages = ["codex-relay", "react-native-direct-fetch"];

  // When the changeset is scoped to the mobile release branch
  const scopedChangesets = splitMixedChangesets([mixedReleaseChangeset], ignoredPackages);

  // Then mobile is selected and the npm release remains pending
  assert.deepEqual(scopedChangesets, [
    {
      id: "mixed-release",
      originalReleases: mixedReleaseChangeset.releases,
      remainingReleases: [{ name: "codex-relay", type: "patch" }],
      selectedReleases: [{ name: "@codex-relay/mobile", type: "patch" }],
      summary: mixedReleaseChangeset.summary,
    },
  ]);
});

test("defines independent npm and mobile version commands", () => {
  const releaseConfig = JSON.parse(
    readFileSync(new URL("../.changeset/config.json", import.meta.url), "utf8"),
  );
  const workspacePackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const releaseWorkflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.deepEqual(releaseConfig.ignore, []);
  assert.equal(
    workspacePackage.scripts["version-packages:npm"],
    "node scripts/version-packages.mjs npm",
  );
  assert.equal(
    workspacePackage.scripts["version-packages:mobile"],
    "node scripts/version-packages.mjs mobile",
  );
  assert.match(releaseWorkflow, /changeset-release\/npm-main/);
  assert.match(releaseWorkflow, /changeset-release\/mobile-main/);
  assert.doesNotMatch(releaseWorkflow, /changesets\/action/);
});
