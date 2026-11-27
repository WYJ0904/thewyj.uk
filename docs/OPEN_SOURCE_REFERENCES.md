# Open-source references / 开源参考记录

This file records every time a public open-source project, sample, or algorithm
actually influenced a thewyj implementation, as required by the project rules.

Rules we follow:

1. Reading source, READMEs, issues, tests and architecture is always allowed.
2. We prefer to re-implement ideas against the existing thewyj architecture.
3. Whole files or modules must never be copied verbatim.
4. GPL / AGPL / SSPL and unclear licences are concept-only references; their
   code must not enter thewyj.
5. Apache-2.0 / MIT / BSD material may be reused only with the required
   attribution / NOTICE entries, recorded below.
6. References must never break existing thewyj APIs, data models, membership or
   Task 1–20 compatibility.

## Entry template

```
### <project name>
- Repository: <url>
- Commit / tag / version: <revision>
- Licence: <spdx or "unclear">
- Component / files consulted: <paths or APIs>
- Ideas used: <design concepts, state machines, algorithms, test approaches>
- thewyj implementation: <where we implemented it independently>
- Source code reused: yes/no (if yes: attribution/NOTICE handling)
```

## Entries

### Task 21 final closure (notification archive, payment recognition, corrections)

No external project source code was consulted or reused for this work. The
implementation was derived from the existing thewyj code, Android platform
documentation semantics (`NotificationListenerService`, `AccessibilityService`,
`SmsReceiver`, `Room`, `WorkManager`) and the Cloudflare Workers/D1/R2 runtime
behaviour observed in this repository. The Android and Cloudflare APIs used are
platform interfaces, not third-party source.

Therefore no attribution or NOTICE obligations were added for this release.
Future entries will be appended here whenever a real reference is used.

### Phase 6: File transfer UX & queue refactoring (2026-11)

- Projects consulted:
  - LocalSend (`https://github.com/localsend/localsend`, `Apache-2.0`, `app/lib/pages/send_page.dart`, `progress_page.dart`, `receive_page.dart`): sender vs recipient separation, per-file status actions, live byte/ETA breakdown without full-table jitter.
  - PairDrop (`https://github.com/schlagmichdoch/PairDrop`, `GPL-3.0`, live demo at `https://pairdrop.net/` & `public/scripts/ui.js`): **concept-only reference** (no GPL code enters thewyj); concise drop-ready landing and non-blocking verification dialog flow.
  - Uppy (`https://github.com/transloadit/uppy`, `MIT`, `@uppy/status-bar/src/StatusBarUI.tsx`, `@uppy/dashboard/src/components/FileItem/index.tsx`): explicit pre-processing / uploading / server-postprocessing (`confirming`) / complete pipeline distinctions.
  - FilePond (`https://github.com/pqina/filepond`, `MIT`, `src/js/app/view/item.js` & live demo at `https://pqina.nl/filepond/`): pre-queue validation without silent truncation, drop-state affordances, directory traversal.
- thewyj implementation: Independent vanilla HTML/CSS/ES module implementation across `index.html` (`#transferPage`, `#transferPasswordModal`), `js/transfer/app.js`, `design-system.css`, and `spatial-experience.css`.
- Source code reused: `no` (architecture and interaction patterns re-implemented independently; zero third-party source files copied).

