# Aeris V6.2 CI and publish-boundary restoration

Baseline: `f144956a6962f0a43c7b4fc603e7cf18aabdf068` (main, independently queried on 2026-10-29). PRs 110, 111 and 112 are Draft; PR 113 is merged. The original Hotfix worktree and financial candidates are preserved.

This independent change validates Pages inputs before replacing the generated output, rejects nested private material, traversal, links and redirected Windows staging ancestors, and independently audits every published byte. It retains the existing reviewed runtime evidence module, without allowing QA evidence directories. Builds must be deterministic and contain only application assets and Functions.

Windows release tools explicitly read and write UTF-8. The workflow now runs Python on both Windows and Linux, adds build-security tests and an output audit, and uses the same pinned Node 22 runtime for cloud browser acceptance. Existing assertions, server limits, payment contracts and release gates remain required. The added emulator branch runs the existing unsigned runtime contract, without authorizing a signed release.

Fresh local checks on 2026-10-29:

| Collection | Result | Evidence |
| --- | --- | --- |
| Python release/tooling tests, Python 3.12.14, UTF8 mode 0, CP936 locale | 68 PASS | `docs/migration-evidence/aeris-p03-p07/ci/v62-python-tools-r1.log` |
| Pages staging security, Node 22 | 28 PASS, 0 skipped | `docs/migration-evidence/aeris-p03-p07/ci/v62-stage-security-r1.log` |
| Exact-head GitHub Actions | NOT_TESTED before the initial push | Recorded separately after GitHub runs |

The 68 Python tests include earlier release-tool subsets; repeated runs are not additional independent cases. Old failed logs are retained. Historical 185 Python and 59 Node command results are not presented as fresh remote CI evidence.

The unrelated toolbox browser failure is retained: the earlier local Pages process exited, and the fresh run reached its independent artifact verifier but the child process could not resolve `python`. Fixing this local fixture does not require removing product assertions. This change does not declare that browser gate passed.

No UI redesign, financial migration, production flag activation, account change, Android signing, device operation or deployment is part of this commit. The UI and finance working copies were first preserved under ignored `v62-restore` evidence. A Git revert of this tooling commit has no database effect.
