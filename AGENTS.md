# thewyj.uk project workspace

The fixed Windows checkout is `%USERPROFILE%\Desktop\编程\thewyj.uk`.
Use this checkout for future local work. Use normal branches; create a worktree
only for a concrete isolation need. Do not create dated duplicate source trees.

Read `docs/WINDOWS_WORKSPACE.md`, `docs/WORKSPACE_MIGRATION_REPORT.md`, and
`docs/PAUSED_DEVELOPMENT_HANDOFF.md` before resuming unfinished work.

## Current owner instruction

Product development and releases are PAUSED. Workspace migration/verification
does not authorize resuming the Android Hotfix or financial AI. Keep the
unfinished Hotfix on its existing branch and preserve its uncommitted changes.
Task 26 is `CLOSED_WITH_OWNER_WAIVER`; do not relabel waived gates PASS.

## Protection and release boundaries

- Preserve original workspaces, release evidence, backups, and unfinished work.
- Never commit local secrets, Cookies, tokens, signing stores, or financial text.
- Do not read or publish the pre-existing root `访问口令.txt`.
- `_wyj-tools/` is pre-existing local tooling, not a site resource.
- Use the existing allowlisted Pages staging script for eventual deploy inputs.
  Never upload the whole developer workspace.
- Do not change Production D1/R2, feature flags, accounts, rights, APK signing,
  Stable pointers, phone data, or phone permissions as part of migration.
- Never push, merge, publish, run remote migrations, or dispatch release jobs
  merely to verify this workspace. Existing local tests use isolated fixtures.
- Keep real-device, Hosted Preview, Production, CI, and local evidence distinct.
- Keep Android Hotfix and financial AI separate. AI waits for Hotfix Closure.

Reports belong under `docs/`. Rebuildable logs/caches belong in ignored paths.
Retain referenced release screenshots, fixtures, golden files, and baselines.
When purpose is uncertain, preserve the file and report the uncertainty.
