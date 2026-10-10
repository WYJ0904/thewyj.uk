# Task26 — adaptive learning and mastery-v1

Base: formally released main550bc41bbaa01751d75c109f3246b9e174e4460d, Stable1.3.37/50. Release B Closure and its explicit manual-update waiver are in RELEASE_B_FINAL_CLOSURE.md. Branch:codex/task26-adaptive-learning-mastery. Task27 is not authorized.

## Existing flow and reuse

Current flow is custom/fixed word list → Task15 quiz session → rubric/deterministic checks plus existing optional AI judge → result → wrong-book/rejudge → history/achievements/daily goal → account-scoped Task11 learning sync. English/Japanese vocabulary indexes, COMMON_RUBRICS and Japanese canonical forms already exist. Historical sync is client-originated learning JSON, not proof of server-verified mastery. Do not reinterpret it as fully mastered content or overwrite it.

Task26 adds an explicitly selected practice mode in the same language workspace: server-issued question ticket → idempotent answer event → deterministic server grading → versioned mastery update → adaptive next/review → post-answer explanation. Ordinary quiz, custom lists, wrong-book/rejudge, history, achievements and memberships retain their existing paths. Reviewed server course data reuses existing vocabulary/forms and adds bounded bilingual grammar/example/confusion content; AI-generated material never becomes authoritative course answers.

Existing Android learning uses ThewyjWebView and WebSessionBridge, with canonical Task20 device credentials resolved by Task12 authentication. The new learning UI will use this existing architecture and the same server APIs. No native payment/accessibility/Room/signing/update behavior is being changed. An Android binary release is not required if that remains true; any later native implementation change must trigger an incremented unsigned/signed candidate and its own applicable physical gate. Release B Samsung acceptance cannot be relabelled as Task26 device acceptance. Cloud HTTP native/WebView identity tests are labelled transport tests.

## Deterministic state and selection

- Continuous score0–100, confidence0–1; algorithm and state versionmastery-v1. Per-user/language/knowledge point, with vocabulary/reading/grammar/question-family identity and subject summary. Store raw/effective counts, streaks, durations, last update/review and next review. Same accepted event sequence and version produce the same state.
- Correct/incorrect evidence, recent and historical performance, difficulty, response duration, elapsed review interval and repeat cooldown affect bounded updates. Mastered requires multiple effective samples and spaced/family-diverse evidence; new or repeated identical short-term prompts cannot manufacture mastery. Review urgency/confidence decays with elapsed UTC time while historical records remain intact.
- Adaptive priority mixes due reviews, weak points, recent errors, unseen points and mastered spot checks, with deterministic tie-breaking and recent question/family exclusion. Empty history bootstraps automatically. Weak-only and review modes are explicit options; no infinite single-question loop. Normal quiz remains the failure fallback.

## Persistence and safety

Additive0025 introduces task26 metadata, server-issued tickets, immutable/idempotent learning events and derived per-point states/indexes. It also defines five Task25-managed feature keys, all OFF with0% rollout and Experimental-only scope:adaptive_learning,mastery_score,adaptive_review,ai_error_explanation,similar_word_explanation. Existing Task25 seeds/settings/audit and business tables remain unchanged. Schema/master switches fail closed. Production remains OFF until real Preview/migration/rollout gates pass.

Server validates authentication, existing language entitlements, Task25 evaluation, ticket ownership/expiry/course version, strict fields, bounded input and rate limits. Client correctness/score/user/channel claims are rejected. Answer is not included in question responses. One ticket accepts one outcome; stable event IDs deduplicate retries across devices, and conflicting ID reuse fails. Accepted server event sequence and compare-and-swap projections prevent older concurrent state replacing newer state. Durable events allow recovery after projection/response failure and reproducible recomputation. No sensitive free-form content or credentials in logs; stored answers are digests/derived outcomes, bounded explanation context remains server-owned.

The browser/WebView maintains a versioned bounded per-account outbox and readonly authoritative summary cache; no local mastery calculation. Logout/account switch cancels in-flight results and never submits one account's queue as another. Offline answers to already issued tickets are explicitly pending; basic quiz remains usable. Retry, reload/process restoration, expired auth, malformed responses and storage failure must not lose acknowledged events or claim false sync. Existing storage keys stay unchanged.

AI uses existing runStructuredAi/WorkersAI, D1 cache, global/user quota, short timeout and strict response schema, only after authoritative grading. Local rule/example/confusion explanations are preferred; errors always return a safe deterministic explanation and never change result/mastery. UI renders text, not AI HTML/Markdown.

## Acceptance matrix and release boundaries

| Area | Required evidence |
| --- | --- |
| Engine | bootstrap/correct/incorrect/streaks/difficulty/speed/spaced recall/decay/bounds/repeat/family diversity/version/replay/date boundaries |
| Selection | due/weak/new/mastered mix, weak mode, no loops, invalid/empty history, language isolation |
| D1/API | full additive migration/replay, legacy preservation, auth/entitlement/CSRF/rate/body checks, cross-user denial, dedup/conflict/concurrency/out-of-order/recovery, canonical browser/native/WebView identity |
| Flags | globalOFF/channel/user/%/bucket/kill/dependency/fallback, unchanged Task25 audit; Admin readonly aggregate diagnostics, no arbitrary score editing |
| AI | local-first/normal/cache/timeout/empty/malformed/quota/unavailable/untrusted-output handling; no pre-answer leakage or correctness modification |
| UI | real Chromium320/390/768/1366/1920, light/dark, enlarged text, empty/error/loading, quiz→mastery→next→wrong/explain→review→reload, outbox/account/auth/network failures |
| Android | existing package/signing/metadata retained, JVM/lint/build/runtime and new transport/WebView contracts; no emulator described as Samsung |
| Regression | ordinary learning/wrong-book/rejudge, Finance, account, membership, homepage, notification, transfer, update and Task25 contracts; all eight exact-head Core CI jobs |
| Hosted/Production | isolated real Preview schema/admin/full flow, then current ledger/bookmark/defaultOFF preflight, additive migration once, same-project deployment, Production smoke and Experimental→Beta→percentage Stable audit/kill/rollback |

Current actual cloud Wrangler authentication, Actions Cloudflare token/account, original signing secrets and hosted Admin session are absent. GitHub and Pages Git integration are available. These facts do not stop implementation/isolated D1/browser/Android/CI work. They block only the corresponding hosted migration/admin/new-signing/promotion operations. Do not claim hosted schema/API/rollout PASS from local tests or merge/deploy active Task26 through a failed release gate. Recovery keeps additive tables/events and disables flags/rollout; never reset D1, drop historical data or overwrite Stable50 APK.
