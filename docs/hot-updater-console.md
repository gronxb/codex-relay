# Hosted Hot Updater Console

Status: historical Cloudflare deployment. The former Console Worker has been removed.
The active Console is [codex-relay.gron-studio.com](https://codex-relay.gron-studio.com),
deployed with Ship. See [the rc.14 upgrade record](../deployments/hot-updater-rc14/README.md)
for the current server, schema migration and verification procedure.

The console template is infrastructure-neutral and deploys through Nitro.
Modex uses its optional Cloudflare example for dogfood because the existing
backend is on Cloudflare. Modex's hosted console is a separate Worker. It uses the existing OTA
D1 database and R2 bucket. It does not require Metro, the mobile source checkout,
or a running `hot-updater console` process after deployment.

| Setting             | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| Console URL         | `https://modex-hot-updater-console.gron1gh1.workers.dev` |
| Console Worker      | `modex-hot-updater-console`                              |
| Existing OTA Worker | `codex-relay-ota`                                        |
| D1 database         | `codex-relay`                                            |
| R2 bucket           | `codex-relay-storage`                                    |
| Console package     | `@hot-updater/console@1.0.0-rc.10`                       |
| Local console CLI   | `hot-updater@1.0.0-rc.12`                                |
| Cloudflare provider | `@hot-updater/cloudflare@1.0.0-rc.5`                     |
| Host source         | `https://github.com/hot-updater/console`                 |
| Configuration       | `deployments/hot-updater-console/wrangler.jsonc`         |

## Reproduce the deployment

Clone the host beside this repository:

```bash
cd /Users/gronxb/workspace
git clone https://github.com/hot-updater/console.git modex-hot-updater-console
cd modex-hot-updater-console
cp examples/cloudflare/hot-updater.config.ts.example hot-updater.config.ts
cp ../modex/deployments/hot-updater-console/wrangler.jsonc wrangler.jsonc
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler whoami
```

The dogfood checkout follows the merged template main branch at `7705833`
([template PR #8](https://github.com/hot-updater/console/pull/8)).

Configure the GitHub OAuth App **Modex Hot Updater Console** with homepage
`https://modex-hot-updater-console.gron1gh1.workers.dev` and callback
`https://modex-hot-updater-console.gron1gh1.workers.dev/api/auth/callback/github`.
Only verified addresses in the private allowlist may manage Modex. The login
requests `user:email`; it does not request repository access.

Store the following values in the checkout's ignored
`.secrets.production.json`, with file permissions `600`:

- `BETTER_AUTH_SECRET`: random session-encryption secret, at least 32 characters.
- `STORAGE_DOWNLOAD_URL_SIGNING_KEY`: separate random storage-URL signing secret.
- `HOT_UPDATER_CONSOLE_ALLOWED_EMAILS`: private exact-address allowlist.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: console OAuth credentials.

Do not copy `.env.hotupdater`, Cloudflare API tokens, R2 S3 credentials, or
`apps/mobile/keys/private-key.pem` into the host. The Worker receives native D1
and R2 bindings and does not build or sign mobile bundles.

```bash
pnpm test
pnpm cf:typegen
pnpm test:type
pnpm build:cloudflare
pnpm exec wrangler deploy --dry-run
pnpm test:cloudflare
pnpm exec wrangler deploy --secrets-file .secrets.production.json
```

Inspect the printed resource names. The console deployment must not replace
`codex-relay-ota`, create new storage resources, or apply database migrations.
Nitro generates `.output/server/wrangler.json`; Wrangler follows that generated
configuration automatically. Update the source configuration and rebuild for
later changes.

## Verification

The template's CI builds Node, Vercel, Netlify, and Cloudflare outputs. Its Node and Worker runtime
smoke check verifies sign-in rendering, anonymous sessions, and rejection of
protected reads, writes, and bundle downloads using local test resources.

Before recording the deployment as complete, verify on the actual HTTPS URL:

1. Anonymous users see only the sign-in page; direct download and server
   function requests are denied.
2. An approved GitHub account can view Bundles, Insights, Distribution detail,
   and events. Compare the same platform/channel/period with the local console.
3. A known bundle's artifact downloads through the authenticated console.
4. Nested routes survive reload and the mobile layout fits the viewport.
5. Signing out revokes access through the browser session.

Do not alter production bundle rollout settings just to test hosting.

### Dogfood record (2026-09-08)

Worker version: `d790b340-c659-4df5-9c94-c31e7414d64c`.

The record includes initial hosted QA and subsequent RC checks.

- Approved GitHub login works with the exact verified-email allowlist.
- Anonymous sign-in rendering, null session, and protected read/write/download
  rejection were verified on the actual HTTPS origin.
- Bundles shows three releases, including two active installations for the
  enabled production release. Insights shows three reporting installations;
  Distribution shows app version 1.5.0 with two known-bundle installations and
  one unknown-bundle installation, matching the local console.
- All events shows 20 rows on the first page and two on the next. Refreshing the
  cursor URL retains the older records.
- Authenticated bundle download: 9,376,048 bytes, 39 ZIP entries; CRC validation
  passed. SHA-256: `3e124836b0e3a6f82b4e602f702026bb351b284c71a19750cec57e51cfa1a38e`.
- The hosted sign-in page fits a 390px viewport. Dashboard cards were checked
  locally with real and dense synthetic data at 320px and 390px, without
  horizontal overflow.
- App usage and Distribution both measure 430px high on the hosted desktop
  dashboard; the local CLI console shows the same alignment and real data.
- Changing App usage to 7d shows WAU while Bundle activity retains its own
  24h selection.
- After the sign-out request fix, the final RC returns to the sign-in page,
  clears the browser session, and rejects a protected download with HTTP 401.
  Refreshing retains the signed-out state.
- The mobile app typecheck passes with CLI `1.0.0-rc.12`; the actual local
  `pnpm hot-updater console` was restarted and verified at port 1422.
- Console `1.0.0-rc.10` applies
  [mobile sidebar fix #1282](https://github.com/gronxb/hot-updater/pull/1282).
  The local WebKit console was checked at 320px and 390px: the Sheet renders,
  navigation closes it, and Close/Escape return focus to the menu trigger.
- The updated HTTPS console was checked with an authenticated browser at 320px
  and 390px. The menu fits without horizontal overflow, closes after navigation
  and via Close, and can reopen. Desktop App usage and Distribution remain
  430px high. Anonymous session and protected read/write/download checks pass
  on this Worker version.

The remote QA reads production data and downloads an existing artifact; it
makes no changes to rollout settings or existing database/storage resources.

## Update and recover

Review upstream template and package changes, retain this repository's Wrangler
configuration, and run the same build, dry-run, runtime check, and deploy steps.
Existing secrets are preserved when `--secrets-file` is omitted. Use
`pnpm exec wrangler secret put NAME` privately to rotate an individual secret.

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <previous-console-version-id>
pnpm exec wrangler tail
```

Worker rollback does not restore D1 data or R2 objects and does not undo a
bundle-management action. It affects the console Worker, not the OTA Worker.
