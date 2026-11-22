# I04 -> I05 Handoff & Downstream Extension Contract

## 1. Delivered State on `hydrogen/i04-authenticated-workspace-redesign`
- Stage A (I03 CI blocker) fixed and green on `hydrogen/i03-public-pages-redesign` (`7f88e82bd5e482e70295f2ef8e0f1b4ce25c8d21`, CI Run `44672926000`).
- Authenticated Personal Workspace (`#authWorkspaceSection`) active on `/` and `/select` (`data-session-mode="authenticated"`), completely hidden for unauthenticated guests.
- Shared `js/core/motion.js` bug fixed in `attachSheetAdapter()`: removed mid-drag `setPointerCapture()` capture-swap + `lostpointercapture` race on touch pointers and moved pointer tracking to `doc` with `blur` cleanup, fixing mobile drawer swipe physics across both I04 and I07.

## 2. Preserved Contracts for I05 (Module Pages: `/language`, `/tools`, `/finance`, `/transfer`, `/account`, `/admin`)
- `#v3AppFrame`, `#v3Sidebar`, `#accountBar`, `.modal-layer` (`attachSheetAdapter`, `openModal`, `closeModal`), and `CORE_SHELL = 81` / `REQUIRED_SHELL = 89` invariants remain intact.
- **Toast System**: Do NOT modify `#versionNotice` or toast stacking in I05; leave unified toast repositioning/collision avoidance for **I09**.
- **Future Task 37 Integration Hook**:
  - When Task 37 adds new authenticated module capability/cards:
    1. Append the new module ID to `WORKSPACE_MODULE_IDS` & `WORKSPACE_MODULE_META` in `js/core/home-widget-layout.js` (existing user layouts upgrade seamlessly via `sanitizeWorkspaceBento()` without losing saved order).
    2. Mount optional secondary Task 37 panels cleanly into `#workspaceExtensionSlot[data-workspace-extension-slot="task37"]` without changing `#workspaceBentoGrid`'s 2-col Comfortable / 1-col Compact contract.
- **Physical Android WebView Check Pending**: Schedule WebView Back/Forward, `/select` native tab restoration, and swipe drawer feel testing on physical Android device before production release promotion.
