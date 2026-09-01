---
name: hot-updater-qa-ship
description: Deploy the current Modex iOS app version with Hot Updater for QA-only delivery. Use when the user invokes $hot-updater-qa-ship or asks to ship the current iOS OTA to one target cohort only, with rollout 0.
allowed-tools: Bash(pnpm:*)
---

# Hot Updater QA Ship

Deploy the current iOS OTA bundle to the configured production channel with
rollout `0`, then attach exactly one target cohort to the newly created Release.

## Required Input

Ask the user for only the target cohort when it is not already provided. Do not
ask for platform, channel, rollout, or app version.

Target cohort rules:

- Trim surrounding whitespace.
- Reject empty values.
- Accept only one cohort value. If the user provides multiple values, ask for a
  single cohort.
- Pass the cohort to Hot Updater exactly as the validated trimmed string.

## Workflow

1. Work from the mobile app directory:

```bash
cd apps/mobile
```

2. Read the current native app versions:

```bash
pnpm hot-updater app-version --json
```

3. Extract the current `ios` app version. Treat numeric JSON values as strings
   when passing them to the CLI. If `--json` is not supported, run
   `pnpm hot-updater app-version` and parse the iOS version from the
   human-readable output.

4. Deploy the current iOS app version with rollout `0`:

```bash
pnpm hot-updater deploy -p ios -t <ios-app-version> -r 0
```

5. Wait for the deploy command to finish. Success requires build complete,
   storage upload complete, database update complete, and
   `Deployment Successful (<bundle-id>)`.

6. Extract `<release-id>` from the `Release ID` row in the deployment summary
   and `<bundle-id>` from the deployment success line.

7. Attach the target cohort to that exact Release without prompting:

```bash
pnpm hot-updater release update <release-id> --target-cohorts "<target-cohort>" -y
```

Use `--json` as well when you want machine-readable confirmation from the
update command:

```bash
pnpm hot-updater release update <release-id> --target-cohorts "<target-cohort>" -y --json
```

8. Verify the Release policy:

```bash
pnpm hot-updater release show <release-id> --json
```

Confirm the resulting Release has `bundle_id` equal to the deployed Bundle ID,
`platform` equal to `ios`, `target_app_version` equal to the current iOS app
version, `rollout_cohort_count` equal to `0`, and `target_cohorts` equal to an
array containing exactly the requested target cohort.

## Failure Handling

- If the app version command fails, report the error and do not deploy.
- If deploy fails, stop immediately. Do not run `release update`.
- If the deployment summary does not contain a Release ID but the Bundle ID is
  available, run
  `pnpm hot-updater release list -p ios --bundle-id <bundle-id> --limit 5 --json`
  and identify the newly created Release before updating it.
- If the Bundle ID is unavailable, stop rather than guessing which Release was
  created.
- If `release update` fails, report the Release ID, Bundle ID, and update error.
- If verification fails, report the mismatch and both IDs.

## Notes

- This skill always targets iOS.
- This skill always uses rollout `0`.
- This skill uses the Hot Updater default channel, currently `production`,
  unless the repo configuration or CLI default changes.
- Do not hardcode an app version. Always read the current iOS version at deploy
  time.
