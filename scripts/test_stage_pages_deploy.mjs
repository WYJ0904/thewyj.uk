import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ROOT_DIRECTORIES, ROOT_FILES, stagePages } from "./stage_pages_deploy.mjs";

async function fixture(t) {
  const temporaryParent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, "aeris-pages-stage-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), temporaryParent);
    assert.ok(path.basename(root).startsWith("aeris-pages-stage-"));
    await rm(root, { recursive: true, force: true });
  });
  for (const directory of ROOT_DIRECTORIES) await mkdir(path.join(root, directory));
  for (const relative of [
    ...ROOT_FILES, "assets/logo.png", "assets/brand/asset-manifest.json",
    "functions/_middleware.js", "functions/_lib/public.mjs", "js/core/config.js",
    "vendor/qrcode.js", "vendor/opencc-LICENSE.txt", "vendor/opencc-st-characters.txt",
    "vendor/opencc-ts-characters.txt",
  ]) await put(root, relative, `public fixture: ${relative}\n`);
  return root;
}

async function put(root, relative, content) {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function snapshot(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await snapshot(root, relative));
    else {
      assert.ok(entry.isFile(), `non-regular output: ${relative}`);
      const bytes = await readFile(path.join(root, relative));
      files.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

test("staging copies only required public bytes and is deterministic", async (t) => {
  const root = await fixture(t);
  const first = await stagePages({ root });
  assert.equal(first.output, path.join(root, ".wrangler", "pages-output"));
  const original = await snapshot(first.output);
  assert.equal(original.length, ROOT_FILES.length + 9);
  for (const row of original) {
    assert.deepEqual(await readFile(path.join(first.output, row.path)), await readFile(path.join(root, row.path)));
  }
  await put(first.output, "stale-developer-file.txt", "must disappear on next complete build");
  await stagePages({ root });
  assert.deepEqual(await snapshot(first.output), original);
});

test("unallowlisted workspace, credentials and evidence never enter output", async (t) => {
  const root = await fixture(t);
  const poison = [
    "docs/migration-evidence/result.json", "qa/test.js", "private/accounts.json",
    "node_modules/fixture/index.js", ".git/config", ".env", ".dev.vars",
    "credentials.json", "users.txt", "local-backend/server.py", "android/release.jks",
    "wrangler.jsonc", "package.json", "scripts/helper.js", ".tool-e2e/evidence.png",
  ];
  for (const relative of poison) await put(root, relative, "synthetic excluded private marker");
  const { output, files } = await stagePages({ root });
  const staged = await snapshot(output);
  assert.deepEqual(staged.map((row) => row.path).sort(), files);
  for (const relative of poison) assert.ok(!files.includes(relative), relative);
  for (const row of staged) assert.ok(!(await readFile(path.join(output, row.path), "utf8")).includes("synthetic excluded private marker"));
});

for (const relative of [
  "assets/private/note.png", "assets/Developer/photo.png", "assets/brand/evidence.png",
  "assets/brand/credentials.json", "assets/brand/.env", "assets/brand/ledger.sqlite3",
  "assets/brand/unreviewed.html", "assets/brand/customer-avatar.png", "functions/_lib/secret.mjs", "functions/.dev.vars",
  "js/.git/config", "js/core/debug.js", "js/core/profile.json",
  "vendor/test-helper.js", "vendor/private/fixture.txt",
]) {
  test(`staging rejects nested unreviewed content: ${relative}`, async (t) => {
    const root = await fixture(t);
    await put(root, relative, "synthetic private fixture");
    await assert.rejects(stagePages({ root }), /Unreviewed or private Pages asset/);
    await assert.rejects(readFile(path.join(root, ".wrangler", "pages-output", relative)), { code: "ENOENT" });
  });
}

for (const [label, content] of [
  ["private key", "-----BEGIN " + "PRIVATE KEY-----\nsynthetic\n"],
  ["GitHub token", "ghp_" + "x".repeat(36)],
  ["API key", "sk-" + "x".repeat(36)],
  ["AWS access key", "AKIA" + "X".repeat(16)],
  ["Cloudflare token assignment", "CLOUDFLARE_API_TOKEN=" + "x".repeat(36)],
]) {
  test(`credential scanner refuses ${label} in otherwise allowed source`, async (t) => {
    const root = await fixture(t);
    await put(root, "functions/_lib/public.mjs", content);
    await assert.rejects(stagePages({ root }), /Credential material in Pages asset: functions\/_lib\/public.mjs/);
  });
}

test("source directory junctions cannot include bytes outside the allowlist", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside, path.join(root, "assets", "linked"), "junction");
  await assert.rejects(stagePages({ root }), /Unsafe Pages asset type: assets\/linked/);
});

for (const relative of [".wrangler", ".wrangler/pages-output"]) {
  test(`output junction at ${relative} cannot redirect removal`, async (t) => {
    const root = await fixture(t);
    const outside = await fixture(t);
    await put(outside, "sentinel.txt", "protected outside staging");
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await symlink(outside, path.join(root, relative), "junction");
    await assert.rejects(stagePages({ root }), /Unsafe Pages staging output/);
    assert.equal(await readFile(path.join(outside, "sentinel.txt"), "utf8"), "protected outside staging");
  });
}

test("missing required source fails before changing an existing build", async (t) => {
  const root = await fixture(t);
  const { output } = await stagePages({ root });
  const before = await snapshot(output);
  await rm(path.join(root, "index.html"));
  await assert.rejects(stagePages({ root }), /Missing required Pages asset: index.html/);
  assert.deepEqual(await snapshot(output), before);
});

test("reviewed transaction-evidence source remains deployable without permitting QA evidence", async (t) => {
  const root = await fixture(t);
  await put(root, "functions/_lib/notification-cash-evidence.mjs", "export const runtimeRule = true;\n");
  const { output } = await stagePages({ root });
  assert.equal(await readFile(path.join(output, "functions/_lib/notification-cash-evidence.mjs"), "utf8"), "export const runtimeRule = true;\n");
  await put(root, "functions/_lib/qa-evidence.mjs", "synthetic QA evidence");
  await assert.rejects(stagePages({ root }), /Unreviewed or private Pages asset/);
});

test("command-line arguments cannot change the publish directory to the workspace", async (t) => {
  const root = await fixture(t);
  await put(root, "sentinel.txt", "retain workspace contents");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./stage_pages_deploy.mjs", import.meta.url)), "--output", "."], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pages staging accepts no path overrides/);
  assert.equal(await readFile(path.join(root, "sentinel.txt"), "utf8"), "retain workspace contents");
});
