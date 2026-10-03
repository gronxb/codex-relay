# Mobile 1.6.0: rc27 tooling and infrastructure / Expo 58

Current state: mobile tooling, the OTA Worker and the Ship console use Hot Updater rc27. The user reports that mobile 1.6.0 is released on the App Store; its existing rc23 binary does not need rebuilding for this upgrade. The OTA service retains the resource names and URL created for rc22. Scoped local rc23 OTA smoke tests have passed on Duo; fault injection and binary patch tests remain pending.

## Baseline and compatibility

| Component                                                                   | Selected version / target           |
| --------------------------------------------------------------------------- | ----------------------------------- |
| Mobile native version                                                       | `1.6.0`                             |
| Hot Updater CLI, Expo, React Native, Cloudflare plugins, Worker and console | `1.0.0-rc.27`                       |
| Existing store binary's Hot Updater SDK                                     | `1.0.0-rc.23` (build 58)            |
| Expo / React Native / React                                                 | `58.0.2` / `0.88.0-rc.3` / `19.3.0` |
| EAS CLI / build Node                                                        | `24.8.0` / `24.14.1`                |
| Preview and store build image                                               | `macos-tahoe-26.6-xcode-27.0`       |
| Duo simulator build image                                                   | `macos-tahoe-26.6-xcode-27.1`       |

Expo SDK 58 and the selected React Native version are prereleases. Their native ABI changes require a new binary; do not deliver this JavaScript to a 1.5.0 binary.

`pnpm exec hot-updater app-version --json` remains the version-discovery command. Locally it reports iOS `1.6.0`; the old ignored Android native directory still reports `1.5.0`. This preparation targets iOS. Regenerate Android before any Android release.

| Resource   | Existing 1.5.0 / rc14                                  | New 1.6.0 / rc22                                            |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Worker     | `codex-relay-ota`                                      | `codex-relay-ota-rc22`                                      |
| URL        | `https://codex-relay-ota.gron1gh1.workers.dev`         | `https://codex-relay-ota-rc22.gron1gh1.workers.dev`         |
| D1         | `codex-relay` / `1a140b73-204a-4bcb-8492-f4760c40a834` | `codex-relay-rc22` / `c506b378-f360-4787-8888-1c6183d58a2b` |
| Private R2 | `codex-relay-storage`                                  | `codex-relay-rc22-storage`                                  |

The old Worker, database and storage are preserved for 1.5.0 installations using their embedded rc14 URL. The existing Ship console now manages the 1.6.0 resources. The rc22 configuration rejects the legacy D1 ID. Do not apply rc22 migrations to the old database or repoint its Worker.

New D1 markers: engine `1`, core `1.0.0`, Insights `1.2.0`, API keys `1.0.0`. The existing client credential is registered in the new database. Artifact signing retains the existing app key pair; the new Worker has a separate download-URL signing secret.

## Implementation and completed checks

- Updated the rc22 client to `plugins: [insights()]` and per-file diff download progress. Preserved the `appVersion` strategy, signed artifacts, and up to two patch bases.
- Updated Expo packages and strict React Native types, regenerated iOS with SceneDelegate, and installed CocoaPods successfully.
- Enabled rotation and container-width layouts. Chat and workspace panes retain their React/native parent hierarchy through compact/wide transitions and preview hide/show. Sidebar and bottom sheets include horizontal safe-area insets.
- Host-boundary tests cover draft/session component preservation, compact page offset after resize, and returning to chat when the secondary pane is unavailable. These tests do not simulate UIKit, WebView, keyboard, or gesture behavior.
- Initial infrastructure doctor passed all seven required checks, including anonymous rejection and an authenticated empty catalog. App doctor passed package/native wiring checks. Initial R2 listing was empty; the scoped OTA test below subsequently verified artifact writes and native downloads.
- rc22 console opens Bundles, Insights, and API keys against the new database without errors. The local OTA test later produced download and apply events in Insights.
- `pnpm test`: 335 passed, 5 skipped. `pnpm test:release`: 13 Node tests and 6 mobile tests passed. Mobile Vitest: 27 passed. `pnpm typecheck` and `pnpm lint` passed.
- Native startup exposed two installed React Query contexts. Aligned the query, persistence provider, and async-storage persister packages to 5.104.0. A regression test using the installed dependency graph failed with the same `No QueryClient set` error before the change and passes afterward.
- iOS Hermes export succeeds. The output contains the rc22 URL and does not contain the legacy Worker URL.
- EAS archive inspection confirms the OTA public key is included and private environment/key/backup files are excluded. The root Git ignore exception is necessary for the tracked public key to enter the EAS archive.

The custom React Native layouts do not yet consume UIKit's iOS 27.1 reserved-region API. Active division/inner-camera occlusion remains a Duo validation/implementation gate; width, safe-area, and hinge-pose checks alone do not establish complete reserved-region support.

## Native QA candidate

Simulator Release build [3750ecab-a37a-4b4c-a6fa-31368a4317d3](https://expo.dev/accounts/gronxb/projects/codex-relay/builds/3750ecab-a37a-4b4c-a6fa-31368a4317d3) built successfully but **failed native startup** on the iPhone 17 / iOS 26.4 simulator with `No QueryClient set`. It predates the React Query fix and final sidebar-width retention fix. Its artifact contains iOS simulator SDK 27.1, deployment target 16.4, SceneDelegate, production channel, the embedded OTA public key, and the rc22 URL with no legacy URL. Current-source Duo checks are recorded under Host preparation below.

After the dependency fix, a copy of that simulator container was rebundled from the current source with `expo export:embed --platform ios --dev false --bytecode`, signed locally, and installed on iPhone 17 / iOS 26.4. Native checks passed: startup, connection guide, drawer/settings navigation, portrait/landscape transitions, pairing through a cold-start link, keyboard input, and an unsent draft surviving the wide-to-compact transition. The wide layout also displayed chat and workspace preview together. Native logs contain no recurrence of the QueryClient startup exception. Screenshots and logs are private under `.codex/mobile-1.6/`.

This verifies current JavaScript in the existing simulator native container. It does not verify the store IPA on a physical device, Duo folding, reserved regions, WebView/SSH continuity, or OTA delivery/rollback. No chat message was sent during the smoke test.

The earlier build `768d3a9e-ddd0-4682-bc99-4eb8fc8531ad` was canceled because its archive lacked the public key. Do not use it.

From `apps/mobile`:

```sh
pnpm exec eas build:view 3750ecab-a37a-4b4c-a6fa-31368a4317d3
pnpm exec eas build --platform ios --profile duo-simulator --no-wait --non-interactive
```

The build profile overrides the old URL in the EAS preview environment. Public API credentials are supplied by that environment; provider tokens and the artifact private key are not needed in a native build.

## Store build upload

Final rc23 candidate **1.6.0 (58)**: build [750bc767-0a33-4e23-ace1-1cf054ebcb8f](https://expo.dev/accounts/gronxb/projects/codex-relay/builds/750bc767-0a33-4e23-ace1-1cf054ebcb8f), built from clean main commit `820c88adabb189685c332f866cd3dca33f9ecb32`. The build is `FINISHED`. After Apple validation passed locally, EAS submission `fad72657-77d1-4bf1-8231-27b559444d1e` was canceled while still queued and before upload began. The same IPA was uploaded successfully with Xcode altool 27.0.5 using the existing submission credential. Apple delivery `69d41013-3446-4218-92dc-5e9d12008920` reports `VALID`, and App Store Connect confirms build 58 is `VALID / IN_BETA_TESTING / READY_FOR_BETA_SUBMISSION`. The temporary local key copy was removed after verification. This candidate uses official rc23 packages with no preview-package dependency or pnpm adapter patch.

IPA inspection confirms version 1.6.0, build 58, iPhoneOS SDK 27.0, deployment target 16.4, SceneDelegate, production channel, the repository's OTA public key, and the rc23 service's existing endpoint and client credential. The legacy endpoint is absent. SHA-256: `4de57bd1750f14c981af50a290aa5c1447f5990ba79389cd4d6be205d49f1f4d`. Physical-device TestFlight execution remains pending. App Review is the user's responsibility.

Intermediate candidate **1.6.0 (57)**: build [69cd553e-0a95-436d-bbce-e30548b9ee11](https://expo.dev/accounts/gronxb/projects/codex-relay/builds/69cd553e-0a95-436d-bbce-e30548b9ee11), built from merged main commit `19e349f9e4db660efcf1e21754ad12149f91b341`. The build and Apple upload are `FINISHED`, and App Store Connect reports `VALID`. This rc22 candidate is superseded by the official rc23 build 58. At the time of this upload, the live version was 1.5.0. App Review was handled separately by the user.

The IPA confirms version 1.6.0, build 57, iPhoneOS SDK 27.0, deployment target 16.4, SceneDelegate, production channel, an OTA public key matching the repository key, and the rc22 endpoint and client credential without the legacy endpoint. Its SHA-256 is `bdbe66def223091f517217c7692ae2810e3fdd4f4295faf0e574cdd4df1deb41`. It includes the React Query fix, Duo pane and header changes, pairing-route handoff, first-tap keyboard navigation, native WebView continuity fix, and pinned Expo OTA adapter patch. Simulator verification uses an SDK 27.1 native container; this does not replace a physical-device check of the SDK 27.0 store IPA.

Build 55 / upload `8c97ee6f-1d3d-4812-821d-3a5d5b089703` is `VALID` but was built from the pre-merge working tree. Build 56 (`f3af86b9-c9c5-48fe-a766-b780feec135c`) finished from the initial main merge and was not uploaded; build 57 supersedes it with the OTA deployment compatibility fix.

Build 52 / upload `993c9dc2-a5b6-46bb-82fc-fc1659f57bdf` remains `VALID` in App Store Connect but predates the final Duo changes. Intermediate builds 53 and 54 were canceled after native QA found additional issues; neither was uploaded.

**Do not submit build 51 for App Review:** build `1cd9bc21-aeed-4152-ad22-caa57a6388e5` / upload `c57c0f46-beda-436c-87e5-a2d211381a49` contains the dependency graph that failed native startup. It remains visible in App Store Connect but is superseded by build 52.

## CI and local operations

GitHub secrets `MOBILE_ENV_RC22` and `HOT_UPDATER_ENV_RC22` have been provisioned separately. They keep their names for rc27 because the endpoint, resources and credentials are unchanged. The old `MOBILE_ENV` and `HOT_UPDATER_ENV` secrets are unchanged. The existing `HOT_UPDATER_PRIVATE_KEY` is reused.

Local OTA verification exposed an rc22 Expo adapter import failure with Expo 58's package exports (`expo/config/index.js.js`). The temporary pnpm patch validated the diagnosis and is now removed. After the initial rc23 fix in [Hot Updater #1440](https://github.com/gronxb/hot-updater/pull/1440), [#1442](https://github.com/gronxb/hot-updater/pull/1442) switched resolution to the consuming project's `require.resolve` and removed the export-path workaround. Official rc25 includes that change and the legacy Hermes fallback fixes. `pnpm test:release` retains real Node ESM/CommonJS checks against the app's signing-key configuration. The application manifest and lockfile use registry rc27 packages, with no preview-package URLs or local Expo adapter patch.

The existing sequential `ship.N` release convention is retained. The plain `1.6.0` native baseline does not trigger OTA. For a later `1.6.0-ship.N` release, the workflow reads `hot-updater app-version --json`, checks it against Expo config, and passes that exact iOS version to `deploy -t`. There is no additional approval variable or version convention.

Local app configuration reads `.env.hotupdater.rc22`; the CLI's `.env.hotupdater` also points at the new resources. Private legacy backups and logs are under the ignored `.codex/mobile-1.6/` directory. Never commit them.

From `apps/mobile`:

```sh
pnpm exec hot-updater app-version --json
pnpm exec hot-updater doctor --server-base-url https://codex-relay-ota-rc22.gron1gh1.workers.dev
pnpm exec hot-updater console
```

The local console opens at `http://127.0.0.1:1422/`. The deployed rc27 console is [codex-relay.gron-studio.com](https://codex-relay.gron-studio.com), retaining its existing Tailscale exposure and authentication.

The Worker runtime under `worker/dist/` is generated and ignored. On a fresh checkout, regenerate it with the pinned app CLI; it preserves existing scaffold files:

```sh
pnpm exec hot-updater agent infra upgrade --provider cloudflare --build expo --output ../../deployments/hot-updater-rc22 --json
```

Read the emitted instructions and inspect `manifest.json` and `deployment.json` before any remote mutation. Install the standalone Worker dependencies from its directory with `pnpm install --frozen-lockfile`. The four upstream guide/helper files excluded from root formatting retain their original template bytes.

## Host preparation

The user updated the host to macOS `27.0.1` (`26A434`). Xcode `27.1 Beta` (`27A9269`) is installed at `/Applications/Xcode-27.1.0-beta.app` from the user-provided official archive. `xcodes 2.1.0` completed its security assessment and code-signing checks. The user accepted the Xcode and Apple SDKs Agreement and completed first launch. iOS `27.1` (`24A94401`) and the `iPhone Duo` device type are installed. `xcode-select` now points to this installation. The old Xcode 26.4.1 bundle was moved to Trash with the user's administrator authorization, leaving one installed Xcode.

Global `agent-device` was upgraded from 0.12.9 to 0.21.19. Its `fold` command verifies hinge angles through CoreDevice, so Duo testing no longer depends on Device Hub's inaccessible macOS UI. App accessibility capture sometimes falls back to XCTest/private AX; screenshots provide the visual check. Orientation commands currently report success without changing the captured Duo viewport, so rotation has not passed on Duo.

Two adversarial design reviewers agreed to keep two usable panes in the open landscape viewport and a single focused page when narrow. Lateral safe areas are now applied once around the shared pane viewport, recovering about 84pt inside the chat pane on the tested open Duo. The left drawer also stops reserving the far-right screen inset. The split preview header uses a trailing close control and omits the duplicate workspace path; compact preview retains back navigation. Workspace paths use middle truncation, and resizing no longer overwrites the user's preferred preview width when the window temporarily narrows. Preview tabs respond to the first tap while the keyboard is visible. Pairing deep links return to the main Drawer after success, fixing the previously inactive thread menu.

The current source is rebundled into the SDK 27.1 simulator container at the ignored `.codex/mobile-1.6/simulator-duo-design/CodexRelay.app`. Pairing with the user's relay, online Settings, post-pairing Drawer navigation, the workspace picker, keyboard input, first-tap preview navigation with the keyboard visible, and preserving an unsent draft through folding have passed on Duo. Resizing the preview and folding closed/open also retains the chosen width.

Native testing found that Fabric's `display: none` removes native descendants and recycles WKWebView even while React components stay mounted. Stateful pane and tab wrappers now remain attached, using absolute positioning, zero opacity, disabled pointer events and hidden accessibility when inactive; `collapsable={false}` keeps their native parents stable. A local WebView fixture previously lost its in-memory counter and issued another GET after tab switches or preview hide/show. The corrected build retains counter `1` with no additional GET across tab switches, preview hide/show and folding. The fixture, screenshots and request log remain private; no chat message was sent. SSH continuity, controlled transcript scroll anchoring, Duo rotation and active reserved-region occlusion still require separate verification.

Use the installed Duo toolchain explicitly:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.1.0-beta.app/Contents/Developer
xcodebuild -version
xcodebuild -downloadPlatform iOS
xcrun simctl list runtimes
xcrun simctl list devicetypes
```

Confirm iOS 27.1 and the Duo device type before creating or launching the simulator. Keep the stable Xcode 27.0 build profile for the store candidate. The user now requests continuing Duo validation; App Review submission remains the user’s responsibility.

Local CocoaPods required Ruby 3.3.10 with `json` 2.21.1 because the installed json 3.x rejected ActiveSupport's `quirks_mode` argument:

```sh
ruby -e 'gem "json", "2.21.1"; load Gem.bin_path("cocoapods", "pod")' -- install
```

Run this in `apps/mobile/ios` with the matching Ruby environment if the same error occurs. Do not change cloud dependencies unless its build reports the same issue.

## Local OTA verification from main

The migration and Duo work were merged into main, preserving the existing server 1.6.1 release and consuming its already-released changeset. CI and Release passed for `19e349f9e4db660efcf1e21754ad12149f91b341`, including the Expo adapter regression tests. The native `1.6.0` baseline produced no automatic OTA or npm publication. GitHub Secrets registration and workflow references are verified; the secret-backed GitHub OTA deployment steps have not run for this baseline. The OTA below was deployed locally, as requested.

On iPhone Duo / iOS 27.1, the embedded minimum bundle was `01a0f499-1808-7000-8000-000000000000`. A temporary unique cohort selected only that simulator, with public rollout kept at zero. The CLI's displayed ID `01a0fcaa-b259-7108-8844-802724f8975a` identifies the Release policy; its distinct artifact Bundle ID is `01a0fca8-ad0b-7e02-90bd-3d5f881f1256`.

- Local Expo build, artifact signing, R2 upload and D1 registration completed. The native signing public key matches the repository key.
- The live catalog selects the update for the exact QA cohort. The installed client selector chooses the built-in bundle for another cohort and app version 1.5.0; anonymous catalog access returns 401.
- Duo downloaded the signed manifest delivery, displayed Restart app, loaded the OTA after restart, and retained it after a complete process restart. Insights records `UPDATE_DOWNLOADED` and `UPDATE_APPLIED` for the intended artifact.
- Disabling that Release at revision 3 caused the app to stage and load its built-in bundle. A subsequent cold launch shows the original minimum bundle, no pending update, and the restored original cohort. Pairing remains online.
- Final remote state: Release disabled, rollout zero. The artifact is retained for audit. No QA update is publicly deliverable.

This uses the SDK 27.1 simulator native container with the main JavaScript delivered over OTA. It does not establish physical-device TestFlight execution, binary patch delivery from multiple bases, corrupted-signature rejection, launch-failure recovery, interrupted transfers or offline relaunch. Private receipts, screenshots and native metadata are under `.codex/mobile-1.6/`.

## Upstream Expo 58 fix verification

Hot Updater PR #1440 was tested with the immutable preview package `https://pkg.pr.new/@hot-updater/expo@6048d80`, with the local pnpm patch removed. Six real Node resolver scenarios passed, including the four that failed before the fix. The full upstream unit suite passed 3,925 tests (15 skipped), and every PR CI check passed.

The preview adapter built, signed and uploaded another iOS 1.6.0 OTA locally. Release `01a0fcd7-dc51-70b6-9220-ff9f42d347c9` references artifact `01a0fcd5-c53b-7d99-b105-8efea40c5af3`. Rollout remained zero with one temporary Duo QA cohort. Native apply, cold launch, Insights download/apply events, and rollback to BUILTIN all passed. The Release is disabled at revision 3 and the original device cohort is restored. This checks the adapter against the unchanged rc22 native runtime.

PR #1440 merged to `next` as `8bef128cf1c5dc2be020ea67a247c07d10589518`. Release PR [#1441](https://github.com/gronxb/hot-updater/pull/1441) advances all 26 public packages to rc23, with no additional runtime changes. Hot Updater `main` at `2568dd19f` does not contain the config loader or an equivalent runtime import; the affected loader originated on `next` in #1231, so there is no corresponding stable-branch fix to backport.

Official [rc23](https://github.com/gronxb/hot-updater/releases/tag/v1.0.0-rc.23) was published from `b1ee05429d1e8bfdd8553583031dc567eab97dd9`. All 26 registry versions and `rc` tags were verified. Modex's CLI, Expo adapter, Cloudflare adapter and React Native SDK are pinned to rc23. Server tests (335 passed, 5 skipped), mobile tests (27 passed), release checks (13 Node and 6 mobile tests) and typechecking passed with the installed registry packages.

The existing Cloudflare Worker was redeployed as version `5327dd63-e1d8-481c-b404-74e7fd1a5dc8`; its public `/version` reports rc23 / generation 1 / admin protocol 2. The new Worker bytes differ from rc22 only in the version string, and the migration file is identical. Live D1 schema markers and migration history were checked; no migration was reapplied. Existing D1/R2 bindings and Worker secret names are unchanged. The rc23 infrastructure doctor passed all seven required checks, and the packaged authenticated-server verifier passed. The directory, resource names and secret names retain `rc22` as their creation identity.

## Official rc23 verification from main

Modex main commit `820c88adabb189685c332f866cd3dca33f9ecb32` uses the official rc23 registry packages and no local adapter patch. Both CI and Release passed; the native 1.6.0 baseline correctly skipped automatic OTA and npm publication.

A second local deployment against the upgraded rc23 Worker created Release `01a0fcfa-0933-748b-90c8-dfbca927e0a2` and artifact Bundle `01a0fcf7-e968-7a18-b817-4dc25abacaf0`. The app version came from `hot-updater app-version --json`. Rollout stayed zero and one temporary cohort targeted the Duo simulator.

Signed artifact download, native apply, complete process restart, Insights download/apply events, cohort exclusion, app-version 1.5.0 exclusion, and anonymous catalog rejection all passed. After disabling the Release, the simulator staged and loaded its embedded bundle; another cold launch passed with the original cohort restored. The `UPDATE_APPLIED` Insights event reports SDK `1.0.0-rc.23`. Final Release revision is 3, disabled, rollout zero. The artifact remains stored for audit.

This test used the existing SDK 27.1 simulator container, whose Hot Updater native runtime source is unchanged between rc22 and rc23. Build 58 separately compiles the official rc23 native package. Patch generation was skipped because there were no compatible enabled base bundles; this run establishes signed full-artifact delivery and rollback, not binary-patch or fault-injection behavior.

## Official rc25 upgrade

[Hot Updater #1447](https://github.com/gronxb/hot-updater/pull/1447) published rc25 from `103204a126d6fe174a8453faec3bc1f2f61a5849`. Registry tarball integrity and all required rc25 package versions were verified. Comparing the 260 React Native SDK package files against rc23 found only SDK/package version metadata changes; native sources and runtime behavior are unchanged. The existing 1.6.0 binary remains compatible, so this upgrade does not create another store build or publish an OTA release.

The Worker now reports rc25 / generation 1 / admin protocol 2, deployed as version `e6524385-c236-4f61-b263-29951b14e851`. The SQL migration is byte-identical and the live schema already matches; no migration was applied. D1/R2 bindings and secret names are unchanged. Infrastructure doctor, authenticated catalog verification, anonymous rejection and bounded R2 access passed. All three existing 1.6.0 Release records remain identical, disabled at revision 3 with rollout zero.

The console was deployed with Ship from local console commit `8c4371e`, image `ship/codex-relay:20261003020003`. Rollout, HTTPS response, retained authentication, Bundles and Insights pages, and authenticated download of the existing rc23 manifest passed. Anonymous manifest download returns 401. The deployed environment matches the existing private environment file.

Validation: 335 server tests passed (5 skipped), release checks passed (13 Node and 6 mobile tests), typechecking and lint passed. The rc25 Expo adapter built the actual iOS Hermes bundle locally and loaded the Expo 58 signing configuration in both ESM and CommonJS. Console tests (9), typechecking, production Node build and Node smoke tests passed. Private receipts and screenshots are under `.codex/mobile-1.6/rc25/`. Native apply/rollback was not repeated for rc25; the rc23 Duo verification above remains the native baseline.

## Official rc27 upgrade

[Hot Updater #1449](https://github.com/gronxb/hot-updater/pull/1449) published rc27 from `f16b4f40700c88a7a334ce822a0d112a2510ec96`, including the rc26 Insights layout restoration and rc27 failure readability improvements. Mobile and console dependencies use the official registry packages. The React Native package differs from rc25 only in version metadata; the existing 1.6.0 binary remains compatible.

Worker version `b8a82482-ebdc-4468-919d-6ac4cabbd0cc` reports rc27 / generation 1 / admin protocol 2. Runtime bytes differ only in the version string; schema and migrations are unchanged. D1/R2 identities, private storage, bindings, API keys and signing keys are retained. Infrastructure doctor, authenticated catalog verification, anonymous rejection and local R2 read access passed.

The Modex console was deployed with Ship from local console commit `3826639`, image `ship/codex-relay:20261003035829`, at the existing URL and Tailscale exposure. Rollout, HTTPS, authentication, Bundles and Insights views passed. Its deployed environment matches the existing private environment file. Server tests (335 passed, 5 skipped), release checks, typechecking, console tests (9), production build and Node smoke tests passed.

The user requested an asset and JavaScript OTA probe for iOS 1.6.0, production, cohort `219`, with public rollout zero. Physical-device confirmation is required before the requested rollback; existing QA releases remain disabled. Test visuals are temporary and must not remain in main. Receipts are stored privately under `.codex/mobile-1.6/rc27/`.

## Subsequent Duo and OTA battle-test gates

The host, native and scoped OTA checks above cover part of the cases below. Binary patches, fault injection, offline behavior, SSH continuity, controlled transcript scroll anchoring, Duo rotation and active reserved-region occlusion remain pending. Keep the QA release disabled / rollout zero until a specific installation cohort is known. Discover the pinned CLI's live help before creating or changing any Bundle/Release; record their distinct IDs and the native minimum bundle ID.

| Scenario                                     | Required evidence                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Clean 1.6.0 install, empty catalog           | App launches from embedded bundle, authenticated check succeeds, Insights installation appears                |
| Closed/open, rotation, sidebar resizing      | Correct panes and safe areas; no remount, lost draft, terminal reconnect, lost web navigation, or scroll jump |
| Partial folds and camera activity            | No important control under active divisions/occlusions; implement reserved-region handling where needed       |
| Keyboard, sheets, pickers, QR pairing        | Composer remains visible; correct dismissal, hit targets, focus, and image attachment state                   |
| Signed full artifact, exact 1.6.0 QA cohort  | Upload/download succeeds, signature validates, new bundle starts and reports ready                            |
| Patch from two eligible bases                | Correct final content; compare patch/full transfer sizes and progress                                         |
| Missing/corrupt patch or interrupted network | Full fallback or safe retry; no broken launch or persistent update loop                                       |
| Corrupt signature and failing launch         | Bad artifact rejected; previous working bundle recovers and Insights records the failure                      |
| Restart, force update, offline relaunch      | Update applies at the intended point; embedded/previous bundle remains usable offline                         |
| Cohort/channel exclusion and rollback        | Only selected QA installations receive the release; rollback reaches the intended bundle                      |
| Existing 1.5.0 installation                  | Still checks rc14; receives no rc22 artifacts and remains functional                                          |

Do not publish another QA OTA artifact before the candidate's embedded minimum bundle ID and exact cohort are known. Test artifacts remain stored for audit with delivery disabled and rollout zero. Signed manifest delivery and native rollback passed; the remaining fault and patch gates above are not implied by that result. Review these gates and release metadata before the user submits App Review.

## References

- [Expo SDK 58 beta](https://expo.dev/changelog/sdk-58-beta)
- [EAS build images](https://docs.expo.dev/build-reference/infrastructure/)
- [Preparing your app for iPhone Duo](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo)
- [Xcode 27.1 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_1-release-notes)
- [Xcode system requirements](https://developer.apple.com/xcode/system-requirements)

## RC29 HTTP diagnostics upgrade

Hot Updater `next` includes the original-error diagnostics in PR #1450 and HTTP
response attachments in PR #1452. Version `1.0.0-rc.29` was published after PR
#1453. Modex's SDK, CLI, Cloudflare, Expo, and Console dependencies now use rc29.

The existing Worker `codex-relay-ota-rc22` runs version
`5b4e5473-5e6c-4aa4-b582-abba4e1cb0d7` at 100% traffic. Its `/version` reports
rc29 and infrastructure generation 1. DB/R2 bindings, runtime settings, secret
names, schema markers, and migration history were verified unchanged. No schema
migration or resource recreation was needed. Infrastructure and app doctors
passed; anonymous catalog/artifact requests returned 401, authenticated requests
returned 200, and an existing signed manifest downloaded successfully.

The Console at <https://codex-relay.gron-studio.com/insights> runs image
`ship/codex-relay:20261003082617`, built from local console source commit
`b659bc4`. The rollout preserved its environment and routing. Authenticated
browser checks covered failure rates, errors to investigate, and error details
with the reporting SDK and installation context.

HTTP diagnostics keep the existing lifecycle reporting cadence, retries, and
deduplication. Each report may carry the latest response snapshot with its
original receive time, status, path, and a body bounded to 4 KiB of JSON UTF-8.
Successful, cached, and failed responses use the same mechanism. It sends no
additional telemetry requests and is not a complete HTTP request history.

The app version remains 1.6.0. This upgrade did not publish an OTA or change
release delivery policy. Store build 58 still embeds the rc23 SDK; response
collection begins when rc29 JavaScript is distributed. Existing reports that
did not contain an original error cannot be reconstructed retroactively.

Validation: upstream build, typecheck, lint, shadcn design lint, and 4,045 tests
passed; provider/example CI passed. Modex typechecking and 335 tests passed
(5 skipped). Console typechecking, 9 tests, production build, and Node smoke
tests passed. Private receipts are under `.codex/mobile-1.6/rc29/`.
