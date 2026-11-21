# Design Tokens & Component Unification (`I05`)

## 1. `--ds-*` Token Alignment
I05 consumes I02's token catalog (`design-system.css`) with zero un-tokenized color sprawl:
- **Container & Rhythm**: Added `--ds-container-console: 1320px` in `design-system.css` and consumed across `.auth-workspace-shell` (`workspace-experience.css`) and all authenticated route panels (`spatial-experience.css`).
- **Radius Normalization (`4–8px`)**: Audited and replaced `25` hardcoded card/panel `border-radius` declarations (`10px`, `12px`, `14px`, `16px`, `18px`, `20px`) in `spatial-experience.css` with `--ds-radius-lg` (`8px`), `--ds-radius-md` (`6px`), and `--ds-radius-sm` (`4px`). Verified at runtime across all 7 routes (`probe.maxRadius <= 8.5` in `qa/i05/browser-acceptance.mjs`).
- **Tabular Numerals (`font-variant-numeric: tabular-nums`)**: Expanded `design-system.css` tabular-numeric utility rules to cover `#financeIncomeTotal`, KPI values (`#adminKpiUsers`, `#adminKpiRecharge`, `#adminKpiAudit`, `#adminKpiLoginFailed`), audit/login rows, `.account-detail-grid`, quota meters, dates, and SHA-256 hashes. Verified computed `tabular-nums` in `d_finance_filters_modal_tabular_mobile`.

## 2. CSS Discipline & Cascade Hygiene
- **Zero `!important` Policy**: Verified via `local-backend/test_i05_workspace_shell.mjs` that the entire `I05 Workspace Console Layer` in `spatial-experience.css` contains **0** `!important` declarations.
- **No Undefined Tokens**: Validated via `local-backend/test_i02_css_contracts.mjs` (`6/6 PASS`) alongside full style contrast tokens for both `light` (`#111113` primary CTA dark background / white text) and `dark` (`#F8FAFC` primary CTA light background / dark text) modes.
- **Checkbox / Toggle Guard**: Preserved native geometry of `#featureFlagEnabled` and `#featureFlagKillSwitch` (`20×20px`, below the `24px` cap guarded in `qa/i05/browser-acceptance.mjs` pending I08 global switch/checkbox styling).

## 3. Shared Console Component Primitives Added in I05
- **`.v3-sidebar-group-title`**: Uppercase/muted section headers grouping navigation rails cleanly without excessive borders.
- **`.workspace-breadcrumb`**: Sticky single-line path strip with subtle chevron separators, active page high-contrast emphasis (`aria-current="page"`), and full `P07 OFF` suppression.
- **`.admin-kpi-strip` & `.admin-kpi-cell`**: 4-column desktop (`2×2` tablet/mobile) unified grid sharing 1px internal hairlines instead of 4 detached heavy shadow cards; displays `—` until real API telemetry hydrates via `setAdminKpi()`.
- **`.admin-list-head`**: High-density column headers paired cleanly with `.admin-item` rows for scanability; cleanly `display: none` in `styles.css` (pre-P07 / fallback CSS).
- **`.account-settings-list`**: Samsung One UI inspired single-container grouped action rows separated by subtle 1px dividers for `/account` security, encrypted backup, and privacy centers.
