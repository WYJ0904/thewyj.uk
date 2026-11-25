import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8938";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9250";
const USERNAME = process.env.WYJ_TEST_USER || "wyj";
const SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const OUT_DIR = path.resolve(import.meta.dirname, "../../docs/ui-rebuild/v63-phase3-tools/screenshots/v2");
const FRAMES_DIR = path.resolve(import.meta.dirname, "../../.wrangler/v2-video-frames");
const VIDEO_OUT = path.resolve(import.meta.dirname, "../../docs/ui-rebuild/v63-phase3-tools/phase3-v2-walkthrough.mp4");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

async function saveShot(page, name) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  const filePath = path.join(OUT_DIR, name);
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
  return filePath;
}

async function main() {
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1366, height: 860, mobile: false });
  const timings = {};
  const frames = [];
  let capturingVideo = false;
  let videoTimer = null;

  const startCapture = () => {
    capturingVideo = true;
    const tick = async () => {
      if (!capturingVideo) return;
      try {
        const { data } = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
        const idx = String(frames.length).padStart(5, "0");
        const fp = path.join(FRAMES_DIR, `frame_${idx}.jpg`);
        fs.writeFileSync(fp, Buffer.from(data, "base64"));
        frames.push({ fp, ts: Date.now() });
      } catch (_) {}
      if (capturingVideo) videoTimer = setTimeout(tick, 140);
    };
    void tick();
  };

  const stopCapture = () => {
    capturingVideo = false;
    if (videoTimer) clearTimeout(videoTimer);
  };

  try {
    // 1. Login on clean session
    await page.navigate("/login");
    await page.waitFor('!document.getElementById("entryScreen")', 15000, "login ready");
    await page.setFields({ "#usernameInput": USERNAME, "#secretInput": SECRET });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/'", 15000, "home after login");

    // 2. Measure cold /tools entry
    const tCold0 = Date.now();
    await page.click('a[data-site-nav][href="/tools"]');
    await page.waitFor("document.querySelectorAll('#toolCatalog [data-tool-card]').length === 24", 15000, "cold 24 tool cards");
    timings.coldToolsMs = Date.now() - tCold0;

    // Verify independent tile surface vs lighter icon tile + multi-line wrapping
    const dirCheck = await page.evaluate(`(() => {
      const card = document.querySelector('#toolCatalog .tool-card');
      const glyph = card?.querySelector('.tool-tile-glyph');
      const nameEl = card?.querySelector('.tool-tile-name');
      const csCard = card ? getComputedStyle(card) : null;
      const csGlyph = glyph ? getComputedStyle(glyph) : null;
      const csName = nameEl ? getComputedStyle(nameEl) : null;
      const rCard = card ? card.getBoundingClientRect() : null;
      const rGlyph = glyph ? glyph.getBoundingClientRect() : null;
      const centerDelta = (rCard && rGlyph) ? Math.abs((rGlyph.left + rGlyph.width / 2) - (rCard.left + rCard.width / 2)) : 999;
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return {
        p07Ui: document.documentElement.dataset.p07Ui,
        count: document.querySelectorAll('#toolCatalog [data-tool-card]').length,
        cardBg: csCard?.backgroundColor,
        glyphBg: csGlyph?.backgroundColor,
        distinctSurfaces: csCard?.backgroundColor !== csGlyph?.backgroundColor && csCard?.backgroundColor !== 'rgba(0, 0, 0, 0)',
        centerDelta,
        nameWhiteSpace: csName?.whiteSpace,
        overflow,
      };
    })()`);
    assert.equal(dirCheck.p07Ui, "enabled", `Expected p07Ui enabled: ${JSON.stringify(dirCheck)}`);
    assert.equal(dirCheck.count, 24);
    assert.equal(dirCheck.distinctSurfaces, true, `Tile and icon surfaces must differ and be non-transparent: ${JSON.stringify(dirCheck)}`);
    assert.ok(dirCheck.centerDelta <= 1.5, `Icon glyph must be horizontally centered inside tile: ${JSON.stringify(dirCheck)}`);
    assert.equal(dirCheck.nameWhiteSpace, "normal", `Tool name must wrap naturally: ${JSON.stringify(dirCheck)}`);
    assert.ok(dirCheck.overflow <= 1, `No desktop horizontal overflow: ${dirCheck.overflow}`);
    await saveShot(page, "01-directory-light.png");

    // 3. Measure warm re-entry
    await page.click('a[data-site-nav][href="/"]');
    await page.waitFor("location.pathname === '/'", 10000, "return home");
    const tWarm0 = Date.now();
    await page.click('a[data-site-nav][href="/tools"]');
    await page.waitFor("document.querySelectorAll('#toolCatalog [data-tool-card]').length === 24", 10000, "warm 24 tool cards");
    timings.warmToolsMs = Date.now() - tWarm0;

    // 4. Search results layout & category pill geometry check (no circular clipping!)
    const tSearch0 = Date.now();
    await page.setFields({ "#toolSearchInput": "转盘" });
    await page.waitFor("document.querySelectorAll('#toolCatalog [data-tool-card]').length === 2", 5000, "search results for 转盘");
    timings.searchMs = Date.now() - tSearch0;
    const searchCheck = await page.evaluate(`(() => {
      const cat = document.querySelector('#toolCatalog .tool-tile-cat');
      const r = cat ? cat.getBoundingClientRect() : null;
      const clearBtn = document.getElementById('toolSearchClearBtn');
      return {
        catText: cat?.textContent?.trim(),
        catWidth: r?.width || 0,
        catHeight: r?.height || 0,
        catOverflow: cat ? (cat.scrollWidth - cat.clientWidth) : 0,
        clearVisible: clearBtn && !clearBtn.classList.contains('hidden'),
      };
    })()`);
    assert.ok(searchCheck.catWidth > 42 && searchCheck.catHeight < 30, `Category pill must not clip into 30px circle: ${JSON.stringify(searchCheck)}`);
    assert.ok(searchCheck.catOverflow <= 1, `Category pill text must not overflow: ${JSON.stringify(searchCheck)}`);
    assert.equal(searchCheck.clearVisible, true);
    await saveShot(page, "02-search-results.png");

    // Clear search
    await page.click("#toolSearchClearBtn");
    await page.waitFor("document.querySelectorAll('#toolCatalog [data-tool-card]').length === 24", 5000, "cleared search");

    // 5. Dark mode directory screenshot
    await page.evaluate("document.documentElement.dataset.theme = 'dark'; true");
    await delay(200);
    const darkCheck = await page.evaluate(`(() => {
      const card = document.querySelector('#toolCatalog .tool-card');
      const glyph = card?.querySelector('.tool-tile-glyph');
      return {
        cardBg: card ? getComputedStyle(card).backgroundColor : '',
        glyphBg: glyph ? getComputedStyle(glyph).backgroundColor : '',
      };
    })()`);
    assert.notEqual(darkCheck.cardBg, darkCheck.glyphBg, "Dark mode tile & glyph must have distinct surfaces");
    await saveShot(page, "03-directory-dark.png");
    await page.evaluate("document.documentElement.dataset.theme = 'light'; true");
    await delay(150);

    // 6. Start 1.0x walkthrough capture!
    startCapture();

    // 6a. Weighted Wheel: open, drag slider, verify live SVG update, spin & settle
    const tOpen0 = Date.now();
    await page.evaluate("window.WYJTools.openTool('weighted-wheel', true)");
    await page.waitFor("Boolean(document.querySelector('#wheelRotor .wheel-svg'))", 10000, "weighted wheel mounted");
    timings.openToolMs = Date.now() - tOpen0;
    await delay(300);

    // Drag slider 0 to 150 (75%), slider 1 to 1 (0.5%), slider 2 to 0 (0%), slider 3 to 0 (0%)
    const sliderLive = await page.evaluate(`(() => {
      const s0 = document.querySelector('[data-option-slider="0"]');
      const s1 = document.querySelector('[data-option-slider="1"]');
      const s2 = document.querySelector('[data-option-slider="2"]');
      const s3 = document.querySelector('[data-option-slider="3"]');
      s0.value = '150'; s0.dispatchEvent(new Event('input', { bubbles: true }));
      s1.value = '1'; s1.dispatchEvent(new Event('input', { bubbles: true }));
      s2.value = '0'; s2.dispatchEvent(new Event('input', { bubbles: true }));
      if (s3) { s3.value = '0'; s3.dispatchEvent(new Event('input', { bubbles: true })); }
      const slices = document.querySelectorAll('#wheelRotor .wheel-slice').length;
      const w0 = document.querySelector('[data-weight-row="0"] [data-weight-display]')?.textContent;
      const w1 = document.querySelector('[data-weight-row="1"] [data-weight-display]')?.textContent;
      const w2 = document.querySelector('[data-weight-row="2"] [data-weight-display]')?.textContent;
      const p2 = document.querySelector('[data-weight-row="2"] [data-prob-display]')?.textContent;
      return { slices, w0, w1, w2, p2 };
    })()`);
    assert.equal(sliderLive.slices, 2, "0% option must be excluded from active wheel sectors");
    assert.equal(sliderLive.w0, "75%");
    assert.equal(sliderLive.w1, "0.5%");
    assert.equal(sliderLive.w2, "0%");
    assert.match(sliderLive.p2, /不参与/);
    await delay(350);

    // Restore balanced weights for nice visual spin
    await page.evaluate(`(() => {
      const s0 = document.querySelector('[data-option-slider="0"]');
      const s1 = document.querySelector('[data-option-slider="1"]');
      const s2 = document.querySelector('[data-option-slider="2"]');
      const s3 = document.querySelector('[data-option-slider="3"]');
      s0.value = '100'; s0.dispatchEvent(new Event('input', { bubbles: true }));
      s1.value = '50'; s1.dispatchEvent(new Event('input', { bubbles: true }));
      s2.value = '30'; s2.dispatchEvent(new Event('input', { bubbles: true }));
      if (s3) { s3.value = '20'; s3.dispatchEvent(new Event('input', { bubbles: true })); }
    })()`);
    await delay(250);
    await page.click("#runRandomToolBtn");
    await page.waitFor("document.querySelector('[data-random-state]')?.dataset.randomState === 'settled'", 10000, "wheel settled");
    const wheelResult = await page.evaluate("document.getElementById('randomResult')?.textContent?.trim()");
    assert.ok(["方案 A", "方案 B", "方案 C", "方案 D"].includes(wheelResult), `Unexpected wheel result: ${wheelResult}`);
    await saveShot(page, "06-weighted-wheel.png");

    // 6b. 3D Dice D6 (2 rolls)
    await page.evaluate("window.WYJTools.openTool('dice-d6', true)");
    await page.waitFor("Boolean(document.getElementById('diceCube'))", 10000, "dice cube mounted");
    await delay(250);
    await page.click("#runRandomToolBtn");
    await page.waitFor("document.querySelector('[data-random-state]')?.dataset.randomState === 'settled'", 6000, "dice roll 1 settled");
    const dice1 = await page.evaluate("document.getElementById('randomResult')?.textContent?.trim()");
    assert.match(dice1, /^[1-6]$/);
    await page.click("#runRandomToolBtn");
    await page.waitFor("document.querySelector('[data-random-state]')?.dataset.randomState === 'settled'", 6000, "dice roll 2 settled");
    const dice2 = await page.evaluate("document.getElementById('randomResult')?.textContent?.trim()");
    assert.match(dice2, /^[1-6]$/);
    await saveShot(page, "07-dice-3d.png");

    // 6c. 3D RMB 1 Yuan Coin Flip (2 flips)
    await page.evaluate("window.WYJTools.openTool('coin-flip', true)");
    await page.waitFor("Boolean(document.getElementById('coinBody'))", 10000, "coin body mounted");
    await delay(250);
    await page.click("#runRandomToolBtn");
    await page.waitFor("document.querySelector('[data-random-state]')?.dataset.randomState === 'settled'", 6000, "coin flip 1 settled");
    const coin1 = await page.evaluate("document.getElementById('randomResult')?.textContent?.trim()");
    assert.ok(["正面", "反面"].includes(coin1));
    await page.click("#runRandomToolBtn");
    await page.waitFor("document.querySelector('[data-random-state]')?.dataset.randomState === 'settled'", 6000, "coin flip 2 settled");
    const coin2 = await page.evaluate("document.getElementById('randomResult')?.textContent?.trim()");
    assert.ok(["正面", "反面"].includes(coin2));
    await saveShot(page, "08-coin-rmb-1yuan.png");

    // 6d. Unified Aeris File Picker & Dropzone check
    await page.evaluate("window.WYJTools.openTool('file-sha256', true)");
    await page.waitFor("Boolean(document.getElementById('fileToolDropzone'))", 10000, "file dropzone mounted");
    await delay(300);
    const filePickerCheck = await page.evaluate(`(() => {
      const input = document.getElementById('fileToolInput');
      const drop = document.getElementById('fileToolDropzone');
      const r = input?.getBoundingClientRect();
      return {
        hasAerisDrop: drop?.classList.contains('aeris-file-drop'),
        nativeHidden: input?.classList.contains('visually-hidden') && (r?.width || 0) <= 2,
      };
    })()`);
    assert.equal(filePickerCheck.hasAerisDrop, true);
    assert.equal(filePickerCheck.nativeHidden, true, "Raw browser file input must be visually hidden");
    await saveShot(page, "05-file-picker-dropzone.png");

    stopCapture();

    // 7. Mobile 390x844 directory check
    await page.evaluate("window.WYJTools.closeWorkbench(true)");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await delay(250);
    const mobileOverflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert.ok(mobileOverflow <= 1, `Mobile directory must not overflow horizontally: ${mobileOverflow}`);
    await saveShot(page, "04-directory-mobile.png");

    assert.deepEqual(page.runtimeErrors, [], `Browser runtime errors: ${JSON.stringify(page.runtimeErrors)}`);

    // Encode 1.0x walkthrough video if ffmpeg is available
    let videoEncoded = false;
    if (frames.length > 5) {
      const elapsedSec = Math.max(1, (frames[frames.length - 1].ts - frames[0].ts) / 1000);
      const fps = Math.max(2, Math.min(12, frames.length / elapsedSec));
      const ff = spawnSync("ffmpeg", [
        "-y",
        "-framerate", fps.toFixed(2),
        "-i", path.join(FRAMES_DIR, "frame_%05d.jpg"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        VIDEO_OUT,
      ], { encoding: "utf8" });
      videoEncoded = ff.status === 0;
    }

    console.log(JSON.stringify({
      ok: true,
      timings,
      dirCheck,
      searchCheck,
      sliderLive,
      wheelResult,
      dice: [dice1, dice2],
      coin: [coin1, coin2],
      filePickerCheck,
      mobileOverflow,
      framesCaptured: frames.length,
      videoEncoded,
      runtimeErrors: page.runtimeErrors.length,
    }, null, 2));
  } finally {
    stopCapture();
    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
    await page.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exitCode = 1;
});
