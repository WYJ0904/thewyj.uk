# Acceptance 3 / Android 1.3.26 release handoff

Acceptance 3: **PASS** (2026-10-02, Samsung and external browsers).
Manual MP4/JPG downloads and upload correctness also passed.

- Accepted implementation: a20e83b3d80df8747199e483e0b2327198fd3460.
- Accepted Core CI: [36823871380](https://github.com/WYJ0904/thewyj.uk/actions/runs/36823871380), six successful jobs.
- PR #79 was merged first: e0b5d4a25a7369bc0cf4fd310676764d8b66a87c.
- PR #80 was retargeted from codex/file-transfer-hotfix to main. The dependency merge preserves the entire accepted tree.
- Release metadata: 1.3.26 / 39, uk.thewyj.app, Production base https://thewyj.uk.
- Reuse the accepted signed APK: 47,726,133 bytes; SHA-256 73b35b91720792611e58e1abb244d7370c93f039620285e9fe896a7506f74ab3.
- Certificate SHA-256: 2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03.
- No remaining Samsung acceptance gate and no long matrix retest is required.
- No Android recognition/sync/identity/automatic-booking or upload/performance implementation is changed for release closure.
- No new/repeated migration, reset or real finance/notification mutation.

## Published user notes

See [Android 1.3.26 notes](releases/android-1.3.26.md). Website and App display the same changelog entry.
Official release configuration is [android/release-metadata.json](../android/release-metadata.json).
Live official update information: https://thewyj.uk/api/app/config
Official APK endpoint: https://thewyj.uk/api/app/download
GitHub release: https://github.com/WYJ0904/thewyj.uk/releases/tag/v1.3.26

The final RELEASE CLOSURE REPORT records final main/CI/deployment, publication and scoped cleanup evidence.
Historical reports below retain their original dates and hashes; old candidate/remaining-gate statements are superseded by this accepted release.
Task 24 remains COMPLETE; Task 25 and upload speed/UI performance are outside this release.
