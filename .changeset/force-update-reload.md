---
"@codex-relay/mobile": patch
---

Reload right after downloading a force update, at launch and in Settings, instead of waiting for the next launch or Restart. The OTA carries Hot Updater rc46's JavaScript, which runs on every installed 1.6.x binary (it drops only code no v1 native module needed), so it is widened to app versions 1.6.x after its deploy: the App Store 1.6.0 binary and TestFlight 1.6.1 receive it along with native 1.6.2.
