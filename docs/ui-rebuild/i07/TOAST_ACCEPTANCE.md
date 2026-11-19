# I07 Toast Manager & Queue Governance Acceptance

## 1. Queue & Accessibility Contract (`js/core/motion-toast.js`, `design-system.css`)

- **Max 2 simultaneous visible cards** (`maxVisible = 2`), bounded backlog queue (`maxQueue = 12`).
- **Priority & Error Protection**: Active `error` toasts are never displaced by incoming `info`/`success` bursts; lower-severity duplicate bursts increment a compact `xN` counter badge instead of spamming duplicate alerts.
- **Hover & Focus Timer Pause**: Pointer hover (`pointerenter`/`pointerleave`) or keyboard focus inside the toast suspends auto-dismiss countdown cleanly via `createMotionScope`.
- **Screen-Reader Routing**: `error` / `warning` use `role="alert"` (`aria-live="assertive"`); `success` / `info` use `role="status"` (`aria-live="polite"`).
- **Host Integration (`app.js`)**: `showAchievementToast` delegates directly to `showToast` when `P07 UI` is active while retaining existing legacy toast behavior if `p07_accessibility` is disabled.

## 2. Unit & Real Chrome Verification

- **Unit (`local-backend/test_i07_motion_engine.mjs`) — PASS**: `createToastManager enforces max 2 visible, bounded queue, dedupe, and error protection` confirms FIFO advancement, deduplication counter increments, bounded queue tail eviction, and error shield under saturation.
- **Fixture Scenario 6 (`toast-5-burst-max-2-queue`) — PASS**:
  - Fired 5 rapid notifications (`Error`, `Info`, `Success`, `Warning`, `Info`).
  - Verified live DOM count strictly capped at `visible.length === 2` (`队列 #1 (Error)` + `队列 #2 (Info)` rendered in `toast-seq-1-burst.png`), while the remaining `3` sit queued in telemetry.
  - Dismissing the visible `Info` toast automatically dequeued `#3 (Success)` while keeping `#1 (Error)` visible; `clear()` drained both active and queued entries cleanly.
