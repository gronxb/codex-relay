# Mobile 1.6.0: Hot Updater RC32 infrastructure / Expo 58

Current state: the Hot Updater CLI, Cloudflare plugin, Expo plugin, React Native SDK, OTA Worker and Ship console use official `1.0.0-rc.36` from release PR #1480, and native `1.6.1` goes to TestFlight with that SDK. See the RC36 record below for deployment verification. The user reports that mobile 1.6.0 is released on the App Store; its existing rc23 binary does not need rebuilding for this upgrade. The OTA service retains the resource names and URL created for rc22. Scoped local rc23 OTA smoke tests have passed on Duo; fault injection and binary patch tests remain pending.

## Baseline and compatibility

| Component                                              | Selected version / target           |
| ------------------------------------------------------ | ----------------------------------- |
| Mobile native version                                  | `1.6.1` (store: `1.6.0`)            |
| Hot Updater CLI, Cloudflare plugin, Worker and console | `1.0.0-rc.36`                       |
| Local Expo plugin / React Native SDK                   | `1.0.0-rc.36`                       |
| Existing store binary's Hot Updater SDK                | `1.0.0-rc.23` (build 58)            |
| Expo / React Native / React                            | `58.0.2` / `0.88.0-rc.3` / `19.3.0` |
| EAS CLI / build Node                                   | `24.8.0` / `24.14.1`                |
| Preview and store build image                          | `macos-tahoe-26.6-xcode-27.0`       |
| Duo simulator build image                              | `macos-tahoe-26.6-xcode-27.1`       |

Expo SDK 58 and the selected React Native version are prereleases. Their native ABI changes require a new binary; do not deliver this JavaScript to a 1.5.0 binary.

`pnpm exec hot-updater app-version --json` remains the version-discovery command. Locally it reports iOS `1.6.0`; the old ignored Android native directory still reports `1.5.0`. This preparation targets iOS. Regenerate Android before any Android release.

| Resource   | Existing 1.5.0 / rc14                                  | New 1.6.0 / rc22                                            |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Worker     | `codex-relay-ota`                                      | `codex-relay-ota-rc22`                                      |
| URL        | `https://codex-relay-ota.gron1gh1.workers.dev`         | `https://codex-relay-ota-rc22.gron1gh1.workers.dev`         |
| D1         | `codex-relay` / `1a140b73-204a-4bcb-8492-f4760c40a834` | `codex-relay-rc22` / `c506b378-f360-4787-8888-1c6183d58a2b` |
| Private R2 | `codex-relay-storage`                                  | `codex-relay-rc22-storage`                                  |

The old Worker, database and storage are preserved for 1.5.0 installations using their embedded rc14 URL. The existing Ship console now manages the 1.6.0 resources. The rc22 configuration rejects the legacy D1 ID. Do not apply rc22 migrations to the old database or repoint its Worker.

Current D1 compatibility markers: engine `1`, core `1.0.0`, Insights `1.0.0`, API keys `1.0.0`. These are internal schema versions, independent of the `1.0.0-rc.*` npm release version. The existing client credential is registered in the new database. Artifact signing retains the existing app key pair; the new Worker has a separate download-URL signing secret.

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

GitHub secrets `MOBILE_ENV_RC22` and `HOT_UPDATER_ENV_RC22` have been provisioned separately. They retain their names because the endpoint, resources and credentials are unchanged. The old `MOBILE_ENV` and `HOT_UPDATER_ENV` secrets are unchanged. The existing `HOT_UPDATER_PRIVATE_KEY` is reused.

Local OTA verification exposed an rc22 Expo adapter import failure with Expo 58's package exports (`expo/config/index.js.js`). The temporary pnpm patch validated the diagnosis and is now removed. After the initial rc23 fix in [Hot Updater #1440](https://github.com/gronxb/hot-updater/pull/1440), [#1442](https://github.com/gronxb/hot-updater/pull/1442) switched resolution to the consuming project's `require.resolve` and removed the export-path workaround. Official rc25 includes that change and the legacy Hermes fallback fixes. `pnpm test:release` retains real Node ESM/CommonJS checks against the app's signing-key configuration. The application manifest and lockfile use official registry RC30 packages. No local Expo adapter patch is used.

The existing sequential `ship.N` release convention is retained. The plain `1.6.0` native baseline does not trigger OTA. For a later `1.6.0-ship.N` release, the workflow reads `hot-updater app-version --json`, checks it against Expo config, and passes that exact iOS version to `deploy -t`. There is no additional approval variable or version convention.

Local app configuration reads `.env.hotupdater.rc22`; the CLI's `.env.hotupdater` also points at the new resources. Private legacy backups and logs are under the ignored `.codex/mobile-1.6/` directory. Never commit them.

From `apps/mobile`:

```sh
pnpm exec hot-updater app-version --json
pnpm exec hot-updater doctor --server-base-url https://codex-relay-ota-rc22.gron1gh1.workers.dev
pnpm exec hot-updater console
```

The local console opens at `http://127.0.0.1:1422/`. The deployed RC30 console is [codex-relay.gron-studio.com](https://codex-relay.gron-studio.com), retaining its existing Tailscale exposure and authentication.

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

The asset and JavaScript OTA probe used Release `01a0fff0-1442-7318-892e-4440ca0d5ec2`, Bundle `01a0ffed-fffd-7b5a-a405-c82760379b0d`, iOS 1.6.0, production, cohort `219`, and public rollout zero. The user confirmed the physical-device test completed and manually removed the cohort at revision 3. The Release was then disabled at revision 4; the catalog selects BUILTIN for an installation running the probe. Manifest, SVG asset and Hermes bundle downloads passed signature/integrity checks. Test visuals have been removed from source. Receipts are stored privately under `.codex/mobile-1.6/rc27/`.

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

## PR #1454 bundle share preview (2026-10-03)

[Hot Updater #1454](https://github.com/gronxb/hot-updater/pull/1454) was applied to [Modex Insights](https://codex-relay.gron-studio.com/insights). Mobile tooling and the separately hosted console pinned `pkg.pr.new` packages to `041f8acc54debb562963ce5a2853de73bf7ebb11`. PR head `759524b8c72217fdf5a0f0193765b30cfb03e02f` only updates AWS integration write-budget expectations; its runtime matches the deployed preview. All 22 PR checks passed.

The rc22 Worker served version `a46310ad-5b58-485d-b096-61951c85c4ec` at 100% traffic. D1 migration `0002_hot-updater_1.0.0-rc.30.sql` adds daily observation heads and distribution history, raising the internal Insights compatibility marker from `1.2.0` to `1.3.0`. The guide/migration filename identifies the planned release; installed preview package metadata and the server version endpoint still report `1.0.0-rc.29`.

A private D1 export was saved before migration. Insights ingestion was briefly paused during the coordinated schema/runtime cutover and then resumed. Full before/after comparisons preserved all 6 bundle rows, 8 release rows and the existing API key row. Anonymous catalog/artifact requests remain rejected (401); authenticated catalog/artifact requests and signed manifest downloads succeed (200). The existing credentials, signing configuration and legacy 1.5.0 resources are retained.

The Ship deployment uses `ship/codex-relay:pr1454-041f8ac` (image digest `sha256:03ba153cd1aa01b9b7a80400c7e62d5896ef0830106f53900bf1ed583add41ec`). Rollout and authenticated Insights navigation passed; deployment environment and secret fingerprints match the previous deployment. Console tests (9), typecheck, production/Docker builds, auth/protected-route smoke tests and mobile typecheck passed. Scaffold doctor, all seven infrastructure doctor checks and the packaged server verifier passed. App doctor reports a dependency-alignment false positive because it compares the CLI's full preview URL literally with other package locators; it is not recorded as passing.

The authenticated live chart showed 8 real reporting installations: one known bundle at 12.5% and unknown bundle at 87.5%, including counts in the tooltip and the unfinished UTC-day label. Historical days remain empty because daily observation history begins at upgrade. Aggregate health KPIs and the separate Launch failures tab were verified. No synthetic production events or new OTA release were created.

Private backups, provider receipts, test logs and unedited screenshots are under `.codex/mobile-1.6/pr1454/`. Keep this directory ignored.

## Official RC30 upgrade (2026-10-04 KST)

Release [#1456](https://github.com/gronxb/hot-updater/pull/1456) published official `1.0.0-rc.30` from `72b562c3074da5c8f0e9eaede8cc33a8b331b44e`, including [#1457](https://github.com/gronxb/hot-updater/pull/1457). Modex now pins the CLI, Cloudflare, Expo and React Native packages to RC30; the hosted Console also uses RC30. All commit-pinned preview URLs have been removed from the active dependency graph.

The existing Worker `codex-relay-ota-rc22` serves version `c662bf89-8026-46a5-aa30-5bc3bd18bba1` at 100% traffic. `/version` reports RC30 and infrastructure generation 1. The prior preview had already applied `0002_hot-updater_1.0.0-rc.30.sql`; its SQL matches the official scaffold and Insights remains at schema `1.3.0`. No SQL was replayed. Before/after reads confirmed that all 6 bundles, 8 releases and the API key record are unchanged. Worker bindings, runtime settings, signing secret and endpoints are retained.

The Console at <https://codex-relay.gron-studio.com/insights> runs `ship/codex-relay:rc30-72b562c` in `kind-ship` / `ship-services`, with its existing environment and OAuth session. Authenticated browser verification covered Bundle share and Adoption: Chart newest bundle selected the existing production release and rendered 245 cumulative download reports over six-hour intervals, retaining the tab and Release ID in the URL. Its existing sign-in icon patch was carried forward to the RC30 package. Reproducible host sources are saved in local console commit `f8931e5`; the image digest is `sha256:1d5152850ad4fcb5ceedb96a53c2f526eba5dfc50d52e9ee7cbd102ed7c79b3b`.

Validation: Modex server tests (335 passed, 5 skipped), release tests, typechecking and lint passed. Console tests (9 passed), typechecking, Node production build, runtime authentication smoke checks and Docker build passed. Scaffold, infrastructure (7 checks) and app doctors passed. Anonymous catalog/artifact requests return 401; authenticated requests and a signed manifest return 200. R2 reads work with the app configuration’s existing credentials. Private receipts are under `.codex/mobile-1.6/rc30/`.

This migration does not publish a mobile OTA or rebuild the store binary. App 1.6.0 build 58 still embeds SDK RC23; native release OTA behavior was not re-tested for this package upgrade. The previously noted Android native directory remains at 1.5.0 and requires regeneration before an Android release.

## Official RC31 upgrade (2026-10-05 KST)

Release [#1460](https://github.com/gronxb/hot-updater/pull/1460) published official `1.0.0-rc.31` from `464f5e3162f059b5b9df701158b6b164099a5886`, including [#1459](https://github.com/gronxb/hot-updater/pull/1459). Release health now compares bundle deployments in two tabs: Adoption plots applies per bundle, and Crashes plots recoveries with a crash rate. It recommends a rollback at 5% of at least 20 attempts. Bundle share, the Downloads/Adoption tabs, the metrics row and Launch failures are gone. Insights returns to the 1.0.0 baseline at schema `1.2.0`. RC31 deletes the RC30 migration and upgrade guide, so the scaffold's `upgrades/` and `worker/migrations/` lose their RC30 files.

The database left RC30 by a fence-safe cutover. The Worker's schema fence keeps a passing check per isolate and rechecks failures.

1. A private D1 export and Time Travel bookmark `0000038d-00000000-000050fb-bf486526a14d21bb97d958bea8828539` were taken first.
2. The RC31 Worker was uploaded as version `51ff4c58-299d-48ff-97b3-f19c3fe35d88` without traffic.
3. `schema.insights` was set from `1.3.0` to `1.2.0`. Within seconds, 100% of traffic moved to that version and the Ship console rolled out. Worker deploys use wrangler's OAuth login, since the app's D1 token has no Worker access.
4. Once RC31 served, the leftovers the RC31 baseline no longer has were dropped:
   - `bundle_daily_heads` (1,448 rows) and `insights_distribution_history` (183 rows);
   - the `bundle_events_recent` index;
   - the `launch_users` sketch columns.

The live schema now matches RC31's `0001_hot-updater_1.0.0.sql` exactly: 49 objects, no differences. The `0002_hot-updater_1.0.0-rc.30.sql` row stays in D1 migration history.

**First attempt.** The first cutover used the app's D1 token for the deploy. The deploy was refused while the marker already read `1.2.0`, and the marker was restored after 18 seconds (08:42:30–08:42:48Z). RC30 kept serving: authenticated catalog 200, anonymous 401.

**Data.** All 6 bundles, 1 patch, 8 releases, 2 release catalogs, 2 channels and the API key are unchanged. Insights events, heads and aggregates were preserved and kept growing through the cutover. RC31 recorded a live `UPDATE_DOWNLOADED` 26 seconds after the switch. Endpoints, bindings, R2, secrets and signing are retained.

**Console.** The Console at <https://codex-relay.gron-studio.com/insights> runs `ship/codex-relay:rc31-464f5e3` (digest `sha256:0106cd8db8dfb397dda9a518566214d36c1bdbafec9d43c9c8036954d85aa2e7`) with its existing environment. The sign-in icon patch moves to RC31. Host sources are in local console commit `2511d5b`. The pod is ready, answers 200, and logs no schema errors. Its OAuth session wasn't available to this run, so the RC31 Console was checked locally (`hot-updater console`) against the live database instead:

- Adoption showed the two newest production bundles (295 and 5 applies, 25 and 0 update failures).
- Crashes showed 2 crashes (0.7%) and 1 crash in 6 attempts (16.7%). The second is below the 20-attempt minimum, so there was no rollback prompt.

**OTA.** None is needed. React Native RC31 differs from RC30 only in its SDK version string and its `@hot-updater/plugin-insights` pin, and that package's client code is unchanged.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks; app passed.
- Packaged server verifier: version matches, anonymous catalog 401, authenticated 200.
- Artifacts: anonymous 401, authenticated 200, and the signed manifest returns 200 (27,309 bytes).
- R2 bounded list with the app's credentials: 200.
- Modex: server tests (335 passed, 5 skipped), release tests (13 Node, 6 mobile), typechecking and lint.
- Console: tests (9), typechecking, Node production build, auth and protected-route smoke checks, and Docker build.

Private receipts, backups and screenshots are under `.codex/mobile-1.6/rc31/`.

## Official RC32 upgrade (2026-10-05 KST)

Release [#1463](https://github.com/gronxb/hot-updater/pull/1463) published official `1.0.0-rc.32` from `28f8637a456f58581a1354f4bd8a7eae5177cdc5`. It includes:

- [#1461](https://github.com/gronxb/hot-updater/pull/1461): Release health names bundles by release ID, and Adoption shows applies only.
- [#1462](https://github.com/gronxb/hot-updater/pull/1462): requests the SDK's timeout cuts off are reported as `Request timed out` under Expo's fetch too. Expo rejects that abort with `fetch failed: FetchRequestCanceledException`, which the SDK had reported as an unknown update-check failure. Expo's other fetch failures without a response classify as network errors.

The database schema is unchanged (Insights `1.2.0`); no SQL ran. Worker `codex-relay-ota-rc22` was uploaded as version `8ec016b1-39df-46de-ac22-0a87d1b07bdc` without traffic and then switched to 100% at the same URL.

The Ship console runs `ship/codex-relay:rc32-28f8637` (digest `sha256:90516c2f0bd93462b32087144e554b877fbe4af60da2224d9f7ca857f2e76bbd`), with host sources in local console commit `eeb8896`.

Before/after reads preserved all 6 bundles, 1 patch, 8 releases, 2 release catalogs, 2 channels and the API key, and RC32 recorded a live report 32 seconds after the switch (Time Travel bookmark `000003d4-00000014-000050fb-a69b520cc1c18ab63d07dd37b06fb1e7`). The RC32 Console, run locally against the live database, names the two newest production bundles by ID (306 and 5 applies) and shows Adoption as applies only.

**OTA.** Devices report original errors only from a bundle built with SDK rc.32. The store binary's built-in bundle (rc.23) and the public SSH-screen bundle (rc.27) send none, so their reports stay without messages until an OTA. The owner then chose a production OTA. Changeset `hot-updater-rc32-errors` produced release PR [#115](https://github.com/gronxb/codex-relay/pull/115), which merged as `06f4f3b`. The Release workflow deployed `@codex-relay/mobile@1.6.0-ship.2` for iOS 1.6.0 at 100% (production release `01a10c61-d8cd-7b56-ba25-7f83b9c169e9`, bundle `01a10c5e-3b5d-7ca6-bf54-ae5d1bd8889a`). It supersedes the public SSH-screen bundle and ship.1, which had been held to cohort `707`. Compared with ship.1 (SDK rc.29), only the SDK's timeout handling and Expo fetch classification (#1462) and its version change. The Expo build plugin and the Insights client are byte-identical. Catalog generation 22 serves the release first, and its signed manifest downloads (26,413 bytes). Devices on ship.2 don't report update checks cut off by the SDK's 5 s timeout, and their remaining failures carry original errors. Devices still running older bundles keep sending message-less reports until they update. In the first 22 minutes, 17 installations downloaded ship.2 and the first applied it, reporting from SDK rc.32, with no recoveries. The 3 failures in that window came from devices still on SDK rc.23 or rc.27.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks; app passed.
- Packaged server verifier: version matches, anonymous catalog 401, authenticated 200.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200.
- R2 bounded list: 200.
- Modex: server tests, release tests, typechecking and lint.
- Console: tests, typechecking, Node build, smoke checks and Docker build.

Private receipts are under `.codex/mobile-1.6/rc32/`.

## Official RC33 upgrade (2026-10-06 KST)

Release [#1465](https://github.com/gronxb/hot-updater/pull/1465) published official `1.0.0-rc.33` from `49f8d5448305c029dd1a0de77a1a2b5fce6ee733`, including [#1464](https://github.com/gronxb/hot-updater/pull/1464). The Bundles column's **Active days** becomes **Applied**: a release's apply reports, as EAS Update counts the users who have run an update. Known crashes are now rated over applied plus known crashes, as in Release health. Insights moves to schema `1.4.0` in the 1.0.0 baseline:

- hourly and daily counters lose `launches` and `failed_updates`, which nothing read;
- a release's lifetime counters count `applies`.

**Cutover.** The cutover was fence-safe:

1. A private D1 export and Time Travel bookmark `0000048b-0000001a-000050fc-7e04ff6fef7da5a3a5f7c2651b0918ae` were taken first.
2. The RC33 Worker was uploaded as version `c89fd3c3-646e-4c5f-a1ca-0dd996eea88f` without traffic.
3. One D1 batch then ran at 02:05:24Z:
   - It dropped the two unused columns from `insights_overview` and `insights_overview_daily`.
   - It rebuilt `insights_overview_lifetime` in the baseline's column order, with `applies` counted from the apply reports kept in `bundle_events`.
   - It set `schema.insights` to `1.4.0`.

   Four seconds later, 100% of traffic moved to that version. The Ship console rolled out a second after.

The batch was first rehearsed on SQLite copies of two exports. The backfill matched all 9 release lifetime identities with the RC33 plugin's own identity hash and wrote 430 applies: 350 for the SSH-screen bundle and 65 for ship.2, where Active days had read 403 and 72. Ship.1, held to cohort `707`, now shows 5 applies and 1 known crash (16.67%), where it showed 6 active days (14.29%). Downloads, known crashes, update failures and patch counters were copied unchanged. The live schema now matches RC33's `0001_hot-updater_1.0.0.sql` exactly: 49 objects, no differences.

**Data.** All 7 bundles, 3 patches, 9 releases, 2 release catalogs, 2 channels and the API key are unchanged. Insights events, heads, sketches and aggregates were preserved. RC33 recorded a live `UPDATE_DOWNLOADED` 31 seconds after the switch, then an apply. The lifetime applies total (431) equals the apply reports in `bundle_events`. Endpoints, bindings, R2, secrets and signing are retained.

**Console.** The Ship console runs `ship/codex-relay:rc33-49f8d54` (image `sha256:ba13e7f0601afc53db0fcb4a06b8a174d2ad8ce190bca39cbfb64adc8bde5130`) with its existing environment. Host sources are in local console commit `b2e9f87`, and the sign-in icon patch moves to RC33. The pod is ready, answers 200, and logs no schema errors. The RC33 Console, run locally against the live database, shows Applied on the Bundles page: ship.2 has 416 downloads, 66 applies and 0 known crashes.

**OTA.** None is needed. React Native RC33 changes only its SDK version and its `@hot-updater/plugin-insights` pin, and the Insights client code is unchanged.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks; app passed.
- Packaged server verifier: version matches, anonymous catalog 401, authenticated 200.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Modex: server tests (335 passed, 5 skipped), release tests (13), typechecking and lint.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

Private receipts, backups and screenshots are under `.codex/mobile-1.6/rc33/`.

## Official RC34 upgrade (2026-10-06 KST)

Release [#1467](https://github.com/gronxb/hot-updater/pull/1467) published official `1.0.0-rc.34` from `4baee783b57557b1948b478ff3153d6646d05f28`, including [#1466](https://github.com/gronxb/hot-updater/pull/1466):

- **Crash exit reasons are gone.** Android 11+ reported only an `ApplicationExitInfo` reason such as `CRASH` or `ANR`, with no stack trace or message, and iOS reported nothing. This app, iOS only, had none. The Update failures card loses **Crashes by exit reason**, and a crash count in Release health is no longer a link.
- **The Insights schema version is pinned to `1.0.0`**, as core's is, while the 1.0.0 baseline changes in place.
- **Console tooltips are shorter.** Each says what the number is and how it is computed.

**Cutover.** No table changed: the RC34 baseline differs from RC33's only in the Insights marker, and the database had no exit-reason rows.

1. A private D1 export and Time Travel bookmark `000004cb-00000010-000050fc-b80ee06a8445c4b122f2ec5878f27b76` were taken first.
2. The RC34 Worker was uploaded as version `0a52cb66-d6e9-40c5-bf03-14a0e57b3259` without traffic.
3. At 06:02:23Z, `schema.insights` was set from `1.4.0` to `1.0.0`.
4. 100% of traffic moved to that version three seconds later, and the Ship console rolled out two seconds after that.

The live schema matches RC34's `0001_hot-updater_1.0.0.sql` exactly: 49 objects, no differences.

**Data.** All 7 bundles, 3 patches, 9 releases, 2 release catalogs, 2 channels and the API key are unchanged, as are the Insights rows. RC34 recorded a live `UPDATE_DOWNLOADED` at 06:04:06Z. Endpoints, bindings, R2, secrets and signing are retained.

**Console.** The Ship console runs `ship/codex-relay:rc34-4baee78` (image `sha256:a21bb1d6fedb31cbd8c513fa82dacb160ed8acfb307ab6b974ea327ef02745d3`) with its existing environment. Host sources are in local console commit `0b59c9a`, and the sign-in icon patch moves to RC34. The pod is ready, answers 200, and logs no schema errors.

I also ran the RC34 Console locally against the live database:

- Release health shows ship.2 with 0 crashes and ship.1 with 1 crash in 6 attempts (16.7%), as plain counts.
- Update failures loads without the exit-reason section.

**OTA.** None is needed. The SDK stops reading Android exit reasons, and this app runs only on iOS, where nothing was ever read.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks; app passed.
- Packaged server verifier: version matches, anonymous catalog 401, authenticated 200.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Modex: server tests (335 passed, 5 skipped), release tests (13), typechecking and lint.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

Private receipts and backups are under `.codex/mobile-1.6/rc34/`.

## Official RC35 upgrade and native 1.6.1 (2026-10-07 KST)

Release [#1472](https://github.com/gronxb/hot-updater/pull/1472) published official `1.0.0-rc.35` from `9b432c1cb`. Every package now shares that version ([#1477](https://github.com/gronxb/hot-updater/pull/1477)). It changes only the React Native SDK, so this app needs a new binary to get it:

- **One retry after an unfinished launch** ([#1471](https://github.com/gronxb/hot-updater/pull/1471), issue #1469). A launch that ends before its first render without a crash still rolls back and reports `RECOVERED`, but the bundle no longer goes into crash history at once: a later session retries it once.
- **Launches without UI stay pending** ([#1470](https://github.com/gronxb/hot-updater/pull/1470), issue #1468). A background launch no longer leaves an unfinished launch behind, so the next launch does not roll a healthy bundle back.
- **A session's launch result stays final** when an update downloads during the session.
- **Android builds the New Architecture by default.** This app ships only on iOS.

**Infrastructure.** No schema or binding changed: the scaffold differs from RC34 only in versions and the Worker bundle, and the migration is identical.

1. Time Travel bookmark `0000055d-00000010-000050fc-686dcfaa8a2ea98cc2249f6fcf8d2916` was taken first.
2. The RC35 Worker was uploaded as version `4e0b46a1-4e3a-45d2-9f7c-ca10619943d8` without traffic, with the same D1, R2 and variable bindings.
3. At 16:30:33Z, 100% of traffic moved to it. The Ship console rolled to `ship/codex-relay:rc35-9b432c1` three seconds later.

`/version` reports `1.0.0-rc.35`. The schema markers are unchanged.

**Console.** The Ship console runs `ship/codex-relay:rc35-9b432c1` with its existing environment. Host sources are pinned to RC35 in the local console repository, and the sign-in icon patch moves to RC35. The pod is ready, answers 200, and logs no schema errors.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks (iOS, production, app version 1.6.0); app passed.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

**Native 1.6.1.** `app.config.ts` and the package version move to `1.6.1`, so the next ship OTA targets 1.6.1 (`1.6.1-ship.1`). Existing 1.6.0 installations keep receiving only 1.6.0 releases.

Store candidate **1.6.1 (59)**: build [289d2aa0-b84e-4f42-b155-2c048566eb65](https://expo.dev/accounts/gronxb/projects/codex-relay/builds/289d2aa0-b84e-4f42-b155-2c048566eb65), built from clean main commit `9be6c4781`, and EAS submission [797c198c-4c5a-4d79-adff-f410a454353a](https://expo.dev/accounts/gronxb/projects/codex-relay/submissions/797c198c-4c5a-4d79-adff-f410a454353a) uploaded it to App Store Connect for TestFlight with the EAS-managed API key. The IPA shows version 1.6.1, build 59, iPhoneOS SDK 27.0, deployment target 16.4, SceneDelegate, the production channel, an OTA public key matching the repository key, the rc22 endpoint without the legacy endpoint, and SDK `1.0.0-rc.35`. SHA-256: `3e4a723de5d2cfad7ad04bd208f25a9e7326891225c6b4ae174924349fee6a20`. App Review is not submitted.

Private receipts and backups are under `.codex/mobile-1.6/rc35/`.

## Official RC36 upgrade (2026-10-07 KST)

Release [#1480](https://github.com/gronxb/hot-updater/pull/1480) published official `1.0.0-rc.36` from `33b092adb`, carrying [#1479](https://github.com/gronxb/hot-updater/pull/1479):

- **Insights reports installations on the built-in bundle.** The SDK passes `minBundleId` to client plugins, and the Insights client sends it with each report. The server counts installations that run their build's built-in bundle in a new gauge, `insights_builtin_distribution`. The console's Distribution shows **Built-in app** with the bundle ID under each app version instead of **Unknown bundle**, and event and installation details mark the built-in bundle. Reports from older binaries (rc23 in 1.6.0) count as before.
- **iOS reads the built-in bundle ID from the `HOT_UPDATER_MIN_BUNDLE_ID` build setting** instead of the compile time of `HotUpdater.mm`. EAS builds don't pass the setting, so this app still falls back to the compile time.

**Infrastructure.** The 1.0.0 baseline gains one table, with no other change, and the schema markers stay.

1. Time Travel bookmark `00000585-0000000a-000050fc-c6bcad9d9a064e7f15761e95fc90d21f` was taken first.
2. `insights_builtin_distribution` and its three indexes were created from the RC36 baseline. The RC35 Worker ignores them. Live D1 then matched the baseline: 53 of 53 objects, nothing missing or extra.
3. The RC36 Worker was uploaded as version `cb0a3b0f-7436-44d5-8d27-265b4575d3de` without traffic.
4. At 19:22:58Z, 100% of traffic moved to it. The Ship console rolled to `ship/codex-relay:rc36-33b092a` four seconds later.

`/version` reports `1.0.0-rc.36`.

**Console.** Host sources are pinned to RC36 in the local console repository, and the sign-in icon patch moves to RC36. The pod is running and the public URL answers 200.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks (iOS, production, app version 1.6.0); app passed.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

**Native 1.6.1 (60).** EAS build `61c47db8-9ff4-451f-872d-3f5f02eb26ff` (production, RC36 SDK) was uploaded to App Store Connect through EAS submission `360a21f5-7c19-4053-ae7b-d9fb5d982a12`. The IPA reports 1.6.1 (60) and its bundle carries the RC36 Insights client and the rc22 URL. It supersedes 1.6.1 (59), built with RC35; test 60 in TestFlight.

Private receipts and backups are under `.codex/mobile-1.6/rc36/`.

## Official RC37 upgrade (2026-10-07 KST)

Release [#1482](https://github.com/gronxb/hot-updater/pull/1482) published official `1.0.0-rc.37` from `15184eec5`, carrying [#1481](https://github.com/gronxb/hot-updater/pull/1481). Only the server and the console changed; the React Native SDK's code is the same as RC36.

- **Insights keeps the launches that change an installation.** A launch report becomes an event only when it is the installation's first report, names a new app version or native build, runs another bundle with no apply report for it, runs the same bundle under another release, or comes from another channel. A launch that changes nothing still writes no event, so a daily launch costs what it did.
- **The console shows each release as Downloaded, Launched, and Crashed**, counting installations once each. The bundle detail shows the downloads not launched yet, and Release health's Adoption counts launches per interval or as a running total.
- A download or apply that arrives after its installation already ran the bundle counts nothing, and a launch whose download report never arrived counts that download too.

**Insights before RC37.** 3,231 installations had reported, 1,057 of them in the last 24 hours. Each installation downloaded a bundle once (the SSH-screen bundle: 1,367 downloads by 1,367 installations; `1.6.0-ship.2`: 1,190 by 1,190), while 380 and 228 of them reported launching it.

**Infrastructure.** No schema or binding changed, and the schema markers stay.

1. Time Travel bookmark `00000608-00000002-000050fd-e6ad1d534df5d80946d3b134cc303829` was taken first.
2. The RC37 Worker was uploaded as version `3b540eb4-77c0-4221-a7f1-bb3c749706dd` without traffic, with the same D1, R2 and variable bindings.
3. At 03:33:03Z, 100% of traffic moved to it. The Ship console rolled to `ship/codex-relay:rc37-15184ee` four seconds later.

`/version` reports `1.0.0-rc.37`.

**Console.** Host sources are pinned to RC37 in the local console repository, and the sign-in icon patch moves to RC37. The pod is running, logs no schema errors, and the public URL answers 200.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks (iOS, production, app version 1.6.0); app passed.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

Private receipts and backups are under `.codex/mobile-1.6/rc37/`.

## OTA `1.6.1-ship.1` on 1.6.x (2026-10-07 KST)

Release PR [#116](https://github.com/gronxb/codex-relay/pull/116) (merge `8a01f71`) shipped the RC37 SDK through the release workflow: release `01a11483-89ad-7b05-a063-abb3897d1117`, bundle `01a1147f-ed45-7d68-aa89-52da2cf0bea4`, 100% of production, targeting 1.6.1.

**Widened to 1.6.x.** The RC35 section recorded that existing 1.6.0 installations keep receiving only 1.6.0 releases. This OTA deliberately reaches them too: since `1.6.0-ship.2` the app's code changed only its version, and the SDK's JavaScript changed only in [hot-updater#1466](https://github.com/gronxb/hot-updater/pull/1466) (it stops reading a native field it ignored) and [hot-updater#1479](https://github.com/gronxb/hot-updater/pull/1479) (it sends `minBundleId`). Neither needs native code the 1.6.0 binary (RC23 native) lacks.

At 04:00:13Z, `hot-updater bundle update 01a11483-… --target-app-version 1.6.x --expected-revision 1` moved the release to revision 2 and the iOS production catalog from generation 23 to 24, as its dry run projected:

| App version              | Before (generation 23)                          | After (generation 24)                        |
| ------------------------ | ----------------------------------------------- | -------------------------------------------- |
| 1.6.0                    | `1.6.0-ship.2`, then the earlier 1.6.0 releases | `1.6.1-ship.1` first, then the same releases |
| above 1.6.0, below 1.7.0 | `1.6.1-ship.1` (1.6.1 only)                     | `1.6.1-ship.1`                               |

The infrastructure doctor's catalog checks pass for 1.6.0 and 1.6.1. To undo the widening, set the release's target back to `1.6.1`; 1.6.0 installations then return to `1.6.0-ship.2`.

**First reports.** 47 minutes after the widening, 32 installations on 1.6.0 had downloaded the bundle and 3 had launched it. Each launch reported SDK `1.0.0-rc.37` and the 1.6.0 binary's built-in bundle `01a0f5e7-c3d0-7000-8000-000000000000`, and none crashed back. One download failed with reason `unknown` from the RC23 SDK, in line with the 80 to 100 update failures a day before this OTA. No 1.6.1 installation had reported yet.

**Kept launch reports after RC37.** In the first 38 minutes after the cutover, the server kept 21 `UNCHANGED` rows, all first reports of new installations (the head count grew from 3,231 to 3,265 in about two hours). Launches that changed nothing wrote no event.

## Official RC38 upgrade (2026-10-07 KST)

Release [#1484](https://github.com/gronxb/hot-updater/pull/1484) published official `1.0.0-rc.38` from `c09c02375`, carrying [#1485](https://github.com/gronxb/hot-updater/pull/1485), which fixes two report orders that #1481's review flagged. Only the server and the console changed; the React Native SDK's code is the same as RC37.

- A launch report made, by its event ID, before the installation's latest report is late even after a later report, such as a user switch or the next day's launch, replaced the apply it preceded. It no longer counts a launch and a download of the bundle the installation left, or moves the installation back to it.
- A download that repeats the installation's pending one, from the same bundle to the same bundle, counts nothing, so a download reported twice before its launch counts once.

**Infrastructure.** No schema or binding changed, and the schema markers stay.

1. Time Travel bookmark `0000065e-0000000e-000050fd-7b2732dd5b7437c393ec01963f69e672` was taken first.
2. The RC38 Worker was uploaded as version `4d724e57-5ace-4252-ab55-cb4f08e79d70` without traffic, with the same D1, R2 and variable bindings.
3. At 08:47:54Z, 100% of traffic moved to it. The Ship console rolled to `ship/codex-relay:rc38-c09c023` three seconds later.

`/version` reports `1.0.0-rc.38`.

**Console.** Host sources are pinned to RC38 in the local console repository, and the sign-in icon patch moves to RC38. The pod is running, logs no schema errors, and the public URL answers 200.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks (iOS, production, app version 1.6.0); app passed.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

No OTA: the app's JavaScript is unchanged, so `1.6.1-ship.1` stays the release for 1.6.x.

Private receipts and backups are under `.codex/mobile-1.6/rc38/`.

## Official RC39 upgrade (2026-10-07 KST)

Release [#1488](https://github.com/gronxb/hot-updater/pull/1488) published official `1.0.0-rc.39` from `8d358d516`, carrying [#1487](https://github.com/gronxb/hot-updater/pull/1487). The server and the console changed; the React Native SDK's code is the same as RC37 apart from its version.

- **Release health draws downloads beside launches.** Adoption shows each bundle's downloads as a dashed line and its launches as a solid line, in the bundle's color, and its table shows both counts for the period. The Per interval / Cumulative switch is gone.
- A download that a launch or crash implied, when its download report never arrived, now also counts in the bundle's hourly download counter, so the dashed line covers every download its release counts.
- The console names the counts Downloaded, Launched, and Crashed everywhere, including Release health's crash table.

**Insights before RC39.** No stored event carried `implied_download`, so the hourly download counters needed no backfill. Every download row came from a different installation: 1,367 for the SSH-screen bundle, 1,212 for `1.6.0-ship.2`, and 244 for `1.6.1-ship.1`. 3,531 installations had reported.

**Infrastructure.** No schema or binding changed, and the schema markers stay.

1. Time Travel bookmark `0000067b-00000030-000050fd-4edaa5190fbde3b30d8f4f4ceb560995` was taken first.
2. The RC39 Worker was uploaded as version `54fe027f-55df-4bdd-b347-6d6f9224714a` without traffic, with the same D1, R2 and variable bindings.
3. At 10:51:44Z, 100% of traffic moved to it. The Ship console rolled to `ship/codex-relay:rc39-8d358d5` four seconds later.

`/version` reports `1.0.0-rc.39`.

**Console.** Host sources are pinned to RC39 in the local console repository, and the sign-in icon patch moves to RC39. The pod is running, logs no schema errors, and the public URL answers 200.

**Validation.**

- Doctors: scaffold passed; infrastructure passed all 7 checks (iOS, production, app version 1.6.0); app passed.
- Artifacts: anonymous 401, authenticated 200; the signed manifest returns 200 (27,309 bytes).
- R2 bounded list: 200.
- Console: tests (9), typechecking, Node build, smoke checks and Docker build.

Private receipts and backups are under `.codex/mobile-1.6/rc39/`.
