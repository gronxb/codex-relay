# Pinned Chats Design

## Goal

Let mobile users keep important chats immediately accessible in a dedicated `Pinned` section at the top of the conversation drawer.

## Scope

- Pin and unpin a chat from the existing long-press `Chat actions` sheet.
- Show currently available pinned chats once in a `Pinned` section above workspace groups.
- Persist pin state locally on the phone across app and Relay restarts.
- Remove a pin after its chat is archived successfully.
- Keep search behavior focused on matching chats instead of showing a separate pinned section.

Server APIs, shared thread schemas, cross-device synchronization, drag reordering, and desktop changes are out of scope.

## User Experience

Long-pressing any chat opens `Chat actions`, even when server-side rename is unavailable. The sheet shows `Pin chat` for an unpinned chat or `Unpin chat` for a pinned chat, followed by `Rename chat` when rename is supported.

Pinned chats appear in most-recently-pinned order under a `Pinned` header at the top of the drawer. They are removed from their normal workspace groups to avoid duplicates. Workspace headers remain visible even when every chat in that workspace is pinned. During search, all matching chats appear in their normal workspace groups and the separate `Pinned` section is hidden.

Pinning and unpinning update the drawer immediately and close the action sheet. Archiving removes the pin only after the archive request succeeds.

## Architecture

Add a small client-state module backed by the existing `persistLocalObservable` MMKV adapter. It stores one ordered array of thread IDs for the device. Thread IDs are treated as globally unique, so pins continue to work if the same Relay is reached through a different URL.

Extract drawer row construction from `ThreadDrawerContent.tsx` into a pure helper module. The helper receives threads, expanded projects, the active thread, search state, and pinned IDs. It returns a discriminated row list containing the pinned header, thread rows, workspace headers, and `Show more` rows.

`ThreadDrawerContent` subscribes to the persisted pin store, passes pin state into the row builder, exposes pin actions in the existing bottom sheet, and unpins after a successful archive. The shared icon map gains a `pin` icon for the action and section header.

## Data Flow

1. The drawer reads thread data from the existing TanStack Query source.
2. It reads ordered pinned IDs from the local observable store.
3. The pure row builder resolves available pinned IDs to current thread objects, emits the pinned section, then emits workspace sections without those threads.
4. Pin and unpin actions update the observable store, which persists the new array through MMKV and rerenders the drawer.
5. Missing thread IDs are retained in storage but omitted from the UI, allowing temporarily unavailable chats to reappear later.

## Error Handling

The existing persistence adapter falls back to default state if stored JSON cannot be read. Pin operations are local and synchronous, so they do not depend on network availability. A failed archive keeps the pin because unpinning occurs only after the archive mutation succeeds.

## Testing

- Store tests cover pin order, idempotent pinning, unpinning, and reset isolation.
- Pure row-builder tests cover the pinned section, no duplicates, workspace-header preservation, unavailable pinned IDs, collapsed groups, and search behavior.
- Run the repository test suite, typecheck, lint, and formatting checks.
- Manually verify long-press actions, immediate drawer updates, archive behavior, and persistence after an app restart. Record any unavailable simulator or device validation in the PR.

## Contribution Requirements

Use English for maintainer-facing artifacts, Conventional Commits, and link the eventual PR to issue #58. This mobile-only change does not modify the published `codex-relay` package, so it does not require a package changeset.
