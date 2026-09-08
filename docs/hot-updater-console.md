# Hosted Hot Updater Console

Status: deployment configuration and runtime checks are ready; GitHub OAuth Client Secret setup and authenticated remote QA are pending.

The console template is infrastructure-neutral and deploys through Nitro.
Modex uses its optional Cloudflare example for dogfood because the existing
backend is on Cloudflare. Modex's hosted console is a separate Worker. It uses the existing OTA
D1 database and R2 bucket. It does not require Metro, the mobile source checkout,
or a running `hot-updater console` process after deployment.

| Setting             | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| Intended URL        | `https://modex-hot-updater-console.gron1gh1.workers.dev` |
| Console Worker      | `modex-hot-updater-console`                              |
| Existing OTA Worker | `codex-relay-ota`                                        |
| D1 database         | `codex-relay`                                            |
| R2 bucket           | `codex-relay-storage`                                    |
| Console package     | `@hot-updater/console@1.0.0-rc.7`                        |
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

The dogfood checkout follows the merged template main branch at `40acd9a`
([template PR #4](https://github.com/hot-updater/console/pull/4)).

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

Deployment version and remote QA evidence will be added after OAuth setup and
remote verification are complete.

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
