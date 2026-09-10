import { d1Database } from "@hot-updater/cloudflare";
import { config } from "dotenv";

config({ path: ".env.hotupdater" });

export const database = d1Database({
  databaseId: process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID!,
  accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
  cloudflareApiToken: process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN!,
});
