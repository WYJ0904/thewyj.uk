# FINANCE P06 isolated validation

Run from the existing finance checkout. Never point these drivers at Production,
an existing Preview database, or a formal Android application. All result paths
are guarded under `docs/migration-evidence/finance-p06/` and never overwrite a run.
The inherited whole-regression drivers require the finance-p04 evidence namespace;
their new, exclusively owned output is `finance-p04/p06-validation/`. Original
P04 reports, raw runs and seals are unchanged. The P06 final provenance includes
this additional evidence root explicitly.

Use the existing Node 22, Android SDK 36 and Android Studio JDK 21. Set
`FINANCE_P06_OUTPUT` to a **new** directory for each Node or Android invocation.

```text
node qa/finance-p06/ai-contracts.mjs
node qa/finance-p06/ai-v2-contracts.mjs
node qa/finance-p06/ai-recovery-contracts.mjs
node qa/finance-p06/migrations.mjs
node qa/finance-p06/web-ai.mjs
python qa/finance-p06/android.py --tests *FinanceAiTest
```

The default Chrome suite keeps every assertion. The explicit
`FINANCE_P06_DIAGNOSTIC_SAVE_FIRST=true` subset omits the withdrawal operation
to expose save-button restoration without an intervening reload; its withdrawal
row remains NOT_TESTED. It is not a replacement for the default suite.

The Samsung joint runner is headless and uses only this task's verified
`uk.thewyj.app.qa.financep06` package. ADB always selects the physical serial.
It generates no OS notification, payment, receipt acceptance, or foreground
Activity transitions. All money/source inputs are explicitly synthetic. A saved
owner-authorized real receipt may be read as a separate private SDK diagnostic.

```text
python qa/finance-p06/run-joint.py --attempt rN --numeric-reference
```

The alphabetic reference fixture is retained unchanged as the default. Actual
SDK OCR lost characters in that reference and the product refused it. The
numeric-reference fixture is a separate positive control and does not close
the original alphabetic-reference failure. Original B/33 PNGs and assertions
are unchanged in both modes. The existing explicit verification action creates
one normal 90-second ticket; AI does not extend it or create identity proof.

The private headless API36 AVD uses ADB port5043, console5588 and loopback5589.
Its creation driver and owner record are retained under `finance-p06/avd/`.
Only an owned, boot-verified AVD may use:

```text
python qa/finance-p06/run-joint.py --emulator --attempt rN --numeric-reference
```

Emulator lifecycle loops are never directed at Samsung. Physical rapid UI
loops remain disabled. Separate slow phone navigation helpers require the
owner-authorized formal accessibility privacy lease and preserve private raw
images outside Git. Restore the exact prior formal service state afterwards.

Prepare inherited regression drivers once in the new owned evidence root with
`prepare-compatible-regression.py`. It changes output paths and forwards only previously
declared fixture arguments; frozen source/oracles are not edited. Then run:

```text
python qa/finance-p06/full-regression.py --label final-r3
python qa/finance-p06/collect.py
```

Set `FINANCE_P06_FINAL` for the collector when using a label other than final-r3.
The owner-interrupted final-r3 Android attempt is archived separately. Its
finished 34-command Node batch is source-hash verified by `resume-final.py`;
only Android and the unfinished tail are rerun, with new command/log files.
Only one Gradle/archive owner may run at a time. Keep original six failures,
all26 identity red rows and overlapping suite identities visible. Current
results are never copied from a historical PASS.

Real-provider validation uses only an ephemeral AI binding with local Miniflare
D1. It is synthetic input, not a production transaction. The local driver caps
all validation attempts at15 started calls; the original12 results are retained
and amendment01 allows only three additional calls for a same-input model A/B.
Cached replay spends no extra call.
It records requested/observed model, actual usage/latency and failed outputs.
An unknown invoice charge remains null/NOT_TESTED. Do not reset that counter
or replace semantic failures with a mock result.
