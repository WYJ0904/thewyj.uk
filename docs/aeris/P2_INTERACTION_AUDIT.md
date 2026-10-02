# P2 Interaction Audit

Base: `5f09ea95d9d1d829f4dc3a6819380001cac1208f`; branch `refactor/aeris-p2-interaction-motion`.
P1 was accepted by the user. PR #82 and main each have six successful Core CI checks, Production source5f09ea9. Raw physical evidence and measurement limits are retained in the workspace P1 report; current P2 evidence must be collected separately.

## Findings before product changes

| Surface | Current contract / evidence | P2 treatment |
| --- | --- | --- |
| Shared Web buttons | DS2.0 has80/140/200/260ms tokens and active1px translation; product/styles/workspace add independent timings and overrides. Async feedback in `js/core/perf.js` already sets pending/disabled synchronously. | Keep business locks; unify touch/keyboard pressed lifecycle and canonical motion ownership. Avoid transition-all and animated large shadows. |
| Web navigation/tabs | P1 latest-route guard and same-document navigation exist; legacy public gallery can be clicked and keyboard-focused. Native `summary` is a disclosure in the accessibility tree, not a normal DOM role=button. | Immediate feedback separate from route completion; interruption from current motion position; keep native input semantics. |
| Finance disclosures | `js/finance/disclosure.js` owns presentation preference only. Local-browser repeated close/open and transaction dialog open/cancel were observed without ledger writes. | Apply bounded presentation motion; do not animate or optimistically change financial writes. |
| Dialog/menu | Current DS backdrop/panel enter/exit and local dialog lifecycle exist; default durations are shared with ordinary buttons. | Dedicated effect tokens; preserve Back/Escape/outside dismissal and focus. |
| Android buttons | Material ripple supplies a baseline; shared wrapper only covers primary buttons. No central motion/haptic policy; delete icon requests40dp instead of48dp canonical target. | Local InteractionSource and graphics-layer feedback; unify meaningful haptic events with system-disable support. |
| Android bottom nav/tab/sheet | P1 immediate destination on click and latest callback filtering exist. Native notification uses Material TabRow and ModalBottomSheet. | Press feedback/visual selection without blocking navigation; preserve Material drag continuity. |
| Notifications | Real LazyColumn/revision key/225ms debounce/cancellation/generation. Pin/delete wait for repository then refresh full history. | Safe local optimistic actions with per-ID duplicate prevention, rollback/error, and query-generation protection; fixtures only for destructive tests. |
| Swipe | No necessary global swipe-only workflow. Notification has Tap delete/detail/pin equivalents. | A bounded reveal gesture with a clear threshold and Tap equivalent; offset remains local to stable row and cannot reorder data. |
| Transfer/high-frequency UI | Web rAF/local patch +250ms durable checkpoint; native IO worker/latest queue snapshots already implemented. Observed resume can preserve PENDING status while confirmed parts advance in the existing worker. | Keep part16MiB/concurrency/integrity; narrowly verify real status and interactive feedback, avoid whole queue rewrites/root animation. |
| Accessibility/reduced motion | Web CSS reduce rules exist in several owners; Material semantics preserved. | Single motion override, focus-visible/keyboard parity and native system animation scale; no interaction disabled by reduced motion. |

## Baseline methodology

The unchanged base is exported to `work/p2-baseline-source`. An isolated local D1/R2 environment and local-only passive pointer/click/rAF/long-task observer run at127.0.0.1. The observer records control IDs/timings/routes, not user content or credentials. Browser actions use the supported in-app browser API. Measurements are saved in `work/p2-execution/web-observations-before.jsonl`; widths390/1366/1920 use the same workflow before/after. Startup long tasks are distinct from input feedback. Existing callbacks already often respond on the first frame; P2 must not claim a universal latency improvement merely from shorter token values.

P1 physical baseline: notification150+ rows,60/120 scroll p95≈10.45/10.48ms with no>700ms frames; navigation p95≈18.24/14.82ms on the controlled workload. These are physical Samsung data, not desktop values. Reuse the same physical workload for the P2 comparison. USB was authorized at the P2 gate snapshot, then disconnected again during baseline setup; pending physical tests require fresh connection diagnostics, never simulator replacement.

## Risks / boundaries

- Motion state stays local; it does not become authoritative navigation or business state.
- Per-row rollback must not reinsert an old-query result or overwrite a newer successful action.
- Preserve native Material sheet gestures, semantic roles, disabled states, and system haptic preferences.
- Keep animation to transform/opacity and a bounded disclosure only; no broad parallax/blur or root-screen progress animation.
- Original user finance/notification/queue/share data is protected. Local Web fixtures and identified owned device fixtures are disposable; all other data is excluded from cleanup.
- P2 does not change brand/Logo, Product UI information architecture, API/schema, package/domain, or formal Android release identity.

## API sources

Implementation uses the pinned Compose Material3 library (1.4.0 through BOM2026.02.01), not a dependency upgrade. [Compose springs](https://developer.android.com/develop/ui/compose/animation/customize) preserve velocity across interruption. [View haptic feedback](https://developer.android.com/develop/ui/views/haptics/haptic-feedback) is used with normal system settings. Web reversal follows [Animation.reverse](https://developer.mozilla.org/en-US/docs/Web/API/Animation/reverse); [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) controls optional movement.
