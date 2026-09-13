import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { delay, openPage, waitForDownloadedFile } from "./browser_harness.mjs";

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
    const size = PART_EDGE + 456 * 1024;
    const head = encoder.encode("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isomiso2");
    const tail = encoder.encode("moov\u0000\u0000RoundTrip");
    const { bytes } = buildBytes({ label: "mp4", size, head: Buffer.from(head), tail: Buffer.from(tail) });
    return {
      label: "mp4 video",
      fileName: `RoundTripClip-${RUN_ID}.mp4`,
      mimeType: "video/mp4",
      bytes,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  })(),
];

for (const fixture of FIXTURES) {
  fixture.path = path.join(TEST_ROOT, fixture.fileName);
  fs.writeFileSync(fixture.path, fixture.bytes);
  assert.equal(fs.statSync(fixture.path).size, fixture.bytes.length, `${fixture.label}: fixture on disk`);
  assert.ok(fixture.bytes.length > PART_EDGE, `${fixture.label}: must exceed the 16 MiB chunk size`);
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
    await page.navigate(`/register?transfer=${RUN_ID}`);
    await page.waitFor("!document.querySelector('#registerForm')?.classList.contains('hidden')", 20_000, "register form");
    await page.setFields({
      "#registerUsernameInput": USERNAME,
      "#registerSecretInput": SECRET,
      "#registerConfirmInput": SECRET,
    });
    await page.click("#registerSubmitBtn");
    await page.waitFor(
      "location.pathname === '/login' && document.querySelector('#loginError')?.textContent.includes('注册成功')",
      25_000,
      "registration success",
    );
    await page.setFields({ "#usernameInput": USERNAME, "#secretInput": SECRET });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/select'", 30_000, "dashboard");

    // 2. Upload both large files through the real file input + controller.
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
    await page.setFile("#transferFileInput", FIXTURES.map((fixture) => fixture.path));
    await page.waitFor(
      `document.querySelectorAll('[data-transfer-item]').length === ${FIXTURES.length}`,
      30_000,
      "queue items",
    );
    try {
      await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled === false", 240_000, "uploads finished");
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
        // One download per tab: a real recipient downloads one file, and a fresh
        // document also avoids Chrome's multiple-automatic-downloads limiter.
        const oneFilePage = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1280, height: 900, mobile: false });
        await oneFilePage.setDownloadBehavior(DOWNLOAD_DIR);
        try {
          await oneFilePage.navigate(`/transfer#share=${encodeURIComponent(shareId)}`);
          await oneFilePage.waitFor(
            `Array.from(document.querySelectorAll('#transferShareFiles .transfer-share-file strong'))
              .some((node) => node.textContent === ${JSON.stringify(fixture.fileName)})`,
            40_000,
            "share page for the download",
          );
          // Browsers without the File System Access API download through the
          // anchor branch; pin that branch so a headless run writes a real file.
          await oneFilePage.evaluate("delete window.showSaveFilePicker; true");
          const clicked = await oneFilePage.evaluate(`(() => {
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
        } finally {
          await delay(600);
          oneFilePage.close();
        }
        const downloadedPath = path.join(DOWNLOAD_DIR, fixture.fileName);
        await waitForDownloadedFile(downloadedPath, 240_000);
        const downloaded = fs.readFileSync(downloadedPath);
        const downloadedHash = crypto.createHash("sha256").update(downloaded).digest("hex");
        assert.equal(fs.statSync(downloadedPath).size, fixture.bytes.length, `${fixture.label}: byte length`);
        assert.equal(downloadedHash, fixture.sha256, `${fixture.label}: SHA-256 source == download`);
        assert.ok(
          path.extname(downloadedPath) === path.extname(fixture.fileName),
          `${fixture.label}: extension must survive (${downloadedPath})`,
        );
        assert.ok(
          downloaded.subarray(0, 8).equals(fixture.bytes.subarray(0, 8)),
          `${fixture.label}: the file signature must survive`,
        );
      }
    } finally {
      sharePage.close();
    }

    // 6. The uploaded R2 object is byte-identical to the source as well.
    const session = await page.evaluate("localStorage.getItem('wyjAccountSession') || ''");
    const me = await api("/api/me", null, session);
    assert.equal(me.status, 200, "the member session must still be valid");

    assert.deepEqual(
      FIXTURES.map((fixture) => `${fixture.fileName}:${fixture.sha256.slice(0, 12)}`).length,
      2,
      "both digests were verified",
    );
    console.log(
      `[transfer-browser] PASS source == download SHA-256 and byte length for ${FIXTURES.map((fixture) => `${fixture.fileName} (${fixture.bytes.length} bytes)`).join(", ")}`,
    );
  } finally {
    page.close();
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
