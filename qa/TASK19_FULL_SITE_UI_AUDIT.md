# Task 19 Full-Site UI/UX Audit

## Scope and evidence

This audit is based on the current `main` baseline at
`fbdb6feccde2b9833a1a00e3db3678e5f9033a3e`, source inspection, and an
isolated Cloudflare Pages + D1 + R2 browser session at desktop and 390 px
mobile widths. No Production data or credentials are used.

Status meanings:

- **Complete**: route has the current product language and a coherent layout.
- **Partial**: current components exist, but hierarchy, responsiveness, or theme support is incomplete.
- **Token-only**: semantic variables are present while visible layout remains legacy.
- **Legacy**: route still visibly belongs to the pre-Design-System interface.

## Route matrix

| Route / surface | Baseline | Main finding | Task 19 remediation gate |
| --- | --- | --- | --- |
| `/` | Partial | Strong brand start, but mobile scene cards overlap the hero; version notice obscures content; light sections do not continue the stage language | Recompose hero at 390 px, redesign capability gallery, keep one restrained brand motion, theme the entire page |
| Global navigation | Partial | Card navigation works, but has no appearance control and consumes too much mobile chrome | Shared theme control, compact mobile disclosure, stable focus and escape behavior |
| `/login`, `/register` | Token-only | Accessible forms, but generic panel composition and update notice compete with account task | Focused account shell, useful trust context, no blocking notice |
| `/trial` | Partial | Functionally complete; repeated cards and form sections lack visual rhythm | Preserve all five trials, improve navigation, result states, and mobile flow |
| `/changelog` | Partial | Structured data works, but page reads as an unstructured card list | Editorial timeline, clear release categories, current-version marker |
| `/select` | Partial | Four equal entry cards and stacked dashboard cards make every item equally loud | Unified Workspace Entry with one primary resume area, compact module rail, overview strip, and purposeful secondary panels |
| `/language` | Partial | Language choice works, but remains an isolated picker | Bring into shared workspace shell and explain each learning path without adding marketing copy |
| `/language/english` | Legacy | Old `WYJ的网站` heading, separate topbar, horizontal tab scrollbar at 390 px | Shared workspace header, compact accessible tabs, complete quiz/wrong/history/stat states |
| `/language/japanese` | Legacy | Same shell split as English; dense controls need responsive regrouping | Same component contract as English while preserving furigana and judge behavior |
| `/tools` | Partial | 103 tools remain visible, but category cards and tool cards repeat the same weight | Search-led workspace, compact categories, scannable catalog, no tool loss |
| `/tools/:tool_id` | Token-only | Shared fields use tokens, while individual tools have inconsistent spacing and action placement | Unified tool workbench, output/status region, mobile action order |
| `/tools/workflows` | Token-only | Functional editor, but visually detached from catalog | Shared tool shell and step hierarchy; preserve all workflow behavior |
| `/share/:type/:id` | Token-only | Functional viewer is a generic modal-like panel | Trustworthy share document with clear state, expiry, password, and download hierarchy |
| `/finance` | Partial | Functional and readable, but summary cards are oversized on mobile and filters are a long form | Dense ledger workspace, compact metrics, adaptive filters, preserved sync/conflict/tombstone behavior |
| `/account` | Token-only | Full feature modal, but long-form actions have weak section hierarchy | Account settings sheet/page with clear security, sessions, sync, and destructive zone |
| `/recharge` | Partial | Correct flow, but six tall goal cards make the mobile modal excessively long | Compact goal selector, comparison-ready plans, stable order/payment/QR states |
| `/admin` | Partial | All Task 18 tabs exist; users are fetched up to 1000 and filtered only in the browser | Server-side exact/partial search, pagination, minimal list payload, clear role boundary and owner protection |
| Confirmation/result dialogs | Partial | Semantically functional but appearance is not fully theme-aware | One dialog state system with stable scroll, focus, and readable mobile actions |
| Loading/empty/error/success | Token-only | Tokens exist, but pages use several unrelated patterns | Shared state composition and consistent status language |

## Reference responsibilities

- **Vesper**: public brand-stage hierarchy, disciplined type, whitespace, and a
  restrained premium first impression. Its branding, copy, logo, and layout are
  not copied.
- **Superr**: calm product-workspace density, warm neutral canvas, matte
  surfaces, clear spacing, and low-fatigue controls. Its photography and brand
  motifs are not copied.
- **SaaSFrame**: reference for mature SaaS information architecture across
  dashboards, settings, billing, tables, and authentication, not a visual skin.
- **CardNav**: structure only. The project keeps native CSS/JavaScript and does
  not add GSAP.
- **SplitFlapText**: one signature motion in the public hero only.
- **AccordionGallery**: interaction model only. Every inactive capability must
  retain a readable title and description at desktop and touch sizes.

## Design direction

The final visual language is precise, calm, and product-led: near-black public
stage, warm neutral workspace, one blue brand action, readable semantic state
colors, low elevation, and deliberate typography. Public and authenticated
surfaces use different canvases but share typography, spacing, radius, focus,
motion, and state contracts.

The public page order is: navigation, hero with one signature word transition,
core capability gallery, privacy/local-processing proof, product workflow,
membership choices, and changelog entry. The authenticated home is not a
marketing page: it prioritizes resume/continue, module shortcuts, today's
summary, recent tools, finance, service health, and updates.

## Architecture and Android parity

`design-system.css` remains the canonical semantic layer. It defines primitive
scales and separate light/dark assignments. Page CSS consumes semantic tokens;
it must not invent parallel color systems. Component states map directly to
future Android tokens: canvas/surface/elevated, primary/on-primary,
success/warning/error/info, focus, disabled, pressed, and destructive.

No framework, animation library, remote font, or icon package is added. SVG
icons remain inline and decorative SVGs stay hidden from assistive technology.

## Main regression risks

1. Legacy CSS specificity overriding semantic themes.
2. Route visibility changes breaking browser-history restoration.
3. Responsive tab and modal changes hiding controls.
4. Admin pagination starving message and role selectors of users.
5. Service Worker serving an incomplete or stale style asset set.
6. UI simplification accidentally reducing the 103-tool catalog or payment flow.

The release gate therefore includes static asset/staging checks, all existing
business tests, Task 18 role/message tests, tool catalog coverage, desktop and
390 px light/dark screenshots, keyboard/focus checks, and a full route walk.

## Implemented remediation

- `design-system.css` now owns the light/dark semantic assignments, typography,
  spacing, radii, elevation, focus, disabled, status, and motion contracts.
- The public experience uses the dark brand stage, one hero split-flap motion,
  a touch-safe five-capability gallery, compact card navigation, and a visible
  continuation below the first viewport. Reduced motion disables the signature
  movement without hiding content.
- The authenticated workspace uses the warm neutral canvas and a new asymmetric
  launchpad. Learning is the primary lane; tools and finance remain immediately
  available without turning the dashboard into a marketing page.
- English, Japanese, tools, workflows, sharing, finance, membership, account,
  and administrator routes now share the same workspace header, surfaces,
  controls, dialogs, status language, and responsive rules.
- The tools catalog remains complete at 103 entries. Fuzzy search, category
  browsing, every tool mode, and all workflow capabilities remain available.
- Share-viewer success, information, and failure results use semantic states
  instead of presenting successful reads as errors.
- The Service Worker registers on local and deployed same-origin environments.
  Versioned shell assets and activation cleanup now own cache freshness, so PWA
  validation is not bypassed during local browser tests.

## Administrator search contract

`GET /api/admin/users` now supports server-side `q`, `match`, `page`, and
`limit` parameters on both Cloudflare D1 and the rollback Python backend.
Queries are parameter-bound, wildcard characters are treated literally, and
list responses expose only the fields needed by the administrator UI. Exact
and partial modes, total count, and `has_more` are returned by the server.

The user list, message target picker, and role-grant selector each use bounded,
debounced server requests. Sequence guards discard stale responses. The main
user list is cleared as soon as a new query starts so a fast click cannot open
the previous user's editor while the new query is pending.

## Defects found during the final browser gate

| Finding | Root cause | Resolution |
| --- | --- | --- |
| Local PWA readiness timed out | Task 19 temporarily unregistered every local Service Worker | Restored same-origin registration and retained versioned cache eviction |
| Modern CSS colors produced false contrast failures | The browser returned `color(srgb ...)`, while the independent audit treated 0-1 channels as 0-255 | Added explicit sRGB parsing to the browser audit |
| Learning-lane helper text measured 4.01:1 | A parent opacity reduced otherwise readable brand-on-dark text | Removed opacity-based hierarchy; the final text passes AA |
| Fast administrator searches could edit the previous result | The old card stayed interactive during debounce, and late responses could overwrite newer searches | Added immediate loading state, stale-response sequencing, and username-matched browser regression coverage |
| Legacy dashboard browser assertion failed | The test still expected the removed equal-card grid | Updated it to assert the new four-card mobile stack and two-lane desktop launchpad |
| Existing clients could delay the remediated Service Worker update | The registration URL reused the unchanged product version while shell assets used the new release token | Separated `ASSET_RELEASE` from `APP_VERSION` and versioned the Service Worker registration with the release token |

## Final local validation

All data used below is isolated under `.tool-e2e`; no Production resource,
credential, user, order, or payment asset was read or modified.

| Gate | Result |
| --- | --- |
| Python backend and API | 180/180 passed |
| Migration/readiness tools | 40/40 passed |
| JavaScript/module/storage/functional integration | Passed through Task 18; 103 tools, 51 modes, 12 workflow capabilities, 27 workflow flows covered |
| Application browser matrix | 22/22 passed; desktop, 360/390/430 px mobile, reduced motion, learning A-H, finance, payment, membership, admin, offline/reconnect |
| Cloud-only browser | 8/8 passed; canonical D1 session, PWA reload, PDF, offline/reconnect, zero legacy requests |
| Task 18 browser | 5/5 passed at 390x844; messages, receipts, owner/admin boundary, bulk confirmation |
| Full toolbox browser | 29 text, 17 file, 30 image, 22 random, 5 temporary groups passed; 86 downloads; no runtime errors |
| Cloudflare build | Pages Functions compiled; Preview types generated |
| Fresh D1 | Migrations `0001` through `0014` applied; no pending migration |
| Pages staging | All four Design System 2.0 CSS resources present with source-identical SHA-256 hashes |
| Repository audit | 207 tracked and candidate paths passed the sensitive-file audit |

The manual visual walk covered public, account, dashboard, language, tools,
workflow, share, finance, recharge, and administrator surfaces in light and
dark themes at desktop and 390x844. Final contrast scans reported no visible
text violations, no horizontal overflow, and no browser runtime errors.

Preview deployment and GitHub Core CI remain the final pull-request gates. Task
19 stays Draft until those gates pass and the user completes visual review.
