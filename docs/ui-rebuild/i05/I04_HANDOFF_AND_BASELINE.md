# I04 -> I05 Handoff & Verified Baseline

## 1. Upstream Git Baseline Verification
- **Base Branch**: `hydrogen/i04-authenticated-workspace-redesign`
- **Verified Base Commit SHA**: `b5ebd1dadb523e442166be6dde7518f19ef9e5ef`
- **Upstream PR**: `#166` (Draft / Open; not merged into `main`, not released to Production).
- **Upstream Core CI**: GitHub Actions Run `44686649073` (`success`).
- **Predecessor PR (`#165` / I03)**: Draft / Open on `hydrogen/i03-public-pages-redesign`, Core CI green.
- **Isolated I05 Worktree**: Created `hydrogen/i05-workspace-admin-density` in `workspace_admin_density` strictly from `b5ebd1dadb523e442166be6dde7518f19ef9e5ef` (not from `main`, I03, or I07).

## 2. Preserved I04 Contracts
Honoring `docs/ui-rebuild/i04/I05_HANDOFF.md`, I05 preserved every verified I04 personal workspace invariant:
1. **`/select` Personal Workspace (`#authWorkspaceSection`)**:
   - Preserved 6 persistent `<article data-workspace-card>` Bento modules (`learning`, `finance`, `tools`, `transfer`, `activity`, `account`).
   - Preserved Comfortable 2-column vs Compact 1-column horizontal strip density toggle.
   - Preserved bidirectional FLIP ordering (`↑`/`↓`), pointer drag sort, Escape cancel, hide/restore/all-hidden empty state, reset/undo bar, `#workspaceDetailModal` (desktop spring modal / mobile bottom drawer), and `#workspaceExtensionSlot[data-workspace-extension-slot="task37"]`.
2. **Storage Schema Integrity**:
   - Key `aerisHomeWidgets:v2:<owner>` and schema in `js/core/home-widget-layout.js` left completely unmodified; only shell framing around `#authWorkspaceSection` (grouped sidebar, sticky `#workspaceBreadcrumb`, console container width, button/radius token alignment) was unified.
3. **PWA & Degradation Contract**:
   - `sw.js` array lengths preserved at `CORE_SHELL = 81`, `REQUIRED_SHELL = 89`, `INSTALL_SHELL = 89`.
   - `js/core/motion.js` and `#versionNotice` / toast queue untouched (reserved for I07 baseline + I09 toast unification).
   - Public `/` guest homepage Hero/Bento/3D preview untouched (`regression` suite `qa/i03/browser-acceptance.mjs` passes after I05 commits).
4. **Workspace Boundaries**:
   - Did not touch `访问口令.txt`, Android Hotfix branches/checkouts, Production D1 (`11c288d8-c584-409f-bb1f-7e7af11793e5`), Production R2, or PRs `#162–#166`.
