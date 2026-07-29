# codex-relay

## 1.4.5

### Patch Changes

- d579920: Suppress subagent action-required and completion push notifications using persistent thread ancestry.
- 3150a9d: Support renaming and rewinding Codex app-server chats from mobile.
- f810d3f: Reload the active chat from the Codex app-server when refreshing from mobile.

## 1.4.4

### Patch Changes

- dfa005a: fix: isolate subagent threads from clients

## 1.4.3

### Patch Changes

- ebb83b4: Prefer the shared Codex app-server on macOS, with automatic private-mode fallback when default shared startup fails. Keep Linux and Windows defaults unchanged, and preserve `--shared-app-server` as a required shared mode.
- 854d799: fix: clean up cancelled thread streams and stop repeated web preview probes
- 13a1c27: Upgrade the Codex SDK to 0.145.0, add an idempotent `stop` command for background relays, and recover shared app-server startup when a stale Unix socket is present.

## 1.4.2

### Patch Changes

- 1881c31: Wait longer for the shared Codex app-server to finish cold startup.

## 1.4.1

### Patch Changes

- 1df8e01: Start queued input when the active turn completes during queued-input submission.
- cfb2b8c: Avoid turn-complete push notifications for spawned subagent threads.

## 1.4.0

### Minor Changes

- 346bba0: Add shared app-server support for native Windows through a loopback WebSocket.
- 2bb9703: Add opt-in Expo push notifications for mobile turn-complete and action-required alerts.

### Patch Changes

- baa714c: Reconnect to a shared app-server socket after a local transport reset without deliberately stopping the shared server, with ownership diagnostics and terminal recovery guidance.
