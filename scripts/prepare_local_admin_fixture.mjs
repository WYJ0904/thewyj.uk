import fs from "node:fs";

import { hashSecret } from "../functions/_lib/task12-crypto.mjs";

/**
 * Local-only helper for the Task 24 browser regressions: writes the D1 insert
 * for a super-admin fixture user with the same password hashing the CI job uses.
 *
 * Usage:
 *   WYJ_TEST_ADMIN_SECRET=... WYJ_TASK12_PASSWORD_PEPPER=... \
 *   node scripts/prepare_local_admin_fixture.mjs tmp/rc-browser/admin.sql
 */

const secret = process.env.WYJ_TEST_ADMIN_SECRET || "";
const pepper = process.env.WYJ_TASK12_PASSWORD_PEPPER || "";
const target = process.argv[2] || "";
const username = process.env.WYJ_TEST_ADMIN_USER || "wyj";

if (!secret || !pepper || !target) {
  console.error("WYJ_TEST_ADMIN_SECRET, WYJ_TASK12_PASSWORD_PEPPER and an output path are required.");
  process.exit(1);
}

const now = new Date().toISOString();
const hash = await hashSecret(secret, pepper);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

fs.writeFileSync(
  target,
  `INSERT INTO task12_users (
  id, username, username_normalized, password_hash, password_scheme,
  password_iterations, role, registered_at, created_at, updated_at, source_updated_at
) VALUES (
  ${quote("task15-ci-super-admin")}, ${quote(username)}, ${quote(username.toLowerCase())}, ${quote(hash)},
  'pbkdf2_sha256', 310000, 'super_admin', ${quote(now)}, ${quote(now)}, ${quote(now)}, ${quote(now)}
);
`,
  "utf8",
);
console.log(`admin fixture written to ${target}`);
