# Task26 Samsung Preview acceptance

2026-10-11 actual owned Samsung SM-S9360 / Android16 tests were collected against runtime 72661e69a4f97c779935e00a1824f613e9ba0bae, Preview8548bed6. Independent test package uk.thewyj.app.preview / 0.0.2-task26-preview(2), local debug signer. This evidence is separate from original Production App1.3.37/50 acceptance. Exact runtime CI [38128462250](https://github.com/WYJ0904/thewyj.uk/actions/runs/38128462250) passed8/8 plus Pages. A later documentation delivery must have its own exact-head CI.

| Gate | Result | Evidence |
| --- | --- | --- |
| 启动与普通 Web 登录 | PASS | [scope-status-after-fix.json](releases/task26/2026-10-11-samsung/scope-status-after-fix.json) |
| 英语正误 / Mastery | PASS | [actual-english-learning.json](releases/task26/2026-10-11-samsung/actual-english-learning.json) |
| 日语正误 / Mastery | PASS | [actual-japanese-learning.json](releases/task26/2026-10-11-samsung/actual-japanese-learning.json) |
| 真实断网、force stop、原 ID 恢复 | PASS | [real-offline-final.json](releases/task26/2026-10-11-samsung/real-offline-final.json) |
| 内置 WebView/SW 定向阻断 | PASS | [targeted-block-final.json](releases/task26/2026-10-11-samsung/targeted-block-final.json) |
| 接受后丢回执、同 ID 重试去重 | PASS | [actual-accepted-response-loss.json](releases/task26/2026-10-11-samsung/actual-accepted-response-loss.json) |
| 自然到期的英日复习 | PASS | [actual-natural-review.json](releases/task26/2026-10-11-samsung/actual-natural-review.json) |
| 注册 / 登录 / 退出 / A-B / 会员 / 前后台 | PASS | [actual-auth-account-isolation.json](releases/task26/2026-10-11-samsung/actual-auth-account-isolation.json) |
| 修正后真实 Workers AI 与 OFF 课程回退 | PASS | [actual-grounded-ai-and-fallback.json](releases/task26/2026-10-11-samsung/actual-grounded-ai-and-fallback.json) |
| 三通道 / kill 与恢复 | PASS | [actual-channels-and-kill.json](releases/task26/2026-10-11-samsung/actual-channels-and-kill.json) |
| 普通 Quiz / 历史上云 / 受限业务拒绝 | PASS | [actual-ordinary-quiz-history-scope.json](releases/task26/2026-10-11-samsung/actual-ordinary-quiz-history-scope.json) |
| 真实手机 Admin / Flags / 只读聚合 | PASS | [actual-phone-admin-diagnostics.json](releases/task26/2026-10-11-samsung/actual-phone-admin-diagnostics.json) |
| 存储组件：strict IndexedDB 按 owner 清理 | PASS | [actual-indexeddb-component-isolation.json](releases/task26/2026-10-11-samsung/actual-indexeddb-component-isolation.json) |
| 精确云端账户 / 权限 / Flags 清理 | PASS | [owned-fixture-cleanup.json](releases/task26/2026-10-11-samsung/owned-fixture-cleanup.json) |
| 原业务聚合与六组配置保护 | PASS | [post-cleanup-original-data-protection.json](releases/task26/2026-10-11-samsung/post-cleanup-original-data-protection.json) |
| 独立 Preview 本地清理 | PASS | [preview-only-local-fixture-cleanup.json](releases/task26/2026-10-11-samsung/preview-only-local-fixture-cleanup.json) |
| 原 App50 包 / 签名 / 系统权限保护 | PASS | [device-original-after-preview-tests.json](releases/task26/2026-10-11-samsung/device-original-after-preview-tests.json) |

Actual Wi-Fi/mobile0/0 and unreachable public probe proved networkA even though navigator.onLine stayedtrue; restored both1/1. NetworkB blocked only Preview WebView/SW. Accepted-response loss recovered original event e5fa6bf6-a0f9-412d-a26e-c7101602fca4, original seq103, observed same-ID replay and D1count1. Naturally elapsed EN/JP review queues were completed without changing clock or backdating. Foreground kill was first observed closed17410ms after starting the real CAS change; old Quiz stayed available.

English validated a genuine Workers AI cache result in grounded namespacev2; Japanese returned a new generated valid response after one real schema-rejection fallback. AI OFF produced course text, no model request and unchanged mastery. [Historical bad output and safe recoveries](releases/task26/2026-10-11-samsung/failure-and-recovery.json) remain recorded. The first phone localStorage durability failure is retained; the lost event was never reconstructed.

The IndexedDB component test used synthetic local owner IDs/entries in the real Preview WebView, zero cloud events; it verifies put/list/clear/remove and another-owner retention, and is not an end-to-end cloud account-deletion claim. The ordinary free account retained a visible permission explanation and ordinary Quiz; its adaptive API and actual start were denied403 and learning events stayed0.

All five exact current fixtures were soft-deleted through normal APIs, all sessions/memberships/active overrides0; the exact temporary admin role was revoked with a management audit and its existing session denied Admin403. Five flags restored OFF/0%/Experimental. Original Preview users64, old sync138, memberships8, finance4, notifications10, and six original configurations match with the two exact owned cycles excluded. Immutable fixture learning/audits remain retained. Only independent Preview package data was cleared to actual guest login. Original App50 hash/signer/UID/update time and accessibility/notification permission hashes match; no original data store was read or cleared.

Production remains main550bc41/deployment575097ca-d940-4100-af6f-cb689518c7b4 and Stable1.3.37/50. Production0025/deployment/rollout, original App50 Task26 validation, public changelog and final release closure remain NOT EXECUTED. The next steps are exact-head review/CI and authorized release in order; later Android Hotfix and financial AI remain isolated and not started.

The case files include reused unchanged startup/grading checkpoints and explicit later durability/AI retests; they do not imply every historical case was rerun after each source change. Hosted Chrome physical disconnect remains NOT EXECUTED; the required Samsung real-radio and targeted-network cases are separate actual results.

Production Git auto-deployment was normally paused after Preview/device gates passed; all non-production branch deployments remain enabled. This reversible release control prevents a main merge publishing before the required D1/main-CI gates. Serving code/data/APK/Stable and secrets were not changed. It must be restored after the controlled release.

After all Preview/device/cleanup gates passed, source root and Production TASK26_ADAPTIVE_LEARNING_ENABLED were prepared as true for authorized release eligibility. Preview configuration and every other binding/Android metadata field are unchanged; the five migration definitions still seed OFF/0%/Experimental. Production Git publication remains held and no serving runtime/database deployment occurred through this source edit. The final configuration delivery needs its own exact-head CI before Ready/merge.
