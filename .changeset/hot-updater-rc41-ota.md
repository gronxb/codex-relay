---
"@codex-relay/mobile": patch
---

Upgrade Hot Updater to rc41 and add Remote Config. The app reads Hot Updater from the instance `HotUpdater.init` returns, fetches and activates Remote Config at launch, and shows the active values in the hidden Hot Updater panel (tap the version five times), with a forced fetch. The SDK's native code is the same as rc36's and the App Store 1.6.0 binary has the storage Remote Config uses, so this OTA needs no new native code and is widened to app versions 1.6.x after its deploy.
