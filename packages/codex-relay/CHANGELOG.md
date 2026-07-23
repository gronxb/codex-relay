# codex-relay

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
