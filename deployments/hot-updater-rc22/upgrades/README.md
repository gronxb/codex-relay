# Infrastructure upgrades

Inspect the live server version, infrastructure generation and migration history, and compare them with the target manifest. Unknown state requires investigation before choosing an upgrade path.

Each file records one required infrastructure version. Read the applicable baseline for the installed generation as context, then every subsequent file through the target requirement in ascending order. If the deployed generation predates the first file, start with that file. Read all relevant files before applying any changes; do not skip intermediate releases or read only the newest file.

Vercel was added after 1.0.0: files through 1.0.0 have no Vercel section. A Vercel deployment applies the Vercel sections of the files after 1.0.0; when none is listed, it needs no infrastructure change, and reconciling it with this scaffold follows the upgrade section of its SETUP.md.

Azure was added after 1.0.0: files through 1.0.0 have no Azure section. A Azure deployment applies the Azure sections of the files after 1.0.0; when none is listed, it needs no infrastructure change, and reconciling it with this scaffold follows the upgrade section of its SETUP.md.

Use the common sections and your provider's section to plan the full transition. Previously completed steps provide context and must not be replayed blindly. Inspect actual migration/resource state, preserve customizations and secrets, and record which version files and steps have been applied and verified. Apply pending changes in order using the target scaffold; investigate conflicting requirements before proceeding.

- [1.0.0](./1.0.0.md) — Release Catalog, manifest artifact protocol v1, and storage engine infrastructure generation
- [1.2.0](./1.2.0.md) — Core schema 1.2.0: the native build registry table and the tables of the official plugins added beside it
