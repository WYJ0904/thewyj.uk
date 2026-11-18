# Aeris V6.3 — I02–I10 Handoff Notes

## What I01 Established
- Authoritative token layer (`design-system.css`) with Light/Dark parity, opaque semantic status soft surfaces, 3 density levels (`public`, `workspace`, `dense`), unified 3-tier radii (`6px`, `10px`, `14px`, plus `999px` pills), z-index hierarchy, and atomic theme switching (`js/core/design-system.js`).
- Single-row Desktop/Tablet shared topbar (`#accountBar`), grouped sticky sidebar (`#v3Sidebar`), synced version footer (`#v3SidebarVersion`), and crisp neutral 3-card hero stage without contour SVG noise or pastel gradients.

## Deferred for I02–I10 (Module-Level Scope)
1. **Home Deep Restructure (I02)**: Detailed below-the-fold capability showcase, logged-in home overview cards (`.home-v3-summary-grid`), and hero copy/CTA hierarchy remain ready for I02 without breaking the 3 floating card constraint.
2. **Legacy CSS Consolidation**: `styles.css`, `product-ui.css`, `public-experience.css`, `workspace-experience.css`, and `spatial-experience.css` still cascade over 6 files using `html[data-p07-ui="enabled"]` selectors (~591 rules). Future phases can gradually migrate individual module selectors into feature-scoped token rules once `p07_accessibility` flag rollout retires.
3. **Dense Module Internals**: Deep feature workflows inside `#languagePage`, `#toolsPanel`, `#transferPage`, `#adminPanel`, and Task 27–30 security dialogs already inherit I01 surfaces, inputs, borders, and error styling cleanly; workflow-specific information architecture belongs to later I-phases.
4. **Startup Security Reminder UX**: When `TASK27_SECURITY_ENABLED=true` opens `#siteMessageModal` ("完善账户安全") on first login of a fresh account without verified email/TOTP, it renders correctly on top of `#financePage`; deciding whether first-visit prompts defer from `/finance` entry is a product-flow choice outside I01.
