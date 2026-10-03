# Notification / Finance local auto-booking hotfix

This is a post-P3 regression fix. Public Home composition, branding, native package, authentication, and P1/P2 interaction contracts remain in place.

## Root causes established in code

- Complete local recognition was always staged as `FINANCE_PENDING_CONFIRMATION`; only a remote receipt or manual confirmation closed it. Offline/recovered recognition had no durable local Finance transaction.
- Recovery presentation used a cloud-only pending set alongside independent Room recovery rows. Complete recovered money could therefore appear as a confirmation task while Finance reported zero pending.
- Android dispatched `thewyj:payment-updated` on `window`, while Finance subscribed on `document`.
- The pending summary returned hints/candidates, but omitted exact receipts for automatic transactions that never had either review row. A successful cloud booking could not repair that local linkage through the pull path.
- Generic payment-channel titles could incorrectly supply an expense direction for an amount-only message.

## State and identity

`recognized → amount + direction complete → Room transaction + recognition recorded + candidate confirmed + archive linked → durable upload → cloud receipt → synced`

Missing amount or direction remains a review. Merchant, category, note, confidence, transport failure, and missing upload IDs do not gate local booking. Accepted OCR/accessibility evidence uses the same completeness rule; unrelated or ambiguous OCR remains outside recognition.

Room schema 9 adds an account/event keyed local transaction and outbox record. The local transaction, recognition, candidate, and archive closure are committed together. Recovery re-evaluates legacy evidence and repairs exact archive identities. It preserves existing archive/cloud transaction receipts. No amount/time similarity heuristic is used to deduplicate payments.

New automatic transaction IDs are deterministic from account + stable event ID. Existing server IDs remain authoritative. The existing Finance controller projects the native ledger into its existing account-scoped cache and removes provisional IDs when a legacy receipt resolves them. Server ledger reads include exact notification event links so an already cached cloud booking cannot become a second provisional entry.

An HTTP success without a transaction receipt cannot acknowledge a local booking. Receipt persistence precedes queue removal. Incomplete local reviews and cloud reviews form an identity union; complete booked transactions are excluded from that review set.

## Validation

- Room tests cover WeChat expense without merchant, Alipay expense, income, missing money fields, complete OCR evidence, old recovery, concurrent recovery, offline upload, missing receipt, reconnect, pipeline recreation, and duplicate notification replay.
- JavaScript tests cover local Finance projection, exact old cloud links, account isolation, restart serialization, receipt remapping, deleted-record non-resurrection, and review identity union.
- D1 suites retain privacy rejection, membership/account isolation, automatic booking, hint convergence, candidate corrections, provider reference deduplication, and replay coverage. A new assertion verifies automatic booking receipts with no hint/candidate.
- Existing migration tests validate all historical schema paths through schema 9; no destructive fallback is used.
- Core CI includes the new projection regression test in addition to the existing suites.

## Physical-device gate

Physical acceptance is a separate gate. At implementation time, SDK ADB and mDNS returned no device, and Windows exposed no Samsung USB/ADB/MTP interface. Unit tests and desktop Production checks are software evidence and must not be represented as physical-device results. In-place installation, force-stop/restart, system test notifications and device UI verification remain `BLOCKED BY DEVICE CONNECTION / UNVALIDATED` until a transport is available.
