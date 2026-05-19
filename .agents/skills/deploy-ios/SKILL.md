---
name: deploy-ios
description: Deploy the Modex/Codex Relay mobile app iOS OTA update with Hot Updater. Use when the user invokes $deploy-ios or asks to deploy the current iOS app version from apps/mobile.
allowed-tools: Bash(pnpm:*)
---

# Deploy iOS OTA

Deploy the iOS Hot Updater OTA bundle for the mobile app.

## Workflow

1. Work from the mobile app directory:

```bash
cd apps/mobile
```

2. Read the current native app versions:

```bash
pnpm hot-updater app-version --json
```

3. Extract the current `ios` app version from the output. If `--json` is not supported, run `pnpm hot-updater app-version` and parse the iOS version from the human-readable output.

4. Deploy iOS with the current iOS app version:

```bash
pnpm hot-updater deploy -p ios -t <ios-app-version>
```

5. Wait for the command to finish. Do not stop at the build spinner.

6. Report the deployment result:

- Success requires build complete, storage upload complete, database update complete, and `Deployment Successful (...)`.
- Include the deployment id from the success line.
- If it fails, report the failing phase and the relevant error output.

## Notes

- `apps/mobule` in user prompts means `apps/mobile` for this repo.
- This command deploys to the configured Hot Updater production channel and targets the current iOS native app version.
- Do not hardcode an app version in this skill. Always read the current iOS version at deploy time.
- Do not change platform, rollout, channel, or environment unless the user explicitly asks.
