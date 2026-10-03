# P3.2 Task 19 / P2 card restoration

The owner rejected the P3 initial closure and P3.1 visual/product acceptance.
P3.1 recovered text and routes but replaced the accepted card composition with
equal scene grids and capability link rows. That assessment was insufficient.
Historical closure reports remain available; their technical PASS does not
supersede the owner's FAIL.

## Authoritative visual source

- `qa/TASK19_DESIGN_AUDIT.md`, `qa/TASK19_FULL_SITE_UI_AUDIT.md`,
  `docs/DESIGN_SYSTEM_2.md`: public brand stage and expanding Card/Accordion
  gallery, five readable capability triggers, product previews, keyboard support.
- Exact P2 baseline `b8c1715e5d5c5069de162c1b35a737548bdcb29a`:
  `index.html` and `public-experience.css`.
- Starting clean main `c54008d860e7e30baf786d7891daef0de1e6ad42`.

P3 branding is a brand substitution and compatibility upgrade. Conflicting
P3/P3.1 design conclusions are superseded by Task 19 and the P2 baseline.

## Direct restoration

The hero and gallery DOM were extracted from that exact P2 commit, rather than
redesigned. The original P2 CSS through its final responsive rule remains
unchanged except narrowly documented reflow compatibility rules. The broad
P3 public-home width override is removed, restoring the P2 stage and 1200px
content composition.

- `public-hero`, `public-hero-scene`, `hero-scene-card`, learning/finance/tools
  positioned scene cards retain the original desktop offsets and rotations.
- `capability-gallery`, `capability-panel`, `capability-trigger`,
  `capability-body`, `capability-copy`: active panel spans two columns and two
  rows at desktop; narrow viewports use the original stacked disclosure cards.
- All five `product-preview` variants and their `preview-*` structures return:
  Japanese question/feedback, searchable tool grid, ledger/transaction/budget,
  file/link/expiry/downloads, and account/sync/entitlements/recent update.
- Removed P3.1 `aeris-scene-grid`, `aeris-scene-card`, `aeris-capability-list`,
  `aeris-capability-link`, and associated substitute CSS.

## Minimal compatibility changes

Aeris name and official logo replace the former brand. SplitFlap stays absent;
its space contains static copy. All examples are explicitly demonstrations;
the account preview does not represent the current user. Existing handlers own
every feature entry. Gallery state controls disclosure only. Native buttons
support click/tap/Enter/Space, focus selection, arrows/Home/End; hover provides
only supplemental styling. Body IDs are distinct from the retained P3 Product
Window, with no duplicate learning or finance state owner.

The P3 Product Window remains an additional local interactive section. Live
membership catalog, privacy, plans, final CTA, Launchpad, session/deep links,
Android 1.3.27/code40, brand assets, upload watchdog, and CI staging remain.
Only a cache release token changes in unrelated frontend modules.

## Acceptance evidence

The visual restoration gate requires actual 1366px screenshots of exact P2 and
P3.2, manual inspection of the scene composition and expanded previews, and
geometry assertions. Text, route and section counts are not sufficient.
CI adds restoration coverage without reducing existing CLS, runtime, upload,
storage, authentication or security assertions. The prior static assertion
forbidding public hero cards is replaced by explicit P2 restoration assertions;
the signed-in Launchpad still has no marketing scene cards.

Final visual/CI/Production results are recorded in the P3.2 Closure Report.
This phase does not authorize or implement P4.

The actual 1366px browser comparison measured the same 1200px gallery, three
392px tracks, and 796px two-column active card in P2 and P3.2. Learning card
height is 525.04px in both; tools, finance, share and account are 520px in both.
All five restored previews were opened and visually inspected. The account
preview has a small content-height difference from the explicit demo label and
honest account wording; its outer card composition and width remain intact.
The local matrix records actual innerWidth for every width/theme/preview case.
The CUA window clamps below 240px; exact 160/195px layouts are checked separately
in CI with explicit viewport assertions and preview-clipping checks. A 240px
manual probe caught the budget's minimum track overriding the compatibility
rule; placing compatibility after the unchanged P2 CSS resolves the clipping.
The retained
Product Window produced nine Unicode characters/two lines, a 69.99 local
balance, answer feedback, and an owned file-list preview without uploading.
