# Enriched Markdown IME placeholder fix

`react-native-enriched-markdown@1.0.2.patch` updates placeholder visibility in
`EnrichedMarkdownTextInput` while an IME composition is active. The original
`handleTextChanged` returns before updating the placeholder, leaving it visible
under marked text when composition starts in an empty editor.

The patch keeps formatting and change events deferred until composition ends.
pnpm applies it automatically through `patchedDependencies` in
`pnpm-workspace.yaml`. Re-evaluate the patch when upgrading the dependency.

## Native validation

This changes native code. Install dependencies with `pnpm install --frozen-lockfile`
and rebuild the iOS development client on macOS with `pnpm dev:mobile:ios`.
A JavaScript-only update does not apply this fix to an existing binary.

On an iPhone or simulator with a Chinese Pinyin keyboard:

1. Start with an empty composer and type Pinyin without selecting a candidate.
   The placeholder must disappear as soon as marked text appears.
2. Select a Chinese candidate, continue typing, and send the message. Confirm the
   committed text and cursor behave normally.
3. Delete all composing text, cancel composition, and clear committed text.
   The placeholder must return whenever the editor is empty.
4. Check English input, multiline input, and selecting/removing `$skills` and
   `@files` mentions for regressions.

Repeat the placeholder checks in Plan mode. Native build and device checks have
not been run in the Linux workspace where this patch was prepared.
