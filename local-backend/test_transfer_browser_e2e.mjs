import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { delay, openPage, registerAndSignIn, waitForDownloadedFile } from "./browser_harness.mjs";

/**
 * Task 24 reopen #8 - real browser round trip for large files.
 *
 * The Miniflare integrity test proves the server/R2/download path. This one
 * proves the *whole user path* in a real browser:
 *
 *   File on disk → input[type=file] → js/transfer/app.js → runPartPipeline()
 *   → Worker/R2 → create share → open the share link → browser download
 *
 * It uploads a `.exe` and an `.mp4`, both larger than the 16 MiB chunk size so
 * the frontend multipart scheduler really participates, then compares
 * SHA-256(source) == SHA-256(download) and the byte length of both files.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8894";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9225";
const RUN_ID = Date.now().toString(36);
const TEST_ROOT = path.join(ROOT, ".tool-e2e");
const DOWNLOAD_DIR = path.join(TEST_ROOT, `transfer-downloads-${RUN_ID}`);
const PART_EDGE = 16 * 1024 * 1024;
const USERNAME = `tr${RUN_ID}`.slice(0, 32);
const SECRET = "Transfer-Round-Trip-2026!";
const ADMIN_SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const requestedLargeBytes = Number.parseInt(process.env.WYJ_TRANSFER_LARGE_BYTES || "0", 10) || 0;
const LARGE_FILE_BYTES = requestedLargeBytes >= 750 * 1024 * 1024 && requestedLargeBytes <= 850 * 1024 * 1024
  ? requestedLargeBytes
  : 0;
const TRANSFER_TIMEOUT_MS = LARGE_FILE_BYTES ? 30 * 60_000 : 240_000;

fs.mkdirSync(TEST_ROOT, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const encoder = new TextEncoder();

/** Deterministic content with a real file signature so corruption is visible. */
function buildBytes({ label, size, head, tail }) {
  const bytes = Buffer.alloc(size);
  let state = 0;
  for (let index = 0; index < size; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = state >>> 24;
  }
  head.copy(bytes, 0);
  if (tail) tail.copy(bytes, size - tail.length);
  return { label, bytes };
}

function writeRepeatedFixture(filePath, size, head, tail) {
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  for (let index = 0; index < chunk.length; index += 1) chunk[index] = (index * 31 + 17) & 0xff;
  const descriptor = fs.openSync(filePath, "w");
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(chunk.length, size - offset);
      fs.writeSync(descriptor, chunk, 0, length, offset);
      offset += length;
    }
    fs.writeSync(descriptor, head, 0, head.length, 0);
    if (tail?.length) fs.writeSync(descriptor, tail, 0, tail.length, size - tail.length);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function firstBytes(filePath, length = 8) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const bytes = Buffer.alloc(length);
    const read = fs.readSync(descriptor, bytes, 0, length, 0);
    return bytes.subarray(0, read);
  } finally {
    fs.closeSync(descriptor);
  }
}

const FIXTURES = [
  (() => {
    const size = PART_EDGE + 123 * 1024;
    const head = encoder.encode("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000");
    const tail = encoder.encode("PE\u0000\u0000RoundTrip");
    const { bytes } = buildBytes({ label: "exe", size, head: Buffer.from(head), tail: Buffer.from(tail) });
    return {
      label: "windows executable",
      fileName: `RoundTripInstaller-${RUN_ID}.exe`,
      mimeType: "application/x-msdownload",
      bytes,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  })(),
  (() => {
    const size = LARGE_FILE_BYTES || PART_EDGE + 456 * 1024;
    const head = Buffer.from(encoder.encode("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isomiso2"));
    const tail = Buffer.from(encoder.encode("moov\u0000\u0000RoundTrip"));
    const bytes = LARGE_FILE_BYTES ? null : buildBytes({ label: "mp4", size, head, tail }).bytes;
    return {
      label: LARGE_FILE_BYTES ? "800 MiB mp4 video" : "mp4 video",
      fileName: `RoundTripClip-${RUN_ID}.mp4`,
      mimeType: "video/mp4",
      bytes,
      size,
      head,
      tail,
    };
  })(),
];

for (const fixture of FIXTURES) {
  fixture.path = path.join(TEST_ROOT, fixture.fileName);
  if (fixture.bytes) fs.writeFileSync(fixture.path, fixture.bytes);
  else writeRepeatedFixture(fixture.path, fixture.size, fixture.head, fixture.tail);
  fixture.size = fs.statSync(fixture.path).size;
  fixture.sha256 = await sha256File(fixture.path);
  fixture.headBytes = firstBytes(fixture.path);
  assert.equal(fs.statSync(fixture.path).size, fixture.size, `${fixture.label}: fixture on disk`);
  assert.ok(fixture.size > PART_EDGE, `${fixture.label}: must exceed the 16 MiB chunk size`);
}

async function api(pathname, payload = null, token = "") {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: payload === null ? "GET" : "POST",
    headers: {
      ...(payload === null ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: payload === null ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function main() {
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1280, height: 900, mobile: false });
  await page.setDownloadBehavior(DOWNLOAD_DIR);
  try {
    // 1. A real member session (guests are fine too, but a member exercises the
    //    normal quota and "my shares" path).
    await registerAndSignIn(page, { username: USERNAME, secret: SECRET, label: "transfer round-trip" });
    const identity = await page.evaluate(`(() => ({
      session: localStorage.getItem('wyjAccountSession') || '',
      account: JSON.parse(localStorage.getItem('wyjAccountCache') || 'null'),
    }))()`);
    assert.ok(identity.session, "the browser member needs a session");
    assert.ok(identity.account?.id, "the browser member needs a stable account id");
    console.log(`[transfer-browser] member ready; largeBytes=${LARGE_FILE_BYTES || 0}`);
    if (LARGE_FILE_BYTES) {
      assert.ok(ADMIN_SECRET, "WYJ_TEST_ADMIN_SECRET is required for the 800 MiB storage fixture");
      const admin = await api("/api/login", { username: "wyj", secret: ADMIN_SECRET });
      assert.equal(admin.status, 200, JSON.stringify(admin.data));
      const granted = await api("/api/admin/membership/manage", {
        user_id: identity.account.id,
        action: "grant",
        plan_code: "tools_monthly",
        note: "Task 24 isolated 800 MiB transfer fixture",
      }, admin.data.session);
      assert.equal(granted.status, 200, JSON.stringify(granted.data));
    }

    // 2. Reproduce the physical 0 B dead state before the normal round trip. A
    //    queue restored against an aborted server session must discard that
    //    session before the user re-selects the same file.
    const staleCreated = await api("/api/transfer/uploads", {
      minutes: 1440,
      max_downloads: 5,
      one_time: false,
      file_count: 1,
      total_bytes: FIXTURES[0].size,
    }, identity.session);
    assert.equal(staleCreated.status, 201, JSON.stringify(staleCreated.data));
    const staleSessionId = staleCreated.data.upload.id;
    const staleAborted = await api(`/api/transfer/uploads/${staleSessionId}/abort`, {}, identity.session);
    assert.equal(staleAborted.status, 200, JSON.stringify(staleAborted.data));
    console.log("[transfer-browser] aborted-session fixture ready");
    const queueKey = `wyjTransferQueue:v2:${String(identity.account.id).trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96)}`;
    await page.evaluate(`localStorage.setItem(${JSON.stringify(queueKey)}, ${JSON.stringify(JSON.stringify({
      account: identity.account.id,
      queue: [{
        id: `stale-${RUN_ID}`,
        name: FIXTURES[0].fileName,
        relativePath: FIXTURES[0].fileName,
        size: FIXTURES[0].size,
        uploaded: 0,
        speed: 0,
        eta: 0,
        paused: false,
        status: "uploading",
        sessionId: staleSessionId,
        fileId: "",
        partSize: 0,
        partCount: 0,
        uploadedParts: [],
      }],
    }))}); true`);

    // 3. Upload the first large file alone, then append the second one *after*
    //    the first upload finished. The server fixes file_count when the session
    //    is created, so the client has to open a new session for the full queue
    //    and re-upload - this is the session-lifecycle regression.
    await page.navigate("/transfer");
    // Wait for the page (and its quota/capabilities) to be live before attaching
    // files: the input element exists in the static markup but the controller
    // binds the change handler during show().
    await page.waitFor(
      "location.pathname === '/transfer' && !document.querySelector('#transferPage')?.classList.contains('hidden')",
      25_000,
      "transfer page visible",
    );
    await page.waitFor(
      "!String(document.querySelector('#transferQuotaText')?.textContent || '').includes('加载中')",
      25_000,
      "transfer capabilities loaded",
    );
    await page.waitFor(
      `(() => {
        const stored = JSON.parse(localStorage.getItem(${JSON.stringify(queueKey)}) || '{}');
        return stored.queue?.[0]?.sessionId === '';
      })()`,
      25_000,
      "aborted restored session cleared before file selection",
    );
    assert.equal(
      await page.evaluate("Boolean(document.querySelector('[data-transfer-pause]'))"),
      false,
      "0 B preparation must not expose a false pause action",
    );
    console.log("[transfer-browser] stale session cleared before file selection");
    await page.setFile("#transferFileInput", FIXTURES[0].path);
    await page.waitFor("document.querySelectorAll('[data-transfer-item]').length === 1", 30_000, "first queue item");
    await page.waitFor(
      "document.querySelector('[data-transfer-item]')?.textContent?.includes('100%') || document.querySelector('#transferCompleteBtn')?.disabled === false",
      TRANSFER_TIMEOUT_MS,
      "first upload finished",
    );
    const firstSessionId = await page.evaluate(`(() => {
      const key = Object.keys(localStorage).find((entry) => entry.startsWith('wyjTransferQueue'));
      const payload = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
      return String((payload.queue || [])[0]?.sessionId || '');
    })()`);
    assert.ok(firstSessionId, "the first upload must own a session");
    assert.notEqual(firstSessionId, staleSessionId, "an aborted restored session must be replaced exactly once");
    console.log("[transfer-browser] first upload completed on a replacement session");
    await page.setFile("#transferFileInput", FIXTURES[1].path);
    await page.waitFor(
      `document.querySelectorAll('[data-transfer-item]').length === ${FIXTURES.length}`,
      30_000,
      "queue items",
    );
    try {
      await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled === false", TRANSFER_TIMEOUT_MS, "uploads finished");
    } catch (error) {
      const state = await page.evaluate(`(() => ({
        message: document.querySelector('#transferMessage')?.textContent || '',
        quota: document.querySelector('#transferQuotaText')?.textContent || '',
        items: Array.from(document.querySelectorAll('[data-transfer-item]')).map((item) => (item.textContent || '').trim().slice(0, 120)),
      }))()`);
      throw new Error(`${error.message} — transfer page said ${JSON.stringify(state)}`);
    }

    // 3. The frontend multipart scheduler really participated: every plan has
    //    more than one part and every part was acknowledged.
    const queuePlan = await page.evaluate(`(() => {
      const key = Object.keys(localStorage).find((entry) => entry.startsWith('wyjTransferQueue'));
      const payload = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
      return (payload.queue || []).map((item) => ({
        name: item.name,
        size: item.size,
        partSize: item.partSize,
        partCount: item.partCount,
        uploadedParts: item.uploadedParts || [],
        status: item.status,
      }));
    })()`);
    assert.equal(queuePlan.length, FIXTURES.length, `both files must be queued: ${JSON.stringify(queuePlan)}`);
    const sessionIds = new Set(
      await page.evaluate(`(() => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith('wyjTransferQueue'));
        const payload = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
        return (payload.queue || []).map((item) => String(item.sessionId || ''));
      })()`),
    );
    assert.equal(sessionIds.size, 1, `the whole queue must share one session: ${JSON.stringify([...sessionIds])}`);
    const liveSessionId = [...sessionIds][0];
    assert.notEqual(
      liveSessionId,
      firstSessionId,
      "adding a file after the first upload must open a new session instead of reusing the exhausted one",
    );
    const pageMessage = await page.evaluate("document.querySelector('#transferMessage')?.textContent || ''");
    assert.ok(
      !pageMessage.includes("文件数量"),
      `the client must never surface transfer_file_count_exceeded, saw: ${pageMessage}`,
    );
    for (const item of queuePlan) {
      assert.equal(item.status, "done", `${item.name} must finish: ${JSON.stringify(item)}`);
      assert.ok(item.partCount >= 2, `${item.name} must be split into >= 2 parts (got ${item.partCount})`);
      assert.equal(
        item.uploadedParts.length,
        item.partCount,
        `${item.name} must acknowledge every part (${item.uploadedParts.length}/${item.partCount})`,
      );
      assert.ok(
        item.partSize <= PART_EDGE,
        `${item.name} must use the 16 MiB server chunk size (got ${item.partSize})`,
      );
    }
    console.log("[transfer-browser] complete multipart queue uploaded");

    // 4. Create the share through the normal button.
    await page.click("#transferCompleteBtn");
    await page.waitFor("!document.querySelector('#transferShareCard')?.classList.contains('hidden')", 60_000, "share card");
    const shareLink = await page.evaluate("document.querySelector('#transferShareLink')?.value || ''");
    const shareId = decodeURIComponent(shareLink.split("#share=")[1] || "");
    assert.ok(shareId, `share id missing in ${shareLink}`);
    const listed = await page.evaluate(
      "Array.from(document.querySelectorAll('#transferShareFiles .transfer-share-file strong')).map((node) => node.textContent)",
    );
    assert.deepEqual(
      listed.slice().sort(),
      FIXTURES.map((fixture) => fixture.fileName).sort(),
      "the share card must list both original file names",
    );

    // 5. Download from the share link in a *fresh* tab - the recipient path.
    const sharePage = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1280, height: 900, mobile: false });
    await sharePage.setDownloadBehavior(DOWNLOAD_DIR);
    try {
      await sharePage.navigate(`/transfer#share=${encodeURIComponent(shareId)}`);
      await sharePage.waitFor("document.querySelectorAll('[data-transfer-download]').length >= 2", 40_000, "share download buttons");
      const buttons = await sharePage.evaluate(
        "Array.from(document.querySelectorAll('[data-transfer-download]')).map((button) => button.dataset.transferDownload)",
      );
      assert.equal(buttons.length, 2, "the share page must expose both downloads");

      for (const fixture of FIXTURES) {
        // A real recipient downloads each file from the same share page. Browser
        // download permission is scoped to this isolated context, so no second
        // context is needed (creating one per file could stall before navigation
        // and produce no HTTP request at all).
        console.log(`[transfer-browser] downloading ${fixture.fileName}`);
        const downloadedPath = path.join(DOWNLOAD_DIR, fixture.fileName);
        // Browsers without the File System Access API download through the
        // anchor branch; pin that branch so a headless run writes a real file.
        await sharePage.evaluate("delete window.showSaveFilePicker; true");
        const clicked = await sharePage.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('[data-transfer-download]'));
          const match = buttons.find((button) => {
            const card = button.closest('.transfer-share-file');
            return card && card.textContent.includes(${JSON.stringify(fixture.fileName)});
          }) || buttons[0];
          if (!match) return false;
          match.click();
          return true;
        })()`);
        assert.ok(clicked, `${fixture.label}: the download button must exist`);
        await waitForDownloadedFile(downloadedPath, TRANSFER_TIMEOUT_MS);
        const downloadedHash = await sha256File(downloadedPath);
        assert.equal(fs.statSync(downloadedPath).size, fixture.size, `${fixture.label}: byte length`);
        assert.equal(downloadedHash, fixture.sha256, `${fixture.label}: SHA-256 source == download`);
        assert.ok(
          path.extname(downloadedPath) === path.extname(fixture.fileName),
          `${fixture.label}: extension must survive (${downloadedPath})`,
        );
        assert.ok(
          firstBytes(downloadedPath).equals(fixture.headBytes),
          `${fixture.label}: the file signature must survive`,
        );
        console.log(`[transfer-browser] verified ${fixture.fileName} bytes=${fixture.size} sha256=${downloadedHash}`);
      }
    } finally {
      await sharePage.close();
    }

    // 6. The superseded session is gone: the client aborted it when the queue
    //    grew, so it can never be published later (no orphan session).
    const session = await page.evaluate("localStorage.getItem('wyjAccountSession') || ''");
    assert.ok(session, "the member session must still be valid");
    const staleComplete = await fetch(`${BASE_URL}/api/transfer/uploads/${firstSessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": session },
      body: "{}",
    });
    assert.ok(
      staleComplete.status >= 400,
      `the superseded one-file session must not be publishable (HTTP ${staleComplete.status})`,
    );
    console.log(
      `[transfer-browser] PASS source == download SHA-256 and byte length for ${FIXTURES.map((fixture) => `${fixture.fileName} (${fixture.size} bytes)`).join(", ")}`,
    );
  } finally {
    await page.close();
  }
}

try {
  await main();
  console.log(
    "Task 24 browser transfer round trip passed (real file input, frontend multipart scheduler, share creation, share-link download and SHA-256/byte-length equality for .exe and .mp4 > 16 MiB).",
  );
} catch (error) {
  console.error(`[transfer-browser] FAILED: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await delay(50);
}
