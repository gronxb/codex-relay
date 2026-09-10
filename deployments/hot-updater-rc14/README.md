# Modex Hot Updater rc.14 upgrade

This scaffold was generated with the mobile app's local `hot-updater@1.0.0-rc.14`
using `agent infra upgrade --provider cloudflare --build expo`. The controlling
workspace uses pnpm 11.2.2; run Hot Updater commands from `apps/mobile`.

The production target is generation 1:

- Worker: `codex-relay-ota`, https://codex-relay-ota.gron1gh1.workers.dev
- Cloudflare account: `e8488f1eee751a6aa2d4831c5de1c3dc`
- D1: `codex-relay`, `1a140b73-204a-4bcb-8492-f4760c40a834`
- R2: `codex-relay-storage`
- Active Console: https://codex-relay.gron-studio.com, Ship service `codex-relay`
- Console source: `/Users/gronxb/workspace/modex-hot-updater-console-ship`

The former `modex-hot-updater-console` Cloudflare Worker no longer exists; its
old deployment documentation is historical. Do not recreate it during upgrades.

## Completed production deployment

The rc.14 OTA Worker, both D1 migration phases and Ship Console are deployed.
The Console image is `ship/codex-relay:20260910124600`, built from companion
checkout commit `08fafb2283058e24264326eb86044bc67894d0c1`.

The signed iOS OTA targets app version `1.5.0`, channel `production`, with 100%
rollout and no forced restart:

- Source commit: `3a562d351d583f400afdc7d49d0767407ef41222`
- Release ID: `01a08b62-c3eb-7e13-8507-c9ef394d0458`
- Artifact Bundle ID: `01a08b61-67d6-78cd-aacf-af17471fd8a5`

The CLI deployment ID and the app's displayed short ID refer to the Release.
Artifact download and signature verification passed. An existing iOS 1.5.0
simulator binary applied the OTA after restart and displayed `current`; production
Insights recorded `UPDATE_APPLIED` with SDK `1.0.0-rc.14` for the new Bundle.
Detailed verified observations are in `deployment.json`.

## Migration and future releases

rc.14 changed the generation 1 initializer without providing an incremental RC
migration. `worker/migrations/0001_hot-updater_1.0.0.sql` therefore retains the
previously applied rc.5 provider SQL. `reference/rc14-schema.sql` is the unmodified
rc.14 target schema from the scaffold.

The Modex migrations are separate from upstream migration names:

1. `0002_modex_rc14_insights.sql` preserves all events, moves legacy metadata into
   JSON, and reconstructs `bundle_event_heads` using `(received_at_ms, id)` order.
   A temporary trigger supports both old and new writers during the transition.
2. Deploy the rc.14 OTA Worker and active Ship Console. Preserve resource IDs,
   endpoints, client API keys, signing keys, OAuth configuration and exposure.
3. `0003_modex_rc14_finalize.sql` removes the temporary trigger, legacy event
   columns and derived `bundle_installations` table. All original event metadata
   remains in JSON. The resulting tables, columns, defaults, foreign keys and
   indexes match the official rc.14 schema.

These steps are already applied in production; see `deployment.json`. Do not
replay them. On an unupgraded database, stage only migration 0002 first; applying
both migrations before upgrading every writer would break the old runtime.

For a future official 1.0.1 release, generate a fresh version-matched scaffold,
review its complete upgrade path, and inspect live `d1_migrations` and schema.
Import the official incremental SQL under its original filename, preserving all
existing migration rows. Even an upstream `0002_hot-updater_1.0.1.sql` has a
different identity from `0002_modex_rc14_insights.sql`; Wrangler tracks the full
filename. Do not rename a previously applied file or rewrite its history.
`schema.core` intentionally remains `1.0.0`; let the official migration advance
it. Test the supplied migration against a fresh private production export first.
No compatibility triggers or extra application tables remain to interfere with it.

## Verification

From the repository root:

```sh
node --test deployments/hot-updater-rc14/verify-migration.test.mjs
pnpm test
pnpm typecheck
pnpm lint
```

The migration tests exercise old/new writes, out-of-order events, timestamp ties,
download-versus-activation semantics, metadata preservation and exact structural
equivalence to the official schema. Both phases were also rehearsed with a private
D1 export through local Wrangler before the production migrations.

From `apps/mobile`:

```sh
node ../../deployments/hot-updater-rc14/app/verify-server.mjs \
  --base-url https://codex-relay-ota.gron1gh1.workers.dev \
  --platform ios --channel production --app-version 1.5.0
pnpm exec hot-updater doctor \
  --server-base-url https://codex-relay-ota.gron1gh1.workers.dev --json
pnpm exec hot-updater db catalog preflight --json
```

Private exports, Time Travel bookmarks and detailed verification artifacts are
under the ignored `.codex/hot-updater-rc14/`. Never commit them. Worker rollback
does not undo D1 schema changes; after finalization, do not deploy an rc.3 server
or an older Console against this database.

## Runtime artifacts and app integration

The generated `worker/dist` runtime is ignored build output. In a fresh checkout,
restore it from the same CLI version before deploying. From `apps/mobile`:

```sh
pnpm exec hot-updater agent infra upgrade --provider cloudflare --build expo \
  --output ../../.codex/hot-updater-rc14/runtime-source --json
cp -R ../../.codex/hot-updater-rc14/runtime-source/worker/dist \
  ../../deployments/hot-updater-rc14/worker/
pnpm exec wrangler deploy \
  --config ../../deployments/hot-updater-rc14/worker/wrangler.json --dry-run
```

Use a fresh scaffold for future versions instead of copying newer runtime assets
into this rc.14 record. Preserve the existing Worker download-signing secret.

The SDK's rc.4-to-rc.14 native bridge interface is unchanged, so the JS download
tracking changes can be delivered to existing generation 1 iOS 1.5.0 binaries.
Native crash-recovery fixes require a new native release; OTA does not replace
the installed native SDK. The Expo plugin has no code changes from rc.5 to rc.14.
