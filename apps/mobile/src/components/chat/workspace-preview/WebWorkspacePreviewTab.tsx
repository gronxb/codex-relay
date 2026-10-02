import type { WebPreviewTarget } from "codex-relay/api-schema";
import { useSelector } from "@legendapp/state/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text as UiText } from "@/components/ui/text";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { getCodexRelayServerUrl, startWorkspaceTailscaleServe } from "@/lib/codex-relay-api";
import { hapticSelection } from "@/lib/haptics";
import {
  updateWorkspacePreviewWebState,
  workspacePreviewStore$,
  workspacePreviewKey,
} from "@/state/workspace-preview-store";

export const WebWorkspacePreviewTab = memo(function WebWorkspacePreviewTab({
  serverUrl,
  workspacePath,
  webPreviewTarget,
}: {
  serverUrl: string;
  workspacePath?: string;
  webPreviewTarget?: WebPreviewTarget;
}) {
  const baseServerUrl = serverUrl || getCodexRelayServerUrl();
  const insets = useSafeAreaInsets();
  const guessedPreviewUrl = useMemo(() => guessWebPreviewUrl(baseServerUrl), [baseServerUrl]);
  const defaultWebPreviewUrl = webPreviewTarget?.url ?? guessedPreviewUrl;
  const workspaceKey = workspacePreviewKey(workspacePath);
  const savedWebState = useSelector(() =>
    workspacePreviewStore$.webStateByWorkspacePath[workspaceKey].get(),
  );
  const initialWebUrl =
    savedWebState?.isUserControlled && savedWebState.url ? savedWebState.url : defaultWebPreviewUrl;
  const initialWebUrlDraft =
    savedWebState?.isUserControlled && savedWebState.draft ? savedWebState.draft : initialWebUrl;
  const webViewRef = useRef<WebView<object>>(null);
  const sourceUrlRef = useRef(initialWebUrl);
  const [webUrlDraft, setWebUrlDraft] = useState(initialWebUrlDraft);
  const [webUrl, setWebUrl] = useState(initialWebUrl);
  const [webError, setWebError] = useState<string | null>(null);
  const [webReloadKey, setWebReloadKey] = useState(0);
  const [tailscaleServeStatus, setTailscaleServeStatus] = useState<TailscaleServeStatus>({
    kind: "idle",
  });
  const [webNavigationState, setWebNavigationState] = useState<
    Pick<WebViewNavigation, "canGoBack" | "canGoForward" | "loading">
  >({
    canGoBack: false,
    canGoForward: false,
    loading: false,
  });
  const tailscaleServeCandidate = useMemo(
    () => tailscaleServeCandidateFromUrl(webUrlDraft, defaultWebPreviewUrl),
    [defaultWebPreviewUrl, webUrlDraft],
  );
  const shouldShowTailscaleServeAction = Boolean(tailscaleServeCandidate && webError);

  useEffect(() => {
    if (savedWebState?.isUserControlled) {
      return;
    }

    setWebUrlDraft(defaultWebPreviewUrl);
    setWebUrl(defaultWebPreviewUrl);
    sourceUrlRef.current = defaultWebPreviewUrl;
  }, [defaultWebPreviewUrl, savedWebState?.isUserControlled]);

  useEffect(() => {
    setWebError(null);
  }, [webReloadKey, webUrl]);

  function commitWebUrl() {
    const normalized = normalizePreviewUrl(webUrlDraft, defaultWebPreviewUrl);
    setTailscaleServeStatus({ kind: "idle" });
    setWebUrlDraft(normalized);
    setWebUrl(normalized);
    sourceUrlRef.current = normalized;
    updateWorkspacePreviewWebState(workspacePath, {
      draft: normalized,
      isUserControlled: true,
      url: normalized,
    });
  }

  function handleNavigationStateChange(navigationState: WebViewNavigation) {
    setWebNavigationState({
      canGoBack: navigationState.canGoBack,
      canGoForward: navigationState.canGoForward,
      loading: navigationState.loading,
    });

    if (!navigationState.url || navigationState.url === "about:blank") {
      return;
    }

    setWebUrlDraft(navigationState.url);
    updateWorkspacePreviewWebState(workspacePath, {
      draft: navigationState.url,
      isUserControlled:
        savedWebState?.isUserControlled || navigationState.url !== sourceUrlRef.current,
      url: navigationState.url,
    });
  }

  function navigateBack() {
    hapticSelection();
    webViewRef.current?.goBack();
  }

  function navigateForward() {
    hapticSelection();
    webViewRef.current?.goForward();
  }

  function reloadWebView() {
    hapticSelection();
    webViewRef.current?.reload();
  }

  async function handleStartTailscaleServe() {
    if (!tailscaleServeCandidate || tailscaleServeStatus.kind === "loading") {
      return;
    }

    hapticSelection();
    setTailscaleServeStatus({ kind: "loading" });
    try {
      const serve = await startWorkspaceTailscaleServe({ url: tailscaleServeCandidate.url });
      setTailscaleServeStatus({ kind: "idle" });
      setWebError(null);
      setWebUrlDraft(serve.url);
      setWebUrl(serve.url);
      sourceUrlRef.current = serve.url;
      updateWorkspacePreviewWebState(workspacePath, {
        draft: serve.url,
        isUserControlled: true,
        url: serve.url,
      });
    } catch (error) {
      setTailscaleServeStatus({
        kind: "error",
        message: errorMessage(error, "Could not start Tailscale Serve."),
      });
    }
  }

  return (
    <View
      style={[
        styles.contentPane,
        styles.webPane,
        { paddingBottom: Math.max(insets.bottom + Spacing.two, Spacing.two) },
      ]}
    >
      <View style={styles.urlBar}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={(value) => {
            setTailscaleServeStatus({ kind: "idle" });
            setWebUrlDraft(value);
            updateWorkspacePreviewWebState(workspacePath, {
              draft: value,
              isUserControlled: true,
            });
          }}
          onSubmitEditing={commitWebUrl}
          placeholder="http://localhost:3000"
          placeholderTextColor="#7A8493"
          returnKeyType="go"
          style={styles.urlInput}
          value={webUrlDraft}
        />
        <Button
          accessibilityRole="button"
          accessibilityLabel="Open web preview URL"
          onPress={commitWebUrl}
          size="lg"
          variant="secondary"
          className="rounded-md border border-border bg-secondary/80"
          style={({ pressed }) => [styles.goButton, pressed && styles.pressed]}
        >
          <UiText className="text-foreground" style={styles.goButtonText}>
            Go
          </UiText>
        </Button>
      </View>
      <View style={styles.webViewFrame}>
        <WebView<object>
          ref={webViewRef}
          key={`${webUrl}-${webReloadKey}`}
          allowsBackForwardNavigationGestures
          onError={(event) => {
            setWebError(event.nativeEvent.description || "Unable to load the web preview.");
          }}
          onHttpError={(event) => {
            setWebError(`HTTP ${event.nativeEvent.statusCode}`);
          }}
          onLoadStart={() => setWebError(null)}
          onNavigationStateChange={handleNavigationStateChange}
          pullToRefreshEnabled
          refreshControlLightMode={false}
          renderError={() => <View style={styles.webViewErrorBlank} />}
          source={{ uri: webUrl }}
          startInLoadingState
          style={styles.webView}
        />
        {webError ? (
          <View style={styles.webErrorOverlay}>
            <View style={styles.webErrorIcon}>
              <Icon name="web" size={18} tintColor={Colors.dark.textSecondary} />
            </View>
            <ThemedText type="smallBold" style={styles.webErrorTitle}>
              Unable to load preview
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.webErrorMessage}
              numberOfLines={3}
            >
              {webError}
            </ThemedText>
            {shouldShowTailscaleServeAction && tailscaleServeCandidate ? (
              <Button
                accessibilityRole="button"
                accessibilityLabel={`Run Tailscale Serve for port ${tailscaleServeCandidate.port}`}
                disabled={tailscaleServeStatus.kind === "loading"}
                onPress={handleStartTailscaleServe}
                size="lg"
                variant="secondary"
                className="rounded-md border border-border bg-secondary/80"
                style={({ pressed }) => [
                  styles.tailscaleRetryAction,
                  pressed && tailscaleServeStatus.kind !== "loading" && styles.pressed,
                ]}
              >
                <View style={styles.tailscaleRetryCommand}>
                  <ThemedText type="code" numberOfLines={1} style={styles.tailscaleCommandPrompt}>
                    &gt;
                  </ThemedText>
                  <ThemedText type="code" numberOfLines={1} style={styles.tailscaleCommandText}>
                    tailscale serve {tailscaleServeCandidate.port}
                  </ThemedText>
                </View>
                <View style={styles.tailscaleRetryRun}>
                  {tailscaleServeStatus.kind === "loading" ? (
                    <ActivityIndicator color={Colors.dark.text} size="small" />
                  ) : (
                    <Icon name="terminal" size={14} tintColor={Colors.dark.text} />
                  )}
                  <UiText className="text-foreground" style={styles.tailscaleServeButtonText}>
                    Run
                  </UiText>
                </View>
              </Button>
            ) : (
              <Button
                accessibilityRole="button"
                accessibilityLabel="Retry web preview"
                onPress={() => {
                  hapticSelection();
                  setWebReloadKey((current) => current + 1);
                }}
                size="lg"
                variant="secondary"
                className="rounded-md border border-border bg-secondary/80"
                style={({ pressed }) => [styles.webErrorRetry, pressed && styles.pressed]}
              >
                <Icon name="refresh" size={14} tintColor={Colors.dark.text} />
                <UiText
                  className="text-foreground"
                  numberOfLines={1}
                  style={styles.webErrorRetryText}
                >
                  Retry
                </UiText>
              </Button>
            )}
            {tailscaleServeStatus.kind === "error" ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.tailscaleServeError}
              >
                {tailscaleServeStatus.message}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.webControlsBar}>
        <WebControlButton
          accessibilityLabel="Go back in web preview"
          disabled={!webNavigationState.canGoBack}
          icon="back"
          onPress={navigateBack}
        />
        <WebControlButton
          accessibilityLabel="Go forward in web preview"
          disabled={!webNavigationState.canGoForward}
          icon="forward"
          onPress={navigateForward}
        />
        <WebControlButton
          accessibilityLabel="Reload web preview"
          disabled={webNavigationState.loading}
          icon="refresh"
          onPress={reloadWebView}
        />
        <View style={styles.webControlsStatus}>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {webNavigationState.loading ? "Loading" : webPreviewHostLabel(webUrlDraft)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
});

type TailscaleServeStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string };

type TailscaleServeCandidate = {
  readonly port: number;
  readonly url: string;
};

function WebControlButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: "back" | "forward" | "refresh";
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      size="icon"
      variant="secondary"
      className="rounded-md border border-border bg-secondary/80"
      style={({ pressed }) => [styles.webControlButton, pressed && !disabled && styles.pressed]}
    >
      <Icon
        name={icon}
        size={15}
        tintColor={disabled ? Colors.dark.textSecondary : Colors.dark.text}
      />
    </Button>
  );
}

function guessWebPreviewUrl(serverUrl: string) {
  try {
    const parsed = new URL(serverUrl);
    parsed.port = "3000";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return serverUrl.replace(/\/$/, "");
  }
}

function normalizePreviewUrl(value: string, fallbackUrl: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackUrl;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function webPreviewHostLabel(value: string) {
  try {
    return new URL(normalizePreviewUrl(value, value)).host || value;
  } catch {
    return value.trim() || "Preview";
  }
}

function tailscaleServeCandidateFromUrl(
  value: string,
  fallbackUrl: string,
): TailscaleServeCandidate | null {
  try {
    const parsedUrl = new URL(normalizePreviewUrl(value, fallbackUrl));
    if (parsedUrl.protocol !== "http:" || !parsedUrl.port) {
      return null;
    }

    const port = Number(parsedUrl.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    if (!isTailscaleHost(parsedUrl.hostname)) {
      return null;
    }

    return {
      port,
      url: parsedUrl.href,
    };
  } catch {
    return null;
  }
}

function isTailscaleHost(hostname: string) {
  const lowerHostname = hostname.toLowerCase();
  return lowerHostname.endsWith(".ts.net") || isTailscaleIpv4Host(lowerHostname);
}

function isTailscaleIpv4Host(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (!octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  contentPane: {
    flex: 1,
    marginHorizontal: Spacing.three,
  },
  webPane: {
    gap: Spacing.two,
  },
  urlBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  urlInput: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    color: Colors.dark.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
    minHeight: 40,
    paddingHorizontal: Spacing.three,
  },
  goButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    minWidth: 52,
    paddingHorizontal: Spacing.two,
  },
  goButtonText: {
    color: Colors.dark.text,
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    lineHeight: 18,
  },
  tailscaleRetryAction: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
    maxWidth: 360,
    overflow: "hidden",
    paddingHorizontal: 0,
    width: "100%",
  },
  tailscaleRetryCommand: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: Spacing.one,
    minWidth: 0,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  tailscaleCommandPrompt: {
    color: Colors.dark.textSecondary,
    fontFamily: Fonts.monoMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  tailscaleCommandText: {
    color: Colors.dark.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
  },
  tailscaleRetryRun: {
    alignItems: "center",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderLeftWidth: 1,
    flexDirection: "row",
    gap: Spacing.one,
    height: "100%",
    justifyContent: "center",
    minWidth: 82,
    paddingHorizontal: Spacing.two,
  },
  tailscaleServeButtonText: {
    color: Colors.dark.text,
    flexShrink: 1,
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
  },
  tailscaleServeError: {
    paddingHorizontal: Spacing.two,
  },
  webViewFrame: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    overflow: "hidden",
  },
  webControlsBar: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(132, 145, 165, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.one,
    minHeight: 44,
    padding: 3,
  },
  webControlButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  webControlsStatus: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.two,
  },
  webView: {
    backgroundColor: Colors.dark.backgroundElement,
    flex: 1,
  },
  webViewErrorBlank: {
    backgroundColor: Colors.dark.backgroundElement,
    flex: 1,
  },
  webErrorOverlay: {
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundElement,
    bottom: 0,
    gap: Spacing.two,
    justifyContent: "center",
    left: 0,
    padding: Spacing.four,
    position: "absolute",
    right: 0,
    top: 0,
  },
  webErrorIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(132, 145, 165, 0.24)",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  webErrorTitle: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
  },
  webErrorMessage: {
    maxWidth: 280,
    textAlign: "center",
  },
  webErrorRetry: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 104,
    paddingHorizontal: Spacing.three,
  },
  webErrorRetryText: {
    color: Colors.dark.text,
    flexShrink: 1,
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
});
