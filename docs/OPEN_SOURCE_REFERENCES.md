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
