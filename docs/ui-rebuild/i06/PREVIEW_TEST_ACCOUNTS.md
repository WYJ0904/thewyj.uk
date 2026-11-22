# Isolated Preview Test Accounts (`thewyj-i06-preview`)

> [!IMPORTANT]
> **Security Policy**: Passwords for preview accounts are randomly generated (`28` characters via `crypto.randomBytes`), **NEVER** stored in git, logs, CI artifacts, or screenshots, and delivered exclusively out-of-band to the Owner.

## 1. Account Inventory (Isolated D1 `aeris-i06-preview` / `949eb48b-4662-4f63-98d8-043c7afc17b6`)

| Username | D1 User ID | Role | Synthetic Entitlements / Fixtures | Purpose |
|---|---|---|---|---|
| `i06admin` | `41837fd7-292a-4278-a9a5-00b3aa6edb28` | `super_admin` | `all_access_lifetime` membership (`mem_i06p_001`), 2 synthetic finance categories (`cat_i06p_inc`, `cat_i06p_exp`) and 2 transactions (`tx_i06p_0001`: `5000.00 CNY`, `tx_i06p_0002`: `128.00 CNY`) | Owner visual review & automated admin/paid route verification on Hosted Preview (`https://i06-module-experience.thewyj-i06-preview.pages.dev`) |
| `i06user` | `6740e50c-9b79-4527-a28d-bb48cccbf9f8` | `user` | `all_access_lifetime` membership (`mem_i06p_002`) | Authorized non-admin user verification on Hosted Preview (`/tools`, `/finance`, `/transfer`, `/language`, `/admin` isolation) |

## 2. Isolation Proof
- Accounts were created directly via `POST https://55ee200c.thewyj-i06-preview.pages.dev/api/register` against isolated D1 `aeris-i06-preview` (`949eb48b-4662-4f63-98d8-043c7afc17b6`).
- Zero data was read from or written to Production D1 (`11c288d8-c584-409f-bb1f-7e7af11793e5`), I04 Preview D1 (`bd1c84a6-dc4d-4814-836e-2b6ce477a641`), I05 Preview D1 (`9e76a190-42db-4ff1-b0b7-476e4b312792`), or any R2 bucket (`r2_buckets: []`).
- Verification script `qa/i06/verify-preview.mjs` enforces `assert.equal(pwVisible, false)` before saving every preview screenshot so zero password inputs appear in committed PNG evidence.

## 3. Password Storage & Rotation / Deletion
- Out-of-band local credentials file location (outside git worktree): `<AppData>/brain/1cc5a8c1-84b7-410f-b1a4-9335f1c58ec0/scratch/i06-preview-admin.local.txt`.
- To revoke or remove these synthetic accounts at any time on the isolated preview DB only:
```bash
npx wrangler d1 execute aeris-i06-preview --remote --config .wrangler/i06-preview-d1.jsonc --command "DELETE FROM task12_users WHERE username_normalized IN ('i06admin','i06user');"
```
