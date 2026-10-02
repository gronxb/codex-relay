# Mobile 1.6.0: rc22 / Expo 58 preparation

Scope: prepare mobile 1.6.0 with an isolated rc22 OTA service, upload the store build, and continue iPhone Duo simulator validation after the host update. The user will submit App Review. Native OTA battle tests remain unperformed.

## Baseline and compatibility

| Component                                                          | Selected version / target           |
| ------------------------------------------------------------------ | ----------------------------------- |
| Mobile native version                                              | `1.6.0`                             |
| Hot Updater CLI, Expo, React Native, Cloudflare plugins and Worker | `1.0.0-rc.22`                       |
| Expo / React Native / React                                        | `58.0.2` / `0.88.0-rc.3` / `19.3.0` |
| EAS CLI / build Node                                               | `24.8.0` / `24.14.1`                |
| Preview and store build image                                      | `macos-tahoe-26.6-xcode-27.0`       |
| Duo simulator build image                                          | `macos-tahoe-26.6-xcode-27.1`       |

Expo SDK 58 and the selected React Native version are prereleases. Their native ABI changes require a new binary; do not deliver this JavaScript to a 1.5.0 binary.

`pnpm exec hot-updater app-version --json` remains the version-discovery command. Locally it reports iOS `1.6.0`; the old ignored Android native directory still reports `1.5.0`. This preparation targets iOS. Regenerate Android before any Android release.

| Resource   | Existing 1.5.0 / rc14                                  | New 1.6.0 / rc22                                            |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Worker     | `codex-relay-ota`                                      | `codex-relay-ota-rc22`                                      |
| URL        | `https://codex-relay-ota.gron1gh1.workers.dev`         | `https://codex-relay-ota-rc22.gron1gh1.workers.dev`         |
| D1         | `codex-relay` / `1a140b73-204a-4bcb-8492-f4760c40a834` | `codex-relay-rc22` / `c506b378-f360-4787-8888-1c6183d58a2b` |
| Private R2 | `codex-relay-storage`                                  | `codex-relay-rc22-storage`                                  |

The old Worker, database, storage, and Ship console are preserved. The rc22 configuration rejects the legacy D1 ID. Do not apply rc22 migrations to the old database or repoint its Worker. Existing installations continue using their embedded rc14 URL.

New D1 markers: engine `1`, core `1.0.0`, Insights `1.2.0`, API keys `1.0.0`. The existing client credential is registered in the new database. Artifact signing retains the existing app key pair; the new Worker has a separate download-URL signing secret.

## Implementation and completed checks

- Updated the rc22 client to `plugins: [insights()]` and per-file diff download progress. Preserved the `appVersion` strategy, signed artifacts, and up to two patch bases.
- Updated Expo packages and strict React Native types, regenerated iOS with SceneDelegate, and installed CocoaPods successfully.
- Enabled rotation and container-width layouts. Chat and workspace panes retain their React/native parent hierarchy through compact/wide transitions and preview hide/show. Sidebar and bottom sheets include horizontal safe-area insets.
- Host-boundary tests cover draft/session component preservation, compact page offset after resize, and returning to chat when the secondary pane is unavailable. These tests do not simulate UIKit, WebView, keyboard, or gesture behavior.
- Infrastructure doctor passes all seven required checks, including anonymous rejection and authenticated empty catalog. App doctor passes package/native wiring checks. R2 listing succeeds with zero objects.
- rc22 console opens Bundles, Insights, and API keys against the new database without errors. Empty reports are expected before native launches and OTA delivery.
- `pnpm test`: 335 passed, 5 skipped. `pnpm test:release`: 11 Node tests and 6 mobile tests passed. Mobile Vitest: 27 passed. `pnpm typecheck` and `pnpm lint` passed.
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

The current candidate is **1.6.0 (55)**: build [d6e7486d-bebb-4b18-9bf8-78a64d4a81df](https://expo.dev/accounts/gronxb/projects/codex-relay/builds/d6e7486d-bebb-4b18-9bf8-78a64d4a81df), EAS upload `8c97ee6f-1d3d-4812-821d-3a5d5b089703`. Build and upload both report `FINISHED`; EAS confirms Apple accepted the upload for processing. App Store Connect now reports build 55 as `VALID`. This build was produced from the pre-merge working tree; a fresh build from the merged main commit will supersede it. The currently live version remains 1.5.0. App Review has not been submitted by this task; the user owns that step.

The IPA confirms version 1.6.0, build 55, iPhoneOS SDK 27.0, deployment target 16.4, SceneDelegate, production channel, an OTA public key matching the repository key, and the rc22 endpoint without the legacy endpoint. Its SHA-256 is `d5d46b8b36e9f5bb3761f1c1e78b4e0715147fd005220e6bc54c1d816542a8a9`. It includes the React Query fix, Duo pane and header changes, pairing-route handoff, first-tap keyboard navigation, and native WebView continuity fix. Simulator verification uses an SDK 27.1 native container; this does not replace a physical-device check of the SDK 27.0 store IPA.

Build 52 / upload `993c9dc2-a5b6-46bb-82fc-fc1659f57bdf` remains `VALID` in App Store Connect but predates the final Duo changes. Intermediate builds 53 and 54 were canceled after native QA found additional issues; neither was uploaded.

**Do not submit build 51 for App Review:** build `1cd9bc21-aeed-4152-ad22-caa57a6388e5` / upload `c57c0f46-beda-436c-87e5-a2d211381a49` contains the dependency graph that failed native startup. It remains visible in App Store Connect but is superseded by build 52.

## CI and local operations

GitHub secrets `MOBILE_ENV_RC22` and `HOT_UPDATER_ENV_RC22` have been provisioned separately. The old `MOBILE_ENV` and `HOT_UPDATER_ENV` secrets are unchanged. The existing `HOT_UPDATER_PRIVATE_KEY` is reused.

The existing sequential `ship.N` release convention is retained. The plain `1.6.0` native baseline does not trigger OTA. For a later `1.6.0-ship.N` release, the workflow reads `hot-updater app-version --json`, checks it against Expo config, and passes that exact iOS version to `deploy -t`. There is no additional approval variable or version convention.

Local app configuration reads `.env.hotupdater.rc22`; the CLI's `.env.hotupdater` also points at the new resources. Private legacy backups and logs are under the ignored `.codex/mobile-1.6/` directory. Never commit them.

From `apps/mobile`:

```sh
pnpm exec hot-updater app-version --json
pnpm exec hot-updater doctor --server-base-url https://codex-relay-ota-rc22.gron1gh1.workers.dev
pnpm exec hot-updater console
```

The console is local at `http://127.0.0.1:1422/`. The old remote Ship console continues managing rc14.

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

## Subsequent Duo and OTA battle-test gates

The host and native checks above cover part of the Duo cases below. OTA cases, SSH continuity, controlled transcript scroll anchoring, Duo rotation and active reserved-region occlusion remain pending. Keep the QA release disabled / rollout zero until a specific installation cohort is known. Discover the pinned CLI's live help before creating or changing any Bundle/Release; record their distinct IDs and the native minimum bundle ID.

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

Do not publish a QA OTA artifact before the native candidate's embedded minimum bundle ID is known. No OTA artifacts have been uploaded to the new bucket yet, so artifact write/download/signature and native rollback checks are unverified. Review these gates and release metadata before the user submits App Review.

## References

- [Expo SDK 58 beta](https://expo.dev/changelog/sdk-58-beta)
- [EAS build images](https://docs.expo.dev/build-reference/infrastructure/)
- [Preparing your app for iPhone Duo](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo)
- [Xcode 27.1 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_1-release-notes)
- [Xcode system requirements](https://developer.apple.com/xcode/system-requirements)
