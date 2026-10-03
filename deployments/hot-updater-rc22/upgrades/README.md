# Infrastructure upgrades

Inspect the live server version, infrastructure generation and migration history, and compare them with the target manifest. Unknown state requires investigation before choosing an upgrade path.

Each file records one required infrastructure version. Read the applicable baseline for the installed generation as context, then every subsequent file through the target requirement in ascending order. If the deployed generation predates the first file, start with that file. Read all relevant files before applying any changes; do not skip intermediate releases or read only the newest file.

Use the common sections and your provider's section to plan the full transition. Previously completed steps provide context and must not be replayed blindly. Inspect actual migration/resource state, preserve customizations and secrets, and record which version files and steps have been applied and verified. Apply pending changes in order using the target scaffold; investigate conflicting requirements before proceeding.

- [1.0.0-rc.29](./1.0.0-rc.29.md) — HTTP response diagnostics in Insights; runtime and Console upgrade without a database migration
- [1.0.0-rc.30](./1.0.0-rc.30.md) — Daily observed bundle share; migrate Insights to schema 1.3.0 before upgrading the server and Console
- [1.0.0](./1.0.0.md) — Release Catalog, manifest artifact protocol v1, and storage engine infrastructure generation
