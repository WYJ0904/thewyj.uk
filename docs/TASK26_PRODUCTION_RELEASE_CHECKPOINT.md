# Task 26 Production release checkpoint

Observed 2026-10-12 Asia/Hong_Kong (2026-10-11 UTC). This is an intermediate checkpoint, not a completed Release Closure.

- PR #105 merged at `851bc52caafcfb014e1e69cbb8d764488cb6d1fe`. Exact main CI run `38150678650`, attempt 2, completed successfully with all eight jobs. The initial multipart-upload timeout is retained; retrying the same assertions succeeded.
- Production `0025_adaptive_learning_mastery.sql` was applied **once** through official Wrangler migration tooling. SHA-256: `4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef`. Ledger, four tables, four indexes, one immutable-event trigger, metadata and initial five OFF flags were verified. Do not reapply or restore the database.
- The immediate pre-migration Time Travel bookmark is `00000cb3-00000000-00005101-16075a3abb2243a11be1661b8a1ddcc9`.
- Controlled Production deployment `284cb0b2-ea0d-475b-975b-44305252500e` serves commit `851bc52`. Live HTTP, exact module bytes, public pages, account prerequisites, authentication boundaries and App50 update metadata passed the default-OFF smoke checks. Existing owner UI remained authenticated. This does not constitute complete legacy write or staged-rollout acceptance.
- Production main automatic deployment was restored to its original **enabled** state after verifying that remote main matched the validated serving commit. Preview branch settings were preserved.

## Hosted regression discovered during acceptance

After visiting the file-transfer screen, its document-wide paste listener remained active on other SPA screens and intercepted editable inputs. Nonsecret acceptance usernames, dates and an audit note became unintended private upload candidates instead of filling the administrator's controls. The listener also exists in the previous Production source; reverting to that source would retain this defect.

The remote audit identified ten new allocation records in three upload sessions, representing five test input files reallocated between sessions. Five remaining single-part SHA-256 hashes exactly match the known nonsecret acceptance inputs. Earlier aborted allocations have the same filenames and sizes and retain no parts. No share was published. The original 270 file rows and 88 upload-session rows remain present; finance (164), notifications (184), learning-sync (230) and shares (26) retained their observed counts. New test metadata must not be mistaken for natural user traffic or silently removed from the evidence.

All five Task 26 flags were subsequently verified **OFF / 0% / Experimental-only** in Production. Three ordinary dedicated accounts were registered normally, two received short-term language-only permissions through the existing administrator interface, and owned targeted overrides were partially prepared. No adaptive answer or AI explanation acceptance is reported as complete. Beta and Stable have not been enabled. The observed existing active audience is 28 Stable accounts, with no existing Beta or Experimental audience.

All three exact unintended QA sessions were subsequently aborted through the normal owner interface. Remote cleanup state is complete and remaining part count is zero for every session; the five exact local QA queue entries were removed individually. Allocation metadata is retained as audit history. No original file or upload-session row was removed.

The corrective change restricts clipboard uploads to the active transfer route, leaves editable inputs and already handled paste events alone, and rechecks route and owner before deferred text callbacks create files. The new browser regression runs only on localhost, checks editable/inactive screens and deferred navigation, and preserves intentional text/file clipboard uploads. Full corrective CI and actual hosted acceptance remain required before resuming rollout.

## Protected Android state and remaining gates

`ORIGINAL_APP50_ISOLATED_WRITE_ACCEPTANCE = WAIVED_BY_OWNER`

The owner waived only isolated writes in an original-signed App50 work profile because Samsung Android 16 denies the required installation. This is **not PASS**. No further work profile may be created. Previously created temporary User 10 was removed; Users 0, 95 and 150 were preserved.

Original App50 remains `uk.thewyj.app`, `1.3.37 / 50`, APK SHA-256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`, signing-certificate SHA-256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`. No APK, signing input, R2 Stable pointer, update metadata, original app data, cookie, account or permission reset was performed. Prior real Samsung acceptance applies to the distinct Preview test application and its documented scope; it is not original App50 end-to-end acceptance.

`TASK26_RELEASE_CLOSURE = INCOMPLETE`

Required outstanding work: correction review/CI/Preview acceptance and controlled deployment; exact cleanup of acceptance artifacts; real Production learning/AI/fallback/synchronization and kill-switch checks; honest staged-rollout audience/observations; website changelog; final Closure. Android Hotfix and financial Workers AI have not started and must follow completed Task26 Closure in that order.
