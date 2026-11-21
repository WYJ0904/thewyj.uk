# Isolated Preview Test Accounts (`thewyj-i05-preview`)

> [!IMPORTANT]
> **Security Policy**: Passwords for preview accounts are randomly generated (`28` characters via `crypto.randomBytes`), **NEVER** stored in git, logs, CI artifacts, or screenshots, and delivered exclusively out-of-band to the Owner.

## 1. Account Inventory (Isolated D1 `aeris-i05-preview` / `9e76a190-42db-4ff1-b0b7-476e4b312792`)

| Username | D1 User ID | Role | Synthetic Entitlements / Fixtures | Purpose |
|---|---|---|---|---|
| `i05admin` | `77f4f57d-53bc-409c-8680-25529e504f44` | `super_admin` | `all_access_lifetime` membership (`mem_i05_preview_001`), 2 synthetic finance categories (`cat_i05p_inc`, `cat_i05p_exp`) and 2 transactions (`tx_i05p_0001`: `6800.00 CNY`, `tx_i05p_0002`: `245.00 CNY`) | Owner visual review & automated admin/route verification on Preview (`https://i05-workspace-density.thewyj-i05-preview.pages.dev`) |
| `i05user` | `7776257a-c3df-44a9-97b0-0f769a274638` | `user` | Entitlement overrides (`tools_access`, `finance_access`, `temporary_share_access`) | Non-admin `/admin` isolation verification (redirect to `/`, `403` on `/api/admin/users`, `#v3SidebarAdminLink[hidden]`) |

## 2. Isolation Proof
- Accounts were created directly via `POST https://i05-workspace-density.thewyj-i05-preview.pages.dev/api/register` against isolated D1 `aeris-i05-preview` (`9e76a190-42db-4ff1-b0b7-476e4b312792`).
- Zero data was read from or written to Production D1 (`11c288d8-c584-409f-bb1f-7e7af11793e5`), I04 Preview D1 (`bd1c84a6-dc4d-4814-836e-2b6ce477a641`), or any R2 bucket (`r2_buckets: []`).
- Verification script `qa/i05/verify-preview.mjs` enforces `assert.equal(pwVisible, false)` before saving every preview screenshot so zero password inputs appear in committed PNG evidence.

## 3. Password Storage & Rotation / Deletion
- Out-of-band local credentials file location (outside git worktree): `<AppData>/brain/48514f9a-c549-4c3a-8081-c6b7a3fff6d9/scratch/i05-preview-admin.local.txt`.
- To revoke or remove these synthetic accounts at any time on the isolated preview DB only:
```bash
npx wrangler d1 execute aeris-i05-preview --remote --config .wrangler/i05-preview-d1.jsonc --command "DELETE FROM task12_users WHERE username_normalized IN ('i05admin','i05user');"
```
