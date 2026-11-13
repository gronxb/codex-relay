import { d1Database, r2Storage } from "@hot-updater/cloudflare";
import { expo } from "@hot-updater/expo";
import { config } from "dotenv";
import { defineConfig, infisical, secret } from "hot-updater";
import { apiKeys, insights, remoteConfig } from "hot-updater/plugins";

// Hot Updater 1.2 sandbox QA. Deploy credentials live in Infisical (secrets below).
// A local INFISICAL_* sign-in can sit in .env.hotupdater (gitignored); CI signs in
// with GitHub OIDC as a read-only (Viewer) machine identity.
config({ path: ".env.hotupdater.rc22", quiet: true });

if (process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID === "1a140b73-204a-4bcb-8492-f4760c40a834") {
  throw new Error("The rc14 database is reserved for app 1.5.0. Configure the rc22 database.");
}

export default defineConfig({
  plugins: [apiKeys(), insights(), remoteConfig()],
  build: expo(),
  storage: r2Storage({
    bucketName: "codex-relay-rc22-storage",
    accountId: "e8488f1eee751a6aa2d4831c5de1c3dc",
    credentials: {
      accessKeyId: secret("HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: secret("HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
  }),
  database: d1Database({
    databaseId: "c506b378-f360-4787-8888-1c6183d58a2b",
    accountId: "e8488f1eee751a6aa2d4831c5de1c3dc",
    cloudflareApiToken: secret("HOT_UPDATER_CLOUDFLARE_API_TOKEN"),
  }),
  // A sandbox preview link names a fingerprint, so the sandbox QA runs on the
  // fingerprint strategy. Production builds from main keep appVersion.
  updateStrategy: "fingerprint",
  // The team store (Infisical Cloud, env prod, path /). OTA bundles are signed
  // with the production key stored as bundle-signing-key.
  secrets: infisical({ projectId: "33b972fc-d37a-457a-8a36-cdb6149b94cf" }),
  signing: secret("bundle-signing-key"),
  nativeBuild: {
    android: {
      // Direct .apk, application ID com.gronstudio.codexrelay.sandbox, on the
      // channel it was built for (pr-<number> in a preview). Installs beside
      // the Play app.
      apk: {
        packageName: "com.gronstudio.codexrelay",
        aab: false,
        signing: { keystore: secret("release-keystore") },
        sandbox: true,
      },
      // The same sandbox app as an .aab for Google Play internal testing
      // (com.gronstudio.codexrelay.sandbox).
      play: {
        packageName: "com.gronstudio.codexrelay",
        signing: { keystore: secret("release-keystore") },
        sandbox: true,
      },
    },
    ios: {
      // TestFlight internal testing only, same bundle ID as the store app.
      // Signed with automatic signing through the App Store Connect API key
      // stored as asc-api-key (team Q3QT4ZF343).
      testflight: {
        bundleIdentifier: "com.gronstudio.codexrelay",
        scheme: "CodexRelay",
        installPods: true,
        signing: { ascApiKey: secret("asc-api-key") },
        sandbox: true,
      },
      // The same sandbox app exported for registered iPhones (ad hoc), to install
      // from the Console's build page.
      adhoc: {
        bundleIdentifier: "com.gronstudio.codexrelay",
        scheme: "CodexRelay",
        installPods: true,
        exportOptionsPlist: "./ExportOptions.adhoc.plist",
        signing: { ascApiKey: secret("asc-api-key") },
        sandbox: true,
      },
    },
  },
  patch: {
    enabled: true,
    maxBaseBundles: 2,
  },
});
