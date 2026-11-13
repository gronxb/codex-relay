import type { ConfigContext, ExpoConfig } from "expo/config";
import { config } from "dotenv";

config({ path: ".env.hotupdater.rc22", quiet: true });

const hotUpdaterApiKey =
  process.env.EXPO_PUBLIC_HOT_UPDATER_API_KEY?.trim() || process.env.HOT_UPDATER_API_KEY?.trim();

export default function appConfig(_context: ConfigContext): ExpoConfig {
  return {
    name: "Codex Relay",
    slug: "codex-relay",
    version: "1.7.0",
    orientation: "default",
    icon: "./assets/images/icon.png",
    scheme: "codex-relay",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/images/icon.png",
      bundleIdentifier: "com.gronstudio.codexrelay",
      // Hot Updater 1.2 sandbox QA: the team the TestFlight sandbox build signs with.
      appleTeamId: "Q3QT4ZF343",
      deploymentTarget: "16.4",
      supportsTablet: true,
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
        ITSAppUsesNonExemptEncryption: false,
        NSLocalNetworkUsageDescription:
          "Codex Relay uses the local network to connect this device to the Codex Relay server running on your computer.",
        "UISupportedInterfaceOrientations~ipad": [
          "UIInterfaceOrientationPortrait",
          "UIInterfaceOrientationPortraitUpsideDown",
          "UIInterfaceOrientationLandscapeLeft",
          "UIInterfaceOrientationLandscapeRight",
        ],
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#191919",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: "com.gronstudio.codexrelay",
      permissions: ["android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS"],
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-dev-client",
        {
          launchMode: "most-recent",
        },
      ],
      [
        "expo-splash-screen",
        {
          backgroundColor: "#191919",
          image: "./assets/images/splash-icon.png",
          imageWidth: 112,
          android: {
            image: "./assets/images/splash-icon.png",
            imageWidth: 112,
          },
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Codex Relay uses the camera to scan QR codes that contain your local relay server address, for example to connect this device to the Codex Relay server running on your computer.",
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: true,
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission:
            "Codex Relay uses photo library access so you can attach images to a Codex chat, for example to ask Codex to inspect a screenshot.",
          microphonePermission: false,
        },
      ],
      "expo-font",
      "expo-image",
      "expo-notifications",
      "expo-system-ui",
      "expo-web-browser",
      [
        "@hot-updater/expo",
        {
          // A pull request preview's native build embeds pr-<number>
          // (PREVIEW_CHANNEL, set by the preview workflow); every other build
          // embeds production.
          channel: process.env.PREVIEW_CHANNEL ?? "production",
          publicKeyPath: "./keys/public-key.pem",
        },
      ],
      [
        "expo-secure-store",
        {
          faceIDPermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      hotUpdaterApiKey,
      router: {},
      eas: {
        projectId: "6659e28f-2ac7-4055-8f56-7b4ca5e65847",
      },
    },
  };
}
