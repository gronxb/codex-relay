---
"@codex-relay/mobile": patch
---

Move the foldable chat/preview layout onto `react-native-arrangement-view` (overlay panes: a half-open hinge splits chat and workspace preview, flat devices keep the pager and the resizable iPad split) and rebuild Settings as a SwiftUI Form through Expo UI on iOS, with a `ContentUnavailableView` empty state for the hidden preview half. This adds a native module and needs native 1.6.3, built on the Xcode 27.1 EAS image; never widen this OTA to 1.6.x.
