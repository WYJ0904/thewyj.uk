# Aeris P07-R4-A runtime repair

Baseline: `f7949f8253f51ea2621c397743208971c0cec467`.
Branch: `codex/p07-r4a-runtime`.
Current verification status: `P07_R4A_PARTIAL` (browser gates and isolated Preview pending).

## Mechanism changes

- Membership data loading no longer owns visibility. Every membership entry uses
  `showMembership`, which switches the primary surface once and preserves the
  goal/return route in validated History state. Account/confirmation semantics
  are distinct. True confirmation dialogs retain their existing lifecycle.
- Direct route changes invalidate earlier async renders. Async finance/tools/
  transfer entry functions adopt the generation of their own URL transition.
- Presentation policy now distinguishes pending, enabled, disabled and error.
  A valid in-memory decision is retained only for the server's maximum 30-second
  TTL and same owner. Functional feature APIs still close while hidden/offline.
  Pending policy uses one neutral in-flow state; an actual failure produces a
  consistent safe base interface with retry. There is no 250ms mode decision.
- Release references use `20261105-aeris-p07-r4a-runtime`. SW installation stages
  a complete shell; offline HTML is published after its assets. HTML from a
  different release cannot overwrite this release's offline document. Old
  release caches and unrelated Cache Storage are preserved for existing clients.
- No brand resource bytes or semantic Logo paths were changed. Only release
  query parameters on existing references change with the resource version.

## Evidence recorded before browser acceptance

- Existing public UI/authorization contract: 36/36 PASS.
- Existing Task25 shared Web/native vectors: 19/19 PASS.
- New presentation-state contracts: 4/4 PASS.
- Module dependency graph and frontend storage contract: PASS.
- Actual Pages Functions build on pinned Wrangler 4.118.0: PASS.
- 43 protected brand/Android resource Git blobs unchanged; image bytes and Logo
  reference paths verified by `qa/p07-r4a/brand-guard.mjs`.

PR #124 is consumed as an external, fixed QA driver at
`882efdb9978f2608c54bc6c9c19eb8843e80945f`; its whole QA tree and screenshots
are not merged into this product branch. `run-gates.mjs` creates ignored driver
copies, fixes the new target SHA and expands the upgrade transport's asset map
to the candidate's allowlisted text assets. Frozen browser assertions remain
unchanged. Original RED evidence stays in PR #124.

No Production, formal D1/R2, signing, Stable, phone or paid AI operation occurs.
Final SHA, gate results, Preview URL and Gemini Flash handoff will be recorded
after the actual targeted acceptance runs.
