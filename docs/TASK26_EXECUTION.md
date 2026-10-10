# Task26 execution record

- Released base main:550bc41bbaa01751d75c109f3246b9e174e4460d; Stable1.3.37/50.
- Independent branch:codex/task26-adaptive-learning-mastery.
- Release B Closure archived in2bb0574 and [PR104](https://github.com/WYJ0904/thewyj.uk/pull/104#issuecomment-6096339363); PR/main CI38041538855/38042322159 both8/8.
- Current stage:existing learning/schema/session/entitlement/AI/WebView audit and documented implementation design. No Task26 Production write, migration, Android pointer or Task27 work.
- Existing English/Japanese custom quiz, wrong-book/rejudge, Task11 history/sync and language entitlements will be retained. Server-issued adaptive tickets/events become the mastery authority; client historical correctness is not silently promoted into authoritative score.
- Actual missing resources:Wrangler not authenticated; Actions Cloudflare/signing/Admin inputs all false; secret/variable listing403. Pages Git deploy and GitHub repository operations work. Hosted D1 migration, privileged Preview acceptance and any required new original signing remain separately gated.
- See TASK26_DESIGN.md for algorithm/data/API/UI/test matrix and release boundaries. Implementation/tests/Preview/Production statuses remain IN_PROGRESS/NOT_EXECUTED until actual evidence.

## Engine checkpoint

Pure mastery-v1 reducer and deterministic adaptive selector implemented;29 acceptance groups PASS. Reviewed English/Japanese catalog currently62 knowledge points/124 question variants, reusing existing rubrics/canonical Japanese forms plus explicit vocabulary/grammar/examples/confusion sets. Correctness uses course-owned deterministic answers, not AI. Repeat cooldown survives arbitrarily many duplicate attempts, effective evidence is capped per point/day, and mastery requires spaced diverse evidence. Current source is a verified implementation checkpoint, not full API/UI/Preview/Production acceptance.
