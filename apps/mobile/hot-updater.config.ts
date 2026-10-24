import { d1Database, r2Storage } from "@hot-updater/cloudflare";
import { expo } from "@hot-updater/expo";
import { config } from "dotenv";
import { defineConfig, vaultEnv } from "hot-updater";
import { remoteSigning } from "hot-updater/signing";
import { apiKeys, insights, remoteConfig, vault } from "hot-updater/plugins";

// v1.2 QA: HU_QA_VAULT_ONLY=1 reads no local credentials file. The CLI then sets the
// vault's deploy-credentials before this file loads, and the R2 keys come from a generic
// secret through vaultEnv, with only HOT_UPDATER_CONSOLE_URL and HOT_UPDATER_VAULT_TOKEN set.
const vaultOnly = process.env.HU_QA_VAULT_ONLY === "1";
if (!vaultOnly) {
  config({ path: ".env.hotupdater.rc22", quiet: true });
}
const qaR2 = vaultEnv(["QA_R2_ACCESS_KEY_ID", "QA_R2_SECRET_ACCESS_KEY"]);

if (process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID === "1a140b73-204a-4bcb-8492-f4760c40a834") {
  throw new Error("The rc14 database is reserved for app 1.5.0. Configure the rc22 database.");
}

export default defineConfig({
  // vault() runs in the Console and the CLI only, never in the managed Worker.
  plugins: [apiKeys(), insights(), remoteConfig(), vault()],
  build: expo(),
  storage: r2Storage({
    bucketName: process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME!,
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
    credentials: vaultOnly
      ? async () => {
          const env = await qaR2();
          return {
            accessKeyId: env.QA_R2_ACCESS_KEY_ID!,
            secretAccessKey: env.QA_R2_SECRET_ACCESS_KEY!,
          };
        }
      : {
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
  // v1.2 QA: HU_QA_SIGNING=vault signs through the Console's vault, for the
  // new-native build that embeds the vault key; unset, the local key signs.
  signing:
    process.env.HU_QA_SIGNING === "vault"
      ? remoteSigning({ endpoint: process.env.HOT_UPDATER_CONSOLE_URL! })
      : { enabled: true, privateKeyPath: "./keys/private-key.pem" },
  console: { channelLinkPrefix: "codex-relay://" },
  nativeBuild: {
    ios: {
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
