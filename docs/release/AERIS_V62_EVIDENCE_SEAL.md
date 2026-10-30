# Aeris V6.2 local evidence seal — 2026-10-30

Primary final manifest: `docs/migration-evidence/aeris-p03-p07/v62-evidence-seal-20261030-r2/manifest.json`.

SHA-256: `3baa01df26245b66953fc6d9770fd185c7a9e8f88c550053c3b00a92e36736d6`.

The immutable local manifest hashes1,163 evidence files and20 working source/report files.4,886 live/private/runtime/cache entries are explicitly excluded; this is not a whole-disk or whole-credential backup. Excluded content was neither published nor included in Pages staging. The20-file source set intentionally excludes this descriptor and the later Git delivery receipt to avoid a fabricated self-referential hash. Necessary existing backup archives and their raw failure evidence are retained. The separate historical protection audit covers6,135 entries in five inherited manifests, not added to this1,163-file count as unique files. The prior1,160-file r1 snapshot remains unchanged and is included as historical evidence in r2.

Runtime implementation commit remains `80139a03b5b655b4f4d7ba4e865778c7654bb91d`, owned deployment `ac8cec2c-24ba-4e75-9e8d-4d6be71f4648`. Its147 allowlisted inputs/87 public files are unchanged by the accompanying QA/report commit. Production is independently `c4d63fa2fb8181a368826db034017fbdabd6ce6f` / `55b78a0f-8419-4054-b9c2-3ffc26da3f20`; main CI10/10 and85 public-file proof are separate evidence.

The final Git delivery receipt records the exact accompanying commit, unchanged147 runtime-input comparison, and SHA-256 of any supplementary post-seal readbacks, including the explicit two-package absence confirmation. It does not rewrite or silently expand the frozen primary manifest. No source, historical evidence or formal data was removed by sealing.

Review login is retained only in the ignored local `private/OWNER_PREVIEW_ACCESS.md`. It is an independent Preview account with an empty ledger. Its password, browser sessions, private runtime files and raw real user data are not part of this public descriptor or a Pages upload.
