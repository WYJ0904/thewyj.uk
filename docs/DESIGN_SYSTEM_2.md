# thewyj Design System 2.0

`design-system.css` is the canonical Web token and component-state source. `product-ui.css` remains a compatibility/layout layer for existing feature pages; `public-experience.css` contains only the public brand stage and its navigation/capability interactions.

## Foundations

- Typography: system sans for product UI; system serif only for rare public editorial emphasis; Cascadia/Consolas for identifiers and split-flap motion.
- Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, and 80 px.
- Shape: 4/6/8 px controls and cards, 12 px dialogs, pill only for compact badges.
- Touch: interactive controls are at least 44 px high.
- Containers: 760 px reading, 1200 px standard, 1440 px dense workspace.
- Motion: 80/140/200/260 ms with standard and emphasized easing. Reduced motion collapses transitions and animations to 1 ms.
- Contrast: body `#18212f`, secondary `#475569`, muted `#64748b`; disabled text remains readable and never relies on opacity.

## Semantic Color Contract

| Role | Web token | Android role |
| --- | --- | --- |
| Workspace canvas | `--ds-workspace-canvas` | `background` |
| Warm workspace canvas | `--ds-workspace-canvas-warm` | `surfaceContainerLowest` |
| Primary surface | `--ds-surface` | `surface` |
| Primary text | `--ds-text` | `onSurface` |
| Secondary text | `--ds-text-secondary` | `onSurfaceVariant` |
| Brand action | `--ds-brand` | `primary` |
| On-brand text | `--ds-on-brand` | `onPrimary` |
| Success/warning/error | `--ds-success`, `--ds-warning`, `--ds-error` | app semantic colors |
| Public stage | `--ds-stage` | branded dark surface |
| Focus | `--ds-focus`, `--ds-focus-ring` | focus indicator |

## Component States

Every shared control defines default, hover, focus-visible, pressed, disabled, loading, error, success, warning, and destructive states. Status meaning is always expressed by text or icon as well as color. Dialogs preserve page scroll and remain within the safe-area-adjusted viewport.

Buttons use primary, secondary, ghost, and destructive variants. Inputs, selects, search fields, cards, dialogs, tabs, tables/lists, badges, empty states, loading skeletons, and semantic feedback share the same tokens rather than page-local values.

## Responsive Contract

- `> 980px`: standard/wide workspace and horizontal capability gallery.
- `761-980px`: compact workspace and stacked capability gallery.
- `<= 760px`: single-column flows, bottom-aligned dialogs, and touch-first navigation.
- `<= 420px`: compact header actions and full-width Hero CTAs.

No component may require hover to reveal its only action. Data tables must switch to an intentional list/card representation when their columns cannot remain operable; they must not be squeezed into unreadable horizontal layouts.

## Android Mapping

Task 20 should map these tokens into Compose `ColorScheme`, `Typography`, `Shapes`, dimensions, and motion specs rather than recreating default Material widgets independently. The Web primary/secondary/ghost/destructive buttons map to four explicit Compose button styles. Fields retain 44 px minimum height, 8 px shape, inline errors, and the same focus/error semantics. Empty/loading/error/success states must use the same labels and hierarchy.

The dark public stage is a branded destination, not a global dark theme. Authenticated Android screens should use the neutral workspace surfaces by default, matching the Web information density and touch behavior.
