# Final integration checks

Reuse PR124's fixed driver and the R5 CDP harness. New tests are bounded additions,
not a replacement framework. Mutating fixtures require `127.0.0.1`; no model calls.

```powershell
$env:P07_QA_ROUND='p07-final'
$env:P07_R5_FINAL='1'
$env:P07_F_FINAL='1'
$env:P07_FINAL_INCLUDE_TRANSITIONS='1'
$env:AERIS_PHASE1_BASE_URL='http://127.0.0.1:19074'
$env:AERIS_PHASE1_CDP_URL='http://127.0.0.1:19644'
node qa/p07-r4a/run-gates.mjs final-exact-on --compiled-runtime --round3
```

Use new evidence labels; previous results cannot be overwritten. Service, CDP and
CDP+10 inspector ports must all be free and distinct from other concurrent runs.
The adapter stages **committed** allowlisted Git blobs; commit before validation.
It records separate product, QA and historical-source SHA values and script hashes.

For a focused transition run, unset the three FINAL switches and set
`P07_FINAL_TRANSITIONS_ONLY=1`. Optional `P07_R5_BROWSER_CASE` selects one named case.
Historical RED source overrides are restricted to fixed #132/#133 commits.
Warm upgrade uses `--cache-upgrade --warm-task25`; #131 and #132's allowlisted
Pages inputs are independently compared byte-for-byte by `protection.mjs`.
OFF/Kill reuse the existing `--flag-off`/`--kill-switch` driver contracts.

`transitions.mjs` records actual Chrome screencast JPEG frames plus timestamps and
DOM samples, real pointer hits, actual authentication, delayed real API responses,
3.2-second readiness, finite recovery/retry, double click, two account races,
foreground/background, real hidden normal refresh, and authoritative renewal.
Only the health-unavailable case uses a deterministic 503 substitute. It is not AI
or remote availability acceptance. Screencasts are rendering evidence; DOM samples
also verify policy, verification, visible primary screens, focus and inert state.
Continuous-frame checks detect blanks and unverified private content; first-visible
login checks effective ancestor opacity, whole-document axe, both themes and motion.
The delayed-finance case also holds the destination bootstrap after identity and
policy: an ON/OFF workspace already mounting must survive the finite startup
recovery without controller teardown. It fails on the retained `25406b3` candidate.
The reverse ordering also delays health by 3.2s before mounting: existing recovery
must remain visible until the destination completes. The retained `bb6fe72` fails
this case. A separate in-flight mount switches to canonical account B while its
bootstrap is held; account A's completion must not release B's unfinished canvas.
Recorders have a bounded 4800-frame budget, covering the unchanged wait budgets
at 240Hz. Exhaustion is partial/fail, never a silent continuous-frame PASS.
`P07_FINAL_FEEDBACK_ONLY=1` runs the original CI interaction audit unchanged against
the same isolated compiled runtime. Lab writes completed samples and terminal
errors immediately; it never reconnects or repeats a failed measurement.
The application CI finance stub now rejects offline transport before mutating its
fake server; the original outbox/reconnect assertions remain. Its focused VM test
is RED against the frozen old fixture and GREEN after this fixture-only correction.

Test corrections are recorded in the report, retaining original failures:
the navigation log starts after authoritative ON and then allows **no** pending/OFF
changes; a cold hidden document without a valid lease must reach safe recovery,
not claim ready; authenticated `/login` canonically maps to `/` only after current
identity and policy, with the actual new user's workspace verified.

Unit checks are in Core CI; browser suites run through the existing isolated
compiled Pages runtime. A green local run is not Hosted/Production/owner acceptance.
The two historical NOT_DETERMINED risks remain separate from current test results.
