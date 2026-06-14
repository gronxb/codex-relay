import type { ConfigContext, ExpoConfig } from "expo/config";

export default function appConfig(_context: ConfigContext): ExpoConfig {
  return {
    name: "Codex Relay",
    slug: "codex-relay",
    version: "1.2.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "codex-relay",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/images/icon.png",
      bundleIdentifier: "com.gronstudio.codexrelay",
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
      permissions: ["android.permission.CAMERA"],
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
      "expo-system-ui",
      "expo-web-browser",
      "@hot-updater/react-native",
      "react-native-enriched-markdown",
      [
        "expo-secure-store",
        {
          faceIDPermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
          },
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
      router: {},
      eas: {
        projectId: "6659e28f-2ac7-4055-8f56-7b4ca5e65847",
      },
    },
  };
}
