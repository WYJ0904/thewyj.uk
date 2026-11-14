import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  PINNED_PREVIEW_OWNER_IDENTIFIER,
  PREVIEW_D1_DATABASE_ID,
  PREVIEW_D1_DATABASE_NAME,
  PREVIEW_RECOVERY_CONFIRM_PHRASE,
  PreviewOwnerRecoveryError,
  assertPreviewRecoveryTarget,
  prepareRecoveryPlan,
  readPreviewOwnerSnapshot,
  sanitizeOwnerReport,
  validateOwnerPreconditions,
} from "./preview-owner-recovery-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER_BIN = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, params) {
  return sql.replace(/\?(\d+)/g, (_, idx) => sqlLiteral(params[Number(idx) - 1]));
}

export function parseWranglerJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/^\s*[\[{]/m);
    if (match && typeof match.index === "number") {
      return JSON.parse(text.slice(match.index));
    }
    throw new SyntaxError(`Unable to locate JSON payload in Wrangler output: ${text.slice(0, 120)}`);
  }
}

function runWrangler(args) {
  const stdout = execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseWranglerJsonOutput(stdout);
}

function createRemoteReadOnlyDb(databaseId, envName) {
  const query = (sql, params = []) => {
    const rendered = bindSql(sql, params).trim();
    if (!/^SELECT\b/i.test(rendered)) {
      throw new PreviewOwnerRecoveryError(
        "Remote read-only adapter only allows SELECT queries",
        "readonly_violation",
        403,
      );
    }
    const payload = runWrangler([
      "d1",
      "execute",
      databaseId,
      "--env",
      envName,
      "--remote",
      "--command",
      rendered,
      "--json",
    ]);
    const entry = Array.isArray(payload) ? payload[0] : payload;
    return { results: entry?.results || [] };
  };
  return {
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...values) {
          bound = values;
          return stmt;
        },
        async all() {
          return query(sql, bound);
        },
        async first() {
          const { results } = query(sql, bound);
          return results[0] || null;
        },
      };
      return stmt;
    },
  };
}

export function parseArgs(argv) {
  const args = {
    mode: "inspect",
    env: "preview",
    databaseId: PREVIEW_D1_DATABASE_ID,
    databaseName: PREVIEW_D1_DATABASE_NAME,
    remote: false,
    writeWindowConfirmed: false,
    ownerApprovalConfirmed: false,
    backupConfirmed: false,
    bootstrapLegacyUpgrade: false,
    confirmPhrase: "",
    note: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--mode") args.mode = String(argv[++i] || "");
    else if (token === "--env") args.env = String(argv[++i] || "");
    else if (token === "--database-id") args.databaseId = String(argv[++i] || "");
    else if (token === "--database-name") args.databaseName = String(argv[++i] || "");
    else if (token === "--remote") args.remote = true;
    else if (token === "--write-window-confirmed") args.writeWindowConfirmed = true;
    else if (token === "--owner-approval-confirmed") args.ownerApprovalConfirmed = true;
    else if (token === "--backup-confirmed") args.backupConfirmed = true;
    else if (token === "--bootstrap-legacy-upgrade") args.bootstrapLegacyUpgrade = true;
    else if (token === "--confirm-phrase") args.confirmPhrase = String(argv[++i] || "");
    else if (token === "--note") args.note = String(argv[++i] || "");
    else throw new PreviewOwnerRecoveryError(`Unknown argument '${token}'`, "invalid_argument", 400);
  }
  if (!new Set(["inspect", "dry-run", "apply"]).has(args.mode)) {
    throw new PreviewOwnerRecoveryError(`Unsupported mode '${args.mode}'`, "invalid_mode", 400);
  }
  return args;
}

export function assertRemoteApplyGates(args) {
  assertPreviewRecoveryTarget({
    environment: args.env,
    databaseId: args.databaseId,
    databaseName: args.databaseName,
    remote: true,
  });
  if (!args.remote) {
    throw new PreviewOwnerRecoveryError("Use --remote explicitly for remote Preview operations", "remote_flag_required", 400);
  }
  if (!args.writeWindowConfirmed) {
    throw new PreviewOwnerRecoveryError(
      "Coordinated Preview write-freeze window confirmation (--write-window-confirmed) is required",
      "write_window_unconfirmed",
      403,
    );
  }
  if (!args.ownerApprovalConfirmed) {
    throw new PreviewOwnerRecoveryError(
      "Explicit owner approval for task18-preview-owner-10f06c88 (--owner-approval-confirmed) is required",
      "owner_approval_required",
      403,
    );
  }
  if (!args.backupConfirmed) {
    throw new PreviewOwnerRecoveryError(
      "Fresh pre-recovery D1 backup / Time Travel bookmark confirmation (--backup-confirmed) is required",
      "backup_unconfirmed",
      403,
    );
  }
  if (args.confirmPhrase !== PREVIEW_RECOVERY_CONFIRM_PHRASE) {
    throw new PreviewOwnerRecoveryError(
      `--confirm-phrase must equal '${PREVIEW_RECOVERY_CONFIRM_PHRASE}'`,
      "confirm_phrase_mismatch",
      403,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPreviewRecoveryTarget({
    environment: args.env,
    databaseId: args.databaseId,
    databaseName: args.databaseName,
    remote: args.remote,
  });
  if (!args.remote) {
    throw new PreviewOwnerRecoveryError(
      "CLI targets remote wyj-cloud-preview with --remote; local testing uses qa/preview-owner-recovery/recover_preview_owner.test.mjs",
      "remote_flag_required",
      400,
    );
  }

  const db = createRemoteReadOnlyDb(args.databaseId, args.env);
  const snapshot = await readPreviewOwnerSnapshot(db);

  if (args.mode === "inspect") {
    validateOwnerPreconditions(snapshot, { requireResetRequired: false, requireNoActiveSessions: false });
    console.log(JSON.stringify({
      ok: true,
      mode: "inspect",
      pinned_owner: PINNED_PREVIEW_OWNER_IDENTIFIER,
      database_id: args.databaseId,
      database_name: args.databaseName,
      remote_writes: 0,
      owner: sanitizeOwnerReport(snapshot),
    }, null, 2));
    return;
  }

  const newSecret = process.env.PREVIEW_OWNER_RECOVERY_SECRET || "";
  const passwordPepper = process.env.WYJ_TASK12_PASSWORD_PEPPER || "";

  if (args.mode === "dry-run") {
    const plan = await prepareRecoveryPlan(db, {
      environment: args.env,
      databaseId: args.databaseId,
      databaseName: args.databaseName,
      remote: true,
      newSecret,
      passwordPepper,
      bootstrapLegacyUpgrade: args.bootstrapLegacyUpgrade,
      note: args.note,
    });
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      recovery_mode: args.bootstrapLegacyUpgrade ? "bootstrap_legacy_upgrade" : "peppered_direct",
      pinned_owner: PINNED_PREVIEW_OWNER_IDENTIFIER,
      database_id: args.databaseId,
      database_name: args.databaseName,
      remote_writes: 0,
      before: plan.before,
      planned_next_session_version: plan.nextSessionVersion,
      statement_count: plan.statementsSpec.length,
      request_id: plan.requestId,
      secrets_printed: false,
    }, null, 2));
    return;
  }

  assertRemoteApplyGates(args);
  const plan = await prepareRecoveryPlan(db, {
    environment: args.env,
    databaseId: args.databaseId,
    databaseName: args.databaseName,
    remote: true,
    newSecret,
    passwordPepper,
    bootstrapLegacyUpgrade: args.bootstrapLegacyUpgrade,
    note: args.note,
  });

  const workDir = path.join(ROOT, ".wrangler", "preview-owner-recovery");
  await mkdir(workDir, { recursive: true });
  const sqlFile = path.join(workDir, `apply-${Date.now()}.sql`);
  try {
    await writeFile(sqlFile, `${plan.sqlText}\n`, { encoding: "utf8", mode: 0o600 });
    runWrangler([
      "d1",
      "execute",
      args.databaseId,
      "--env",
      args.env,
      "--remote",
      "--file",
      sqlFile,
      "--json",
    ]);
  } finally {
    await rm(sqlFile, { force: true });
  }

  const afterSnapshot = await readPreviewOwnerSnapshot(db);
  validateOwnerPreconditions(afterSnapshot, { requireResetRequired: false, requireNoActiveSessions: true });
  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    recovery_mode: args.bootstrapLegacyUpgrade ? "bootstrap_legacy_upgrade" : "peppered_direct",
    pinned_owner: PINNED_PREVIEW_OWNER_IDENTIFIER,
    database_id: args.databaseId,
    database_name: args.databaseName,
    before: plan.before,
    after: sanitizeOwnerReport(afterSnapshot),
    request_id: plan.requestId,
    account_audit_id: plan.accountAuditId,
    admin_audit_id: plan.adminAuditId,
    secrets_printed: false,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || "preview_owner_recovery_failed",
      message: error?.message || "Preview owner recovery failed",
    }));
    process.exitCode = 1;
  });
}
