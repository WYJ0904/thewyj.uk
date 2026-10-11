# Task 26 evidence provenance

Final software source is `47b1b3315647d9c148903a2a55d8a44320eda164`.

- `final-source-core-ci.json`: actual Core run38055936636, eight successful jobs. Attempt1 failed only when the Wrangler development ProxyWorker process lost its connection; attempt2 reran only that failed browser job. Seven passing jobs were reused, not manually repeated.
- `final-source-contracts.json`: actual JavaScript job summaries;29 engine+26 D1/API+17 client+2 multi-window+1 account-deletion=75 passing acceptance groups.
- `final-source-browser.json`: all320/390/768/1366/1920 widths passed on the final source, real Chromium with isolated local Pages/D1. Light/dark/large-text, actual offline/reconnect, accepted response-loss retry, malformed-cache preservation and kill/fallback checks are included. Runtime errors are empty. This is neither hosted authenticated Preview nor physical Samsung acceptance.
- `final-source-hosted-preview-read-only.json`: source-matched public assets and anonymous authentication boundary on deployment f89651ae. No remote authenticated learning/Admin flow or migration claim.
- `production-unchanged.json`: read-only Production config/source comparison against released main550bc41; Stable remains1.3.37/50. Does not claim private D1 ledger or R2 inventory access.
- `final-source-cloud-readiness.json`: actual presence-only discovery artifact from run38055936636; Cloudflare management, original signing and hosted Admin session inputs are absent. A successful discovery job is not usable permissions.
- `visible-ui-local.json` and `final-source-mastery-390-light/dark.png`: final runtime source47b1b33 in isolated local D1, with the strengthened QA harness identified by hash. Only390 was repeated after identifying captures during startup in the original CI artifact. The original CI screenshots are not used as UI visibility proof; final delivery CI must pass the non-empty visible-control assertions at all five widths. These images are not hosted Preview or Samsung evidence.

Earlier `isolated-*`, `local-browser-remaining.json`, `hosted-preview-read-only.json`, `cloud-readiness.json` and original screenshots are historical checkpoints with their own source provenance. They remain available but do not replace final-source evidence. No cookies, authorization headers, credentials, raw answers or real user records are saved here.

See [implementation closure](../../../TASK26_FINAL_CLOSURE.md) and [complete handoff](../../../TASK26_HANDOFF.md) for actual LOCAL_REQUIRED gates and Windows recovery commands. Remote0025 and Production release/rollout remain unexecuted.
