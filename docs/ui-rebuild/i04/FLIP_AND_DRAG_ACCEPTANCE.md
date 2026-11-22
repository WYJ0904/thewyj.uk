# I04 Bidirectional FLIP & Drag/Keyboard Sorting Acceptance

## 1. Shared Engine Reuse & DOM Identity Guarantee
- Reuses I07 `captureFlipSnapshot()`, `playFlipSnapshot()`, `flipLayout()`, and `createDragSortController()` directly from `js/core/motion.js` inside `js/core/home-widgets.js`.
- Card reordering moves existing persistent `<article data-workspace-card="<id>">` nodes inside `#workspaceBentoGrid` via `grid.appendChild(card)` / `grid.insertBefore(...)` — never rebuilding `grid.innerHTML`.

## 2. Observed Real-Chrome Verification (`Chrome/157.0.8103.79`)
Recorded in `docs/ui-rebuild/i04/evidence/i04-browser-acceptance.json`:

1. **Bidirectional `↓` & `↑` FLIP**:
   - Clicking `↓` on `finance` updated visible order from `["learning","finance","tools","transfer","activity","account"]` to `["learning","tools","finance","transfer","activity","account"]`.
   - Observed 2 WAAPI FLIP animations (`300ms`):
     - `tools`: `translate3d(-575.50px, 236.92px, 0) -> translate3d(0, 0, 0)`
     - `finance`: `translate3d(575.50px, -236.92px, 0) -> translate3d(0, 0, 0)`
   - Clicking `↑` on `finance` returned order cleanly (`flipsCount: 2`), `identityPreserved: true` across all 6 cards, and keyboard focus remained on `finance`'s move control (`focusCard: "finance"`).
   - Edge protection: when moving a card into index `0` (`↑` becomes disabled) or last index (`↓` becomes disabled), focus transfers gracefully to the sibling action button or drag handle of the same card instead of dropping to `document.body`.
2. **Keyboard Arrow Sorting & Live Announcements**:
   - Focusing `[data-workspace-drag-handle]` on `learning` and pressing `ArrowDown` moved `learning` to position 2 (`["finance","learning",...]`), retained focus on `[data-workspace-drag-handle]` (`activeIsHandle: true`), and updated `#workspaceLiveRegion` (`"语言学习已移动到第 2 位"`).
3. **Pointer Drag & Mid-Drag `Escape` Cancel**:
   - Dragging `finance`'s handle toward `tools` moved the card smoothly; pressing `Escape` mid-drag cancelled the gesture, restored `["finance","learning",...]`, and left `residualTransforms: 0`.
   - Committing a full pointer drag from `finance` to `tools` updated order to `["learning","tools","finance",...]` with `identityPreserved: true`, `residualTransforms: 0`, and `saveState: "dirty"`.
   - `window.blur` listener cancels active drags cleanly; route transitions invoke `dashboardView.hide()` / `dragSort.cancel()`.
4. **Density Switch FLIP**:
   - Toggling `#workspaceDensityBtn` transitions `comfortable` (`cols: 2`, `avgH: 226px`) <-> `compact` (`cols: 1` horizontal strip, `avgH: 120px`) via `playFlipSnapshot(..., { scale: true, duration: 340 })`.
5. **Touch Scroll Safety**:
   - `.workspace-bento-card` keeps `touch-action: pan-y`; only `[data-workspace-drag-handle]` uses `touch-action: none` in Edit Mode so normal scrolling on cards never triggers accidental drag captures.
