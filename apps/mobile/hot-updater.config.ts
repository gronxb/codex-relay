import { d1Database, r2Storage } from "@hot-updater/cloudflare";
import { expo } from "@hot-updater/expo";
import { config } from "dotenv";
import { defineConfig, infisical, secret } from "hot-updater";
import { apiKeys, insights, remoteConfig } from "hot-updater/plugins";

// Deploy credentials live in Infisical (secrets below). A local INFISICAL_* sign-in or a
// value override can sit in .env.hotupdater.rc22 (gitignored); CI signs in with the
// read-only Viewer identity from gronxb/codex-relay's GitHub Actions secrets.
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
  updateStrategy: "appVersion", // or "fingerprint"
  // v1.2 QA: the team store (Infisical Cloud, env prod, path /); sign-in comes from
  // INFISICAL_UNIVERSAL_AUTH_* in the environment or .env.hotupdater.
  // OTA bundles are signed with the production key stored as bundle-signing-key.
  secrets: infisical({ projectId: "33b972fc-d37a-457a-8a36-cdb6149b94cf" }),
  signing: secret("bundle-signing-key"),
  nativeBuild: {
    android: {
      // The Play internal testing build: a release .aab on the production channel,
      // signed with the upload keystore stored in Infisical as release-keystore.
      release: {
        packageName: "com.gronstudio.codexrelay",
        signing: { keystore: secret("release-keystore") },
      },
    },
    ios: {
      // The TestFlight build: a device archive on the production channel, signed
      // with automatic signing through the App Store Connect API key the Apple sign-in
      // issued, stored in Infisical as asc-api-key (team Q3QT4ZF343 from app.config.ts's
      // appleTeamId), exported for App Store Connect.
      release: {
        bundleIdentifier: "com.gronstudio.codexrelay",
        scheme: "CodexRelay",
        installPods: true,
        signing: { ascApiKey: secret("asc-api-key") },
      },
      simulator: {
        bundleIdentifier: "com.gronstudio.codexrelay",
        scheme: "CodexRelay",
        installPods: true,
        simulator: true,
      },
    },
  },
  patch: {
    enabled: true,
    maxBaseBundles: 2,
  },
});
