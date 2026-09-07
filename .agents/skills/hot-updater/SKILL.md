---
name: hot-updater
description: Use when working with Hot Updater v1 CLI setup, deployment, bundle inventory and state, rollback, rollout, channels, database migration, diagnostics, or AI-assisted React Native OTA operations.
metadata:
  author: hot-updater
  version: "1.0.0"
---

# Hot Updater CLI

Use this skill when a task involves Hot Updater's CLI, `hot-updater.config.ts`,
React Native OTA deployment, Bundle state, rollout, rollback, or
release-channel management.

## Operating Rules

- Start from the project root unless the user specifies another app directory.
- Read local `hot-updater.config.ts` before assuming provider behavior.
- Use `npx hot-updater ...` for CLI examples and user-facing instructions.
- Do not run `npx hot-updater init` on behalf of the user. It is interactive
  and asks for provider, build, and project-specific choices. Guide the user to
  run it directly and follow the setup documentation.
- Before running `npx hot-updater doctor`, make sure the server base URL is
  available. If the user did not provide it and it is not obvious from local
  config, ask for the update server URL first.
- Treat `deploy`, Bundle mutations, `bundle delete`, `storage prune --yes`,
  and database migration as state-changing operations.
- Use `--json` only with commands documented here as supporting it. If a target
  project uses an older CLI without that option, fall back to human-readable
  output for read-only commands.
- For non-interactive shells, use `-y` only when the user already requested the
  exact mutation or the target is unambiguous.
- After mutating Bundle state, verify with `bundle show` or `bundle list`.
- If `deploy` fails, stop the deploy workflow. Do not keep retrying fixes,
  edit setup, change credentials, install dependencies, or run migrations
  unless the user explicitly asks for that follow-up. Analyze only the failed
  command, relevant output, likely cause, and suggested next checks.
- Do not edit provider credentials unless the user explicitly asks. Credentials
  are commonly stored in `.env.hotupdater`, but projects may use a different
  environment-loading setup.

## Natural Language Requests

Users may invoke this skill with prompts such as:

```txt
$hot-updater deploy using the current app version
$hot-updater deploy the current iOS app version to production
$hot-updater roll back the most recently deployed bundle
$hot-updater list iOS bundles on the production channel
$hot-updater run doctor with server URL https://updates.example.com
```

Translate the request into the safest CLI flow. If a state-changing request is
missing a required platform, Bundle target, or server URL that cannot be
inferred from local context, ask one concise question before mutating anything.
For deploy channel, use the CLI default `production` unless the user names
another channel or local context clearly indicates one.

### Current App Version Deploy

When the user asks to deploy for the current app version:

1. Run `npx hot-updater app-version --json` when supported; otherwise run
   `npx hot-updater app-version`.
2. Extract `ios` and/or `android` from JSON when available, or from the
   human-readable output as a fallback.
3. If the platform is missing, ask whether to deploy iOS, Android, or both.
4. Deploy with `-t <version>`:

```sh
npx hot-updater deploy -p ios -t <ios-app-version>
npx hot-updater deploy -p android -t <android-app-version>
```

If deploying both platforms, run one platform at a time and verify each result
with `npx hot-updater bundle list -p <platform> --limit 5 --json` when
supported, or without `--json` as a fallback.

If a deploy command fails, do not continue to the next platform or attempt an
automatic repair. Report the failure analysis and wait for a new user request.

### Recent Bundle Rollback

When the user asks to roll back the most recent deployment without naming a
Release:

1. Run `npx hot-updater bundle list --json --limit 10`.
2. Choose the most recent enabled Bundle from the JSON result.
3. Disable that exact Bundle:

```sh
npx hot-updater bundle disable <bundle-id> -y --json
```

If there is no enabled Bundle, report that there is nothing to roll back.
After rollback, verify with:

```sh
npx hot-updater bundle show <bundle-id> --json
npx hot-updater bundle list -c <channel> -p <platform> --limit 5 --json
```

If `--json` is unavailable, rerun the same command without `--json`.

## Core Commands

### Setup and Diagnostics

```sh
npx hot-updater init
npx hot-updater doctor --server-base-url <update-server-url>
npx hot-updater app-version
npx hot-updater app-version --json
npx hot-updater console
```

- `init` creates or updates project configuration. Because it is interactive,
  tell the user to run it directly instead of choosing answers for them.
- `doctor` checks local setup and server health. Provide the v1 server base URL,
  without a v0 `/api/check-update` suffix; the CLI appends `/version`.
- `app-version` reads native iOS and Android app versions. `--json` returns
  `{ "android": string | null, "ios": string | null }` on CLIs that support it.
- `console` opens the local management console.

### Deploy

```sh
npx hot-updater deploy -p <ios|android>
npx hot-updater deploy -p ios -c production -r 25
npx hot-updater deploy -p android -f
npx hot-updater deploy -p ios -d
```

Important options:

| Option                             | Meaning                                       |
| ---------------------------------- | --------------------------------------------- |
| `-p, --platform <platform>`        | Target `ios` or `android`.                    |
| `-c, --channel <channel>`          | Release channel, default `production`.        |
| `-t, --target-app-version <range>` | App version range such as `1.2.3` or `1.x.x`. |
| `-r, --rollout <percentage>`       | Initial rollout percentage from `0` to `100`. |
| `-f, --force-update`               | Apply immediately on client update.           |
| `-d, --disabled`                   | Upload disabled for later enablement.         |
| `-m, --message <message>`          | Custom deployment message.                    |
| `-i, --interactive`                | Guided deployment flow.                       |

### Bundle Inventory and State

```sh
npx hot-updater bundle list
npx hot-updater bundle list -p ios --limit 10 --json
npx hot-updater bundle list --json
npx hot-updater bundle show <bundle-id> --json
npx hot-updater bundle update <bundle-id> --rollout-cohort-count 250 -y --json
npx hot-updater bundle enable <bundle-id> -y --json
npx hot-updater bundle disable <bundle-id> -y --json
npx hot-updater bundle promote <bundle-id> --target <channel> -y
npx hot-updater bundle delete <bundle-id>
```

- Deploy and promotion create independently managed Bundle IDs.
- Roll back by disabling the exact Bundle ID. Compatible devices then resolve
  to an earlier enabled Bundle or the JavaScript bundle in the native binary.
- `--rollout-cohort-count` uses a value from 0 to 1000; deploy's `--rollout`
  option uses a percentage from 0 to 100.
- In CI or other non-interactive shells, pass `-y` to Bundle mutations.
- `bundle artifact` contains advanced immutable artifact maintenance commands.
- Preview `storage prune` before deleting unreferenced objects.

### Channels

```sh
npx hot-updater channel set <channel>
```

This writes the default channel into native iOS and Android project files.
Changing this embedded channel requires a native rebuild.

### Database

```sh
npx hot-updater db generate
npx hot-updater db migrate
```

- `db generate` creates migration output without applying it.
- `db migrate` applies the latest migration through the configured database
  plugin.
