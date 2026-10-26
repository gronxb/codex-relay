import { d1Database, r2Storage } from "@hot-updater/cloudflare";
import { expo } from "@hot-updater/expo";
import { config } from "dotenv";
import { defineConfig, localSecrets } from "hot-updater";
import { apiKeys, insights, remoteConfig } from "hot-updater/plugins";

// Deploy credentials: this machine keeps them in .env.hotupdater.rc22 (gitignored);
// CI gets the same variables from gronxb/codex-relay's GitHub Actions secrets.
config({ path: ".env.hotupdater.rc22", quiet: true });

if (process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID === "1a140b73-204a-4bcb-8492-f4760c40a834") {
  throw new Error("The rc14 database is reserved for app 1.5.0. Configure the rc22 database.");
}

export default defineConfig({
  plugins: [apiKeys(), insights(), remoteConfig()],
  build: expo(),
  storage: r2Storage({
    bucketName: process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME!,
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
    credentials: {
      accessKeyId: process.env.HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    },
  }),
  database: d1Database({
    databaseId: process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID!,
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
    cloudflareApiToken: process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN!,
  }),
  updateStrategy: "appVersion", // or "fingerprint"
  secrets: localSecrets(),
  signing: { enabled: true, privateKeyPath: "./keys/private-key.pem" },
  console: { channelLinkPrefix: "codex-relay://" },
  nativeBuild: {
    android: {
      // The Play internal testing build: a release .aab on the production channel,
      // signed with the upload keystore localSecrets() reads (EAS's keystore as
      // android-keystore). OTA bundle signing stays the production key in keys/.
      release: {
        packageName: "com.gronstudio.codexrelay",
        signing: { keystore: "secret:android-keystore" },
      },
    },
    ios: {
      // The TestFlight build: a device archive on the production channel, signed
      // with automatic signing through the App Store Connect API key the Apple sign-in
      // issues (localSecrets() locally, the HOT_UPDATER_ASC_API_KEY GitHub secret in CI)
      // (team Q3QT4ZF343 from app.config.ts's appleTeamId), exported for App Store
      // Connect. OTA bundle signing stays the production key in keys/.
      release: {
        bundleIdentifier: "com.gronstudio.codexrelay",
        scheme: "CodexRelay",
        installPods: true,
        signing: { ascApiKey: "secret:asc-api-key" },
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
