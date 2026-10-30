# Aeris V6.2 protection and Task26 compatibility recheck

Observed 2026-10-29, final hash comparison at 16:18:11 HKT. **PARTIAL_UNAVAILABLE_PATH**: 18 of 19 original protection groups were verified unchanged; the original Task26 checkout cannot be verified because its path is missing. This is not a 19/19 PASS. All five inherited evidence seals pass.

This audit performed no protected-worktree writes, device operations, Production operations, restores, branch switches, migrations, merges or deletions. The three active development trees are deliberately outside the old unchanged-state comparison. Their ongoing edits are not classified as protected-state drift.

## Protected checkouts and evidence

Command, from the current P07 checkout:

```powershell
python qa/aeris-release/final-protection-recheck.py --label v62-final-protection-r2
```

The first attempt used the inherited all-or-nothing snapshot and stopped at the missing Task26 path. Its failure remains in `docs/migration-evidence/aeris-p03-p07/v62-final-protection-r1/incomplete-run.json`. The revised audit continues independent groups and exits 1 on incomplete coverage, rather than silently ignoring the missing group.

The original baseline `baseline/protected-before.json` remains unchanged, SHA-256 `36e1d17aeeddd8ee47ae519b68754f72df3e017d3299fbae44c1915f4180c7eb`.

| Scope | Current result |
| --- | --- |
| Fixed main/Hotfix checkout | 833 files byte-identical; HEAD, branch and uncommitted status identical |
| Aeris repair checkout | 840 files and Git state identical |
| D01 / D01 control / D02 | 859 / 829 / 871 files and Git state identical |
| Hotfix acceptance candidate | 881 files and Git state identical |
| P02 checkout | 901 files and Git state identical |
| P03 / original multicurrency / remediation | 1,132 / 1,385 / 1,410 files and Git state identical |
| Prior convergence / design / UI | 1,429 / 1,444 / 824 files and Git state identical |
| Original phase3 / D01 / D02 / candidate / P02 raw evidence | 140 / 870 / 207 / 366 / 196 files byte-identical |
| Task26 original checkout | **MISSING_CHECKOUT_NOT_VERIFIED**; original 826-file baseline cannot be compared |

The available 18 groups contain 13,638 source-file entries and 1,779 original evidence-file entries. No additions, missing files, byte changes or Git-state changes occurred within these available groups. These counts describe snapshot entries, not a count of test cases or a claim that all paths across independent manifests are unique.

| Inherited sealed tree | Entries checked | Manifest SHA-256 | Result |
| --- | ---: | --- | --- |
| finance-p03-p06-remediation | 1,935 | `7ff88c4c634d86ed3772eec1460cc0c6dbeea3b32676e873fd0c2f3fb29ea37c` | PASS |
| finance-p04-multicurrency | 2,588 | `e1c6ade0ed7eca408b84aa3fb80103b494a066adad31fd02b2f71ff4e441d769` | PASS |
| finance-release-convergence | 1,186 | `18a1df5e4494cf96af94e50091d8daf4afb532c0f8644ddedc27ac8fe6bbff61` | PASS |
| p07-design-optimization | 183 | `2687f850e80a5734857982c7164887c401ce19f5e7702ab85fe8ea8beb7bf877` | PASS |
| p07-ui-release | 243 | `debd99726ed7ad84616de03673a11f0d80e5151859e5ff51ff21b85b0b400e4d` | PASS |

All 6,135 manifest entries match their recorded byte sizes and SHA-256, and the five manifest files themselves match the original baseline digests. These seal entries overlap other protection inventories; they are not added to those inventories as independent unique files.

Full fresh evidence: `docs/migration-evidence/aeris-p03-p07/v62-final-protection-r2/result.json`, `protected-after.json`, and `protected-comparison.json`. Existing seals and baseline files were read only and not regenerated.

## Task26 path and historical status

The original `%USERPROFILE%/.codex/worktrees/task26-wrong-review/thewyj.uk` path is absent. Its parent contains only `.codex-worktree-name`; the checkout is absent from the current Git worktree registry and this task's active/archived worktree attachments. No alternative location or recoverable archive was established by this audit. The cause of the missing checkout is **INCONCLUSIVE**; this audit did not remove it and does not attribute its absence to the current continuation.

The original baseline records clean branch `codex/task26-wrong-review`, HEAD `6247c4148904cafa264204fc1816b2e8e1d4360a`, 826 files. That Git commit and the matching remote branch still exist. Git-object availability is not presented as a new byte-level checkout verification. No restore or new Task26 implementation was attempted.

The historical released Task26 state remains **CLOSED_WITH_OWNER_WAIVER**. The owner-designated ordinary-member consent, small-percentage observation and original App50 isolated-write waivers remain **WAIVED_BY_OWNER**, never PASS. Source: the preserved `docs/releases/task26/2026-10-14-production/owner-release-checkpoint.json` and subsequent owner closure history. Missing local checkout coverage does not reopen those historical business gates or manufacture device evidence.

## Current PR111 versus current main

[PR111](https://github.com/WYJ0904/thewyj.uk/pull/111) is OPEN, Draft, unmerged, head `6247c4148904cafa264204fc1816b2e8e1d4360a`. The connector's PR base metadata still reports the old `74eadf5` base. Independent live `git ls-remote` confirms current main is `63b8c419380a0a4daae06e8bbf97f77d92ce4939`; the two values are explicitly distinguished.

The existing exact-head [Core CI 38844323258](https://github.com/WYJ0904/thewyj.uk/actions/runs/38844323258) still reports eight executed Actions jobs successful, plus Cloudflare Pages success at deployment `642a5f0a-03d6-4793-93c7-22c3f1d72ab4`. These are retained historical results for the PR111 head, not newly executed integration tests against current main.

A read-only three-input `git merge-tree` preview used merge base `74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc`, current main `63b8c419`, and PR111 `6247c414`. It produced 55 conflict blocks across 27 files, including asset import/cache identities, app/HTML, finance and language modules, static contracts and package/SW files. It is the legacy textual three-way preview, not an actual merge, an `ort` merge verdict or a runtime compatibility result. Exit 0 from that command does not mean conflict-free. Raw output and the file list remain under `v62-final-protection-r1/task26-main-three-way-preview.diff` and `task26-conflict-files.json`. PR111 is not an ancestor of current main.

The independently downloaded and digest-checked current CI artifact from [PR116 head 5fbb24b8 / run 40836191455](https://github.com/WYJ0904/thewyj.uk/actions/runs/40836191455) contains the existing main-line Task26 browser protection results: all five widths 320/390/768/1366/1920 passed with empty runtime errors; 390 also exercised offline pending replay, accepted-response loss retry and malformed-response cache retention. The artifact reports **isolated local Pages/D1**, not Hosted Preview or a physical device. It does not contain a merge of PR111 and cannot establish that separate branch's compatibility with new P07.

Consequently, current-main Task26 regression evidence is available; **PR111/current-main combined runtime acceptance remains NOT_TESTED / RELEASE_HELD**. Before considering that separate release, recover or explicitly establish its work area, resolve the actual source integration, then run new exact-head CI and applicable Preview/device gates. Preserve additive 0026 semantics and existing waivers. No Task27 was started.

## Audit limits

This comparison does not inspect live Production financial rows, R2 contents, installed APK bytes, phone permissions or private chats. Their live state is NOT_TESTED by this sub-audit and belongs to the main release/device evidence. Source/hash protection must not be substituted for a physical-device or real-business PASS.

Only `qa/aeris-release/final-protection-recheck.py`, this report, and fresh ignored audit evidence were created for this audit. They await the primary flow's review and commit; no child-agent Git commit was made.


## 2026-10-30 final repeat

Fresh label v62-final-protection-r3 again verifies18 available groups without drift:13,638 source entries and1,779 original evidence entries. All five inherited seals /6,135 entries and manifest digests match. Task26 path is still absent; overall PARTIAL_UNAVAILABLE_PATH, not19/19 PASS. Exit1 is the explicit incomplete-coverage signal, not a hidden code or evidence mismatch. No protected source was written by the check. The current main release and separate device tests are reported by the main flow and do not alter this read-only audit scope.
