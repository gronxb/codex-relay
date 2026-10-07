---
"@codex-relay/mobile": patch
---

Upgrade Hot Updater to rc37, whose Insights reports name the native build's built-in bundle, so the hosted console can show installations still on it. The JavaScript changes since 1.6.0-ship.2 need no new native code, so this OTA is widened to app versions 1.6.x after its deploy: the App Store 1.6.0 binary receives it along with TestFlight 1.6.1.
