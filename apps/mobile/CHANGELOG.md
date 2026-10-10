# @codex-relay/mobile

## 1.6.2-ship.2

### Patch Changes

- ab4a7f0: Carry Hot Updater rc47's JavaScript: the SDK calls its native module directly, requires `rollbackReleases` in every Release catalog, and drops the `EMBEDDED` Release kind. It runs on every installed 1.6.x binary, since the oldest, 1.6.0, carries the RC23 native module with every method the SDK calls, so it is widened to app versions 1.6.x after its deploy.

## 1.6.2-ship.1

### Patch Changes

- 7f9456f: Reload right after downloading a force update, at launch and in Settings, instead of waiting for the next launch or Restart. The OTA carries Hot Updater rc46's JavaScript, which runs on every installed 1.6.x binary (it drops only code no v1 native module needed), so it is widened to app versions 1.6.x after its deploy: the App Store 1.6.0 binary and TestFlight 1.6.1 receive it along with native 1.6.2.

## 1.6.1-ship.4

### Patch Changes

- ac46f2e: Upgrade Hot Updater to rc44. The SDK downloads updates from the presigned R2 URLs the RC44 server returns and accepts only absolute download URLs. Its JavaScript is otherwise the same as rc41's apart from its version, so this OTA needs no new native code and is widened to app versions 1.6.x after its deploy, like `1.6.1-ship.3`: the App Store 1.6.0 binary receives it along with TestFlight 1.6.1.

## 1.6.1-ship.3

### Patch Changes

- f3463a3: Upgrade Hot Updater to rc41 and add Remote Config. The app reads Hot Updater from the instance `HotUpdater.init` returns, fetches and activates Remote Config at launch, and shows the active values in the hidden Hot Updater panel (tap the version five times), with a forced fetch. The SDK's native code is the same as rc36's and the App Store 1.6.0 binary has the storage Remote Config uses, so this OTA needs no new native code and is widened to app versions 1.6.x after its deploy.

## 1.6.1-ship.2

### Patch Changes

- ceea099: Upgrade Hot Updater to rc39. The SDK's JavaScript is the same as rc37's apart from its version, so this OTA needs no new native code and is widened to app versions 1.6.x after its deploy, like `1.6.1-ship.1`: the App Store 1.6.0 binary receives it along with TestFlight 1.6.1.

## 1.6.1-ship.1

### Patch Changes

- 30a7869: Upgrade Hot Updater to rc37, whose Insights reports name the native build's built-in bundle, so the hosted console can show installations still on it. The JavaScript changes since 1.6.0-ship.2 need no new native code, so this OTA is widened to app versions 1.6.x after its deploy: the App Store 1.6.0 binary receives it along with TestFlight 1.6.1.

## 1.6.0-ship.2

### Patch Changes

- bd9736f: Upgrade Hot Updater to rc32 so update failures report their original errors, and update checks cut off by the SDK's timeout under Expo's fetch are no longer reported as unknown failures.

## 1.6.0-ship.1

### Patch Changes

- ced5bdc: Upgrade Hot Updater to rc29 to include original update errors and HTTP response details in existing Insights reports without increasing reporting frequency.
- edb613f: Add a dedicated SSH screen under New Chat in the sidebar whose terminal session stays open while the app is running.

## 1.5.0-ship.2

### Patch Changes

- 18a5ac9: Add GPT-6.1 Sol to the fallback and mobile preview model catalogs with Low through Ultra reasoning and Fast mode, preserving Astra as the app default and existing GPT-6 Sol selections. Update the bundled Codex SDK and CLI to 0.159.2.

## 1.5.0-ship.1

### Patch Changes

- 290d078: Default to GPT-6 Astra when available while preserving explicit model selections. Warn when the connected codex-relay package is older than 1.5.0. This mobile OTA requires the Expo 57 App Store 1.5.0 binary and targets app version 1.5.0 through the existing release workflow.
- b900232: Show the originating thread title in push notifications and optionally include the lowest remaining Codex usage percentage in turn-complete alerts.
- 2cbe4ab: Release codex-relay 1.6.0 with Codex SDK and bundled CLI 0.156.1, which adds GPT-6 Sol and GPT-6 Luna next to GPT-6 Astra. Codex 0.156 removed `thread/rollback`, so rewinding a chat saved in the legacy history format now explains that it can no longer be rewound instead of returning the raw app-server error. Load chat history whose images are referenced by uploaded file ID, and fall back to the GPT-6 lineup when the host model catalog is unavailable. Warn in the mobile app when the connected relay is older than 1.6.0 and show each model's Fast tier description from the Codex catalog. Deliver the mobile changes through the existing OTA release workflow for the current App Store 1.5.0 binary.

## 1.4.0-ship.12

### Patch Changes

- 81c3934: Approve pairing directly in the interactive relay terminal by confirming the code and typing y followed by Enter. Keep the approval command for background relays, and explain both options on the phone.

  Make the pairing route own deep links, show connection progress immediately, probe candidate addresses concurrently, and preserve timeout details in network errors.

## 1.4.0-ship.11

### Patch Changes

- c5bfb32: Release codex-relay 1.5.0 with Codex SDK and bundled CLI 0.153.4. Warn in the mobile app when the connected relay is older than 1.5.0. Deliver the compatibility warning through the existing OTA release workflow for the current App Store binary.

## 1.4.0-ship.10

### Patch Changes

- 72af772: Deliver iOS LAN stream callbacks progressively on the main queue, and preserve trailing Markdown whitespace and code-block newlines while assistant messages stream.

## 1.4.0-ship.9

### Patch Changes

- c005033: Render assistant text deltas immediately instead of revealing the full response after completion.

## 1.4.0-ship.8

### Patch Changes

- bdc4b5a: Restore fast thread history loading and keep relay version mismatches as sidebar warnings.

## 1.4.0-ship.7

### Patch Changes

- f764166: Keep relay and mobile thread history consistent with Codex 0.149 app-server and SDK behavior, and require the compatible relay release from the app.
- 0d69564: Add a scroll-to-latest button above the composer

## 1.4.0-ship.6

### Patch Changes

- 61f3833: Make the relay setup and phone approval commands selectable and copyable.

## 1.4.0-ship.5

### Patch Changes

- ea78eff: Persist pinned chats locally so they remain available across app restarts.

## 1.4.0-ship.4

### Patch Changes

- 1a640ee: fix: dismiss connecting banner after status check
- afcf5bd: Keep paired mobile sessions connected until they are explicitly signed out or cleared.

## 1.4.0-ship.3

### Patch Changes

- 358aefc: Require codex-relay 1.4.5 or newer in the in-app relay update notice.

## 1.4.0-ship.2

### Patch Changes

- 3150a9d: Support renaming and rewinding Codex app-server chats from mobile.
- f810d3f: Reload the active chat from the Codex app-server when refreshing from mobile.

## 1.4.0-ship.1

### Patch Changes

- c923a9a: Replace the duplicate chat-header new-chat action with a refresh action. New chats remain available from the workspace sidebar.
- a957dec: fix: improve mobile project labels
