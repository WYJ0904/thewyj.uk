# P3 Brand & Public Experience audit

Base main: `b8c1715e5d5c5069de162c1b35a737548bdcb29a`. Remote main, clean tree, P2 merged PRs #83/#84, all six final CI jobs and physical Samsung evidence were checked again. P2 motion, tab convergence, stable notification identity, local optimistic rollback, latest navigation and IO queue safeguards remain the baseline.

The earlier Experience Pass branch is already an ancestor of main. P3 uses a fresh scoped branch from this verified main.

| Surface before edits | Finding | P3 scope |
| --- | --- | --- |
| Web header/auth/recovery/title | Main visible brand remains thewyj, old icon and alt/aria labels. | Aeris display text and shared official assets; retain DOM compatibility IDs. |
| Manifest/favicon | WYJ short name, two legacy PNGs, no maskable/Apple/OG system. | Aeris metadata and platform derivatives with cache invalidation. |
| Public Home | SplitFlap timer, floating cards, fake balances and screenshots, hover accordion, marketing sections. | Compact entry with visible Login/Register/Download and four real local Product Window interactions; static panel DOM and P2 feedback. |
| Signed-in home | Repeated marketing hero and floating finance/learning scene. Existing learning, recent tools, finance and account summaries already exist. | Personal Launchpad using those exact owners, plus local transfer summary and existing pending count; honest empty/local error states. No new backend. |
| Android | One drawable-nodpi launcher PNG, visible old name; no adaptive/monochrome/density icon structure or explicit system splash brand. | Same package/signature, normal icon resource variants and source-derived monochrome; branded static splash, no extended delay. |
| Notification icon | Audit independent from launcher. | White alpha small icon derived from the official mark; never reuse coloured launcher as small icon. |
| Technical identity | Domain, package, schemes, bridge events, storage IDs, classes and database names carry old spelling. | Preserve; no mechanical rename. |

Official source: user-attached `极简蓝色气流字标「Aeris」.png`, readable at the exact Desktop path. Keep source bytes and hash. Derivatives only crop the existing monogram for platform icons, preserve its ratio/colours, resize and add safety padding. A one-colour alpha mask is the required platform monochrome representation, not a new drawing. Full logo retains the supplied artwork. Small marks use a white backing in both themes where needed to preserve original dark ink contrast.

Validation: three viewport widths × light/dark, keyboard/touch parity, live preview state, unchanged panel identity, local failures, metadata/icon masks and payload budgets; signed in-place Android upgrade and account/device-session fingerprints; P1/P2 motion/navigation/lifecycle regression. Production and candidate identities will be recorded separately. P4 is excluded.
