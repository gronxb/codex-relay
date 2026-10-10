---
"@codex-relay/mobile": patch
---

Upgrade Hot Updater to rc44. The SDK downloads updates from the presigned R2 URLs the RC44 server returns and accepts only absolute download URLs. Its JavaScript is otherwise the same as rc41's apart from its version, so this OTA needs no new native code and is widened to app versions 1.6.x after its deploy, like `1.6.1-ship.3`: the App Store 1.6.0 binary receives it along with TestFlight 1.6.1.
