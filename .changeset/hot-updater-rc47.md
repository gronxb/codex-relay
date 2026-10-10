---
"@codex-relay/mobile": patch
---

Carry Hot Updater rc47's JavaScript: the SDK calls its native module directly, requires `rollbackReleases` in every Release catalog, and drops the `EMBEDDED` Release kind. It runs on every installed 1.6.x binary, since the oldest, 1.6.0, carries the RC23 native module with every method the SDK calls, so it is widened to app versions 1.6.x after its deploy.
