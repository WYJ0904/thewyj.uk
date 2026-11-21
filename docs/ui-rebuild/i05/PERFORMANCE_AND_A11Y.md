# Accessibility, Motion & Runtime Performance (`I05`)

## 1. Automated `axe-core` Audit Results

### Local Miniflare Suite (`m_axe_a11y_and_runtime_clean`)
All 7 authenticated routes audited under desktop `1440×900` light theme:

| Route | Passing Rules | Minor / Moderate Violations | Serious / Critical Violations |
|---|---|---|---|
| `home` (`/select`) | `45` | `0` | `0` |
| `language` (`/language`) | `42` | `0` | `0` |
| `tools` (`/tools`) | `46` | `0` | `0` |
| `finance` (`/finance`) | `46` | `0` | `0` |
| `transfer` (`/transfer`) | `47` | `0` | `0` |
| `account` (`/account`) | `46` | `0` | `0` |
| `admin` (`/admin`) | `50` | `0` | `0` |

### Live Hosted Preview (`i05-preview-verify.json`)
- `preview-1440-select`: `45` passes, `0` serious/critical violations
- `preview-1440-account`: `45` passes, `0` serious/critical violations *(note: an earlier preview test run once caught a transient `color-contrast` flag on `#v3SidebarAdminLink > span:nth-child(2)` right after clicking away from `/admin`; re-verification passed cleanly, and tightening inactive sidebar muted ink contrast or transition timing is recorded in [`RISKS_AND_ROLLBACK.md`](./RISKS_AND_ROLLBACK.md))*
- `preview-1440-finance`: `45` passes, `0` serious/critical violations
- `preview-1440-admin`: `49` passes, `0` serious/critical violations
- `preview-390-admin`: `49` passes, `0` serious/critical violations
- `preview-390-select`: `45` passes, `0` serious/critical violations

## 2. Keyboard Focus, Reduced Motion & Runtime Cleanliness
- **Search & Filter Focus Preservation**: `#toolSearchInput` kept `document.activeElement.id === "toolSearchInput"` through live filtering (`c_tools_search_and_workbench`).
- **Modal Focus Restoration**: Closing `#financeTransactionModal` cleanly restored keyboard focus to `#financeAddTransactionBtn` (`d_finance_filters_modal_tabular_mobile`).
- **`prefers-reduced-motion: reduce`**: `#financeTransactionModal` opened and closed cleanly (`reducedMotionOperable: true`) with zero stuck animations (`j_reduced_motion`).
- **Runtime & Network Hygiene**: Both local (`i05-acceptance-report.json`) and Live Preview (`i05-preview-verify.json`) recorded `runtimeErrors: []` (`0` uncaught JS/console errors) and `apiErrors: []` (`0` unexpected 5xx API failures).
