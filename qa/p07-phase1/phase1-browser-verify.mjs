import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = new URL(process.env.WYJ_TEST_BASE || "http://127.0.0.1:18898").origin;
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:19238";
const ADMIN_USER = process.env.WYJ_TEST_ADMIN_USER || process.env.WYJ_TEST_ADMIN_USERNAME || "wyj";
const ADMIN_SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const EVIDENCE_DIR = path.resolve(
  process.env.AERIS_PHASE1_EVIDENCE_DIR || path.join(ROOT, "docs/p07/evidence/phase1-argon")
);
const AFTER_DIR = path.join(EVIDENCE_DIR, "after");

const host = new URL(BASE_URL).hostname;
assert.ok(
  host === "127.0.0.1" || host === "localhost" || host.endsWith(".thewyj-p07-ui-rc.pages.dev"),
  `Refusing to run against non-isolated host: ${BASE_URL}`
);

await fsp.mkdir(AFTER_DIR, { recursive: true });

const checks = [];
async function runCheck(id, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ id, status: "PASS", durationMs: Date.now() - started, detail });
  } catch (error) {
    checks.push({
      id,
      status: "FAIL",
      durationMs: Date.now() - started,
      error: error?.stack || String(error),
    });
  }
}

async function createRealPage({ width = 1440, height = 960, mobile = false } = {}) {
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width, height, mobile });
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "delete globalThis.__WYJ_TEST_MODE__;",
  });
  return page;
}

async function sendKey(page, name, shift = false) {
  const codeMap = {
    Enter: 13,
    Tab: 9,
    ArrowRight: 39,
    ArrowLeft: 37,
    ArrowDown: 40,
    ArrowUp: 38,
    Home: 36,
    End: 35,
    Escape: 27,
  };
  const vk = codeMap[name];
  const params = { key: name, code: name, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...params,
    ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function saveShot(page, filename, fullPage = false) {
  let clip;
  if (fullPage) {
    const metrics = await page.evaluate(
      "({ width: innerWidth, height: Math.min(2600, Math.ceil(document.documentElement.scrollHeight)) })"
    );
    clip = { x: 0, y: 0, width: metrics.width, height: metrics.height, scale: 1 };
  }
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: Boolean(fullPage),
    ...(clip ? { clip } : {}),
  });
  const targetPath = path.join(AFTER_DIR, filename);
  await fsp.writeFile(targetPath, Buffer.from(shot.data, "base64"));
  return path.relative(ROOT, targetPath).replaceAll("\\", "/");
}

async function waitHomeReady(page) {
  await page.waitFor(
    "!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && !document.getElementById('publicHome').classList.contains('hidden') && document.documentElement.dataset.p07Ui === 'enabled'",
    30_000,
    "public home ready with p07-ui enabled"
  );
  await delay(320);
}

async function waitLoginReady(page) {
  await page.waitFor(
    "!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.getElementById('authPanel').getClientRects().length > 0 && document.documentElement.dataset.p07Ui === 'enabled'",
    30_000,
    "login panel ready with p07-ui enabled"
  );
  await delay(180);
}

async function loadDesignSystemModule(page) {
  await page.evaluate(String.raw`(async () => {
    const script = [...document.scripts].find((node) => /\/app\.js(?:\?|$)/.test(node.src));
    const source = await fetch(script.src).then((response) => response.text());
    const match = source.match(/from\s+["']([^"']*\/design-system\.js[^"']*)["']/);
    if (!match) throw new Error("Served design-system import missing");
    window.__uiQualityDesign = await import(new URL(match[1], script.src).href);
    return true;
  })()`);
}

let page;
try {
  page = await createRealPage({ width: 1440, height: 960, mobile: false });
  await page.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });

  // 1. Task25 policy + authentic Aeris brand assets + V3 tokens on Home (/)
  await runCheck("p07-01a-policy-brand-and-v3-tokens", async () => {
    const apiPolicy = await fetch(`${BASE_URL}/api/ui/features`).then((r) => r.json());
    assert.equal(apiPolicy.ok, true);
    assert.equal(apiPolicy.public_ui?.enabled, true);
    assert.equal(apiPolicy.public_ui?.flag_key, "p07_accessibility");

    await page.navigate("/");
    await waitHomeReady(page);

    const summary = await page.evaluate(String.raw`(async () => {
      const bodyStyle = getComputedStyle(document.body);
      const cardVisual = document.querySelector("#publicHome .home-widget-visual");
      const cardStyle = getComputedStyle(cardVisual);
      const quickStyle = getComputedStyle(document.querySelector(".home-quick-access"));
      const recentStyle = getComputedStyle(document.querySelector(".home-recent-activity"));
      const primaryBtn = getComputedStyle(document.getElementById("publicLoginBtn"));
      const navStyle = getComputedStyle(document.getElementById("accountBar"));
      const heroLogo = document.querySelector(".aeris-hero-logo");
      const navLogo = document.querySelector(".site-brand img");
      const manifest = await fetch(document.querySelector('link[rel="manifest"]').href).then((r) => r.json());
      const previewNotice = document.getElementById("aerisPreviewNotice");
      return {
        p07Ui: document.documentElement.dataset.p07Ui,
        themeColor: document.querySelector('meta[name="theme-color"]')?.content,
        appName: document.querySelector('meta[name="application-name"]')?.content,
        ogSiteName: document.querySelector('meta[property="og:site_name"]')?.content,
        manifestName: manifest.name,
        bodyBg: bodyStyle.backgroundColor,
        bodyBgImage: bodyStyle.backgroundImage,
        cardBg: cardStyle.backgroundColor,
        quickBg: quickStyle.backgroundColor,
        recentBg: recentStyle.backgroundColor,
        primaryBg: primaryBtn.backgroundColor,
        primaryColor: primaryBtn.color,
        navBg: navStyle.backgroundColor,
        heroLogoLoaded: Boolean(heroLogo && heroLogo.complete && heroLogo.naturalWidth > 0),
        navLogoLoaded: Boolean(navLogo && navLogo.complete && navLogo.naturalWidth > 0),
        previewNoticeHidden: previewNotice ? previewNotice.hidden : null,
        demoBadgeCount: document.querySelectorAll("#publicHome [data-widget-demo]:not([hidden])").length,
        domNodes: document.querySelectorAll("*").length,
        fcpMs: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0),
      };
    })()`);

    assert.equal(summary.p07Ui, "enabled");
    assert.equal(summary.appName, "Aeris");
    assert.equal(summary.ogSiteName, "Aeris");
    assert.equal(summary.manifestName, "Aeris");
    assert.equal(summary.bodyBg, "rgb(244, 246, 249)");
    assert.equal(summary.bodyBgImage, "none");
    assert.equal(summary.cardBg, "rgb(255, 255, 255)");
    assert.equal(summary.quickBg, "rgb(255, 255, 255)");
    assert.equal(summary.recentBg, "rgb(255, 255, 255)");
    assert.equal(summary.primaryBg, "rgb(37, 99, 235)");
    assert.equal(summary.heroLogoLoaded, true);
    assert.equal(summary.navLogoLoaded, true);
    assert.equal(summary.demoBadgeCount, 3);
    if (host === "127.0.0.1" || host === "localhost") {
      assert.equal(summary.previewNoticeHidden, true);
    } else {
      assert.equal(summary.previewNoticeHidden, false);
    }
    return summary;
  });

  // 2. Capture required multi-viewport screenshots for Home (/) and Login (/login)
  await runCheck("multi-viewport-and-dark-mode-screenshots", async () => {
    const captured = [];
    const homeViewports = [
      ["375", 375, 812, true],
      ["390", 390, 844, true],
      ["420", 420, 900, true],
      ["768", 768, 1024, false],
      ["1024", 1024, 768, false],
      ["1366", 1366, 900, false],
      ["1440", 1440, 960, false],
      ["1920", 1920, 1080, false],
    ];

    await page.navigate("/");
    await waitHomeReady(page);

    for (const [label, width, height, mobile] of homeViewports) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await page.evaluate("document.documentElement.removeAttribute('data-theme'); window.dispatchEvent(new Event('resize')); true");
      await page.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: "light" },
          { name: "prefers-reduced-motion", value: "no-preference" },
        ],
      });
      await delay(220);
      const metrics = await page.evaluate(`(() => {
        const demos = [...document.querySelectorAll("#publicHome [data-widget-demo]:not([hidden])")];
        const demoVisible = demos.every((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          demoCount: demos.length,
          demoVisible,
        };
      })()`);
      assert.ok(metrics.scrollWidth <= metrics.width + 1, `Home horizontal overflow at ${label}px: ${metrics.scrollWidth} > ${metrics.width}`);
      assert.equal(metrics.demoCount, 3);
      assert.equal(metrics.demoVisible, true, `Guest demo badges must remain visible at ${label}px`);
      const file = label === "1440"
        ? "after-home-desktop-1440-light.png"
        : label === "390"
          ? "after-home-mobile-390-light.png"
          : `after-home-${label}-light.png`;
      captured.push(await saveShot(page, file));
    }

    // Home dark mode (1440 & 390)
    for (const [label, width, height, mobile] of [["desktop-1440", 1440, 960, false], ["mobile-390", 390, 844, true]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await page.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: "dark" },
          { name: "prefers-reduced-motion", value: "no-preference" },
        ],
      });
      await page.evaluate("document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new Event('resize')); true");
      await delay(220);
      const darkColors = await page.evaluate("({ bodyBg: getComputedStyle(document.body).backgroundColor, cardBg: getComputedStyle(document.querySelector('#publicHome .home-widget-visual')).backgroundColor })");
      assert.equal(darkColors.bodyBg, "rgb(15, 18, 23)");
      assert.equal(darkColors.cardBg, "rgb(23, 28, 36)");
      captured.push(await saveShot(page, `after-home-${label}-dark.png`));
    }

    // Login (/login) viewports + dark mode + Register tab
    await page.evaluate("document.documentElement.removeAttribute('data-theme'); true");
    await page.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.navigate("/login");
    await waitLoginReady(page);

    const loginCheck = await page.evaluate(String.raw`(() => {
      const panel = document.getElementById("authPanel");
      const logo = panel.querySelector(".auth-logo");
      const indicator = panel.querySelector(".auth-tabs .ds-tab-indicator");
      const inputRect = document.getElementById("usernameInput").getBoundingClientRect();
      const btnStyle = getComputedStyle(document.getElementById("loginSubmitBtn"));
      return {
        bodyBg: getComputedStyle(document.body).backgroundColor,
        panelBg: getComputedStyle(panel).backgroundColor,
        logoLoaded: Boolean(logo && logo.complete && logo.naturalWidth > 0),
        indicatorDisplay: indicator ? getComputedStyle(indicator).display : "absent",
        inputHeight: Math.round(inputRect.height),
        submitBg: btnStyle.backgroundColor,
        subtitle: document.getElementById("authSubtitle")?.textContent.trim(),
      };
    })()`);
    assert.equal(loginCheck.bodyBg, "rgb(244, 246, 249)");
    assert.equal(loginCheck.panelBg, "rgb(255, 255, 255)");
    assert.equal(loginCheck.logoLoaded, true);
    assert.ok(loginCheck.indicatorDisplay === "none" || loginCheck.indicatorDisplay === "absent");
    assert.ok(loginCheck.inputHeight >= 46);
    assert.equal(loginCheck.submitBg, "rgb(37, 99, 235)");

    captured.push(await saveShot(page, "after-login-desktop-1440-light.png"));
    await page.click("#showRegisterBtn");
    await delay(150);
    captured.push(await saveShot(page, "after-register-desktop-1440-light.png"));
    await page.click("#showLoginBtn");
    await delay(120);

    for (const [label, width, height, mobile] of [["375", 375, 812, true], ["390", 390, 844, true], ["768", 768, 1024, false]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await delay(180);
      assert.ok(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
      captured.push(await saveShot(page, label === "390" ? "after-login-mobile-390-light.png" : `after-login-${label}-light.png`));
    }

    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await page.evaluate("document.documentElement.dataset.theme = 'dark'; true");
    await delay(180);
    captured.push(await saveShot(page, "after-login-desktop-1440-dark.png"));

    // Reset to 1440 light
    await page.evaluate("document.documentElement.removeAttribute('data-theme'); true");
    await page.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });
    return { screenshotCount: captured.length, captured };
  });

  // 3. Spatial 3-Card Layer Separation, Dynamic zOrder, Escape Cancel, and 30-Gesture Stability
  await runCheck("p07-01c-spatial-layer-zorder-escape-and-30-gestures", async () => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.navigate("/");
    await waitHomeReady(page);
    await delay(350);

    const sampleCard = (card = "learning") =>
      page.evaluate(`(() => {
        const r = document.querySelector('[data-home-widget="${card}"]');
        const v = r.querySelector('.home-widget-visual');
        const m = new DOMMatrix(getComputedStyle(v).transform);
        const b = r.getBoundingClientRect();
        return {
          positionTransform: getComputedStyle(r).transform,
          cardTransition: getComputedStyle(r).transitionDuration,
          zIndex: getComputedStyle(r).zIndex,
          dragging: r.dataset.dragging || null,
          settling: r.dataset.settling || null,
          visualY: m.f,
          visualScale: m.a,
          rect: { x: b.x, y: b.y, width: b.width, height: b.height },
          animations: v.getAnimations().map((a) => ({ state: a.playState, iterations: a.effect.getTiming().iterations })),
          path: location.pathname,
        };
      })()`);

    // 3a. Hover lift preserves position transform authority
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });
    await delay(220);
    const idle = await sampleCard("learning");
    assert.equal(idle.cardTransition, "0s");
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: idle.rect.x + idle.rect.width / 2,
      y: idle.rect.y + idle.rect.height / 2,
      buttons: 0,
    });
    await delay(260);
    const hovered = await sampleCard("learning");
    assert.equal(hovered.positionTransform, idle.positionTransform, "Hover must not mutate .hero-scene-card coordinate transform");
    assert.ok(hovered.visualY < -2, `Expected hover lift on .home-widget-visual, got ${hovered.visualY}`);

    // Enter layout edit mode
    await page.click("#homeLayoutToggle");
    await page.waitFor("document.querySelector('.public-hero-scene').dataset.editing === 'true'");
    await page.evaluate(`(() => {
      window.__spatialStorageWrites = 0;
      const orig = Storage.prototype.setItem;
      if (!window.__origSetItem) {
        window.__origSetItem = orig;
        Storage.prototype.setItem = function(k, v) {
          if (String(k).startsWith("aerisHomeWidgets:")) window.__spatialStorageWrites++;
          return orig.call(this, k, v);
        };
      }
      return true;
    })()`);

    // 3b. Escape key mid-drag cancellation (restores original position, 0 storage writes)
    const finBefore = await sampleCard("finance");
    const finHandle = await page.evaluate(`(() => {
      const r = document.querySelector('[data-widget-drag="finance"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.evaluate("window.__spatialStorageWrites = 0; true");
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...finHandle, buttons: 0 });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...finHandle, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) {
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: finHandle.x + step * 10,
        y: finHandle.y - step * 8,
        button: "left",
        buttons: 1,
      });
      await delay(20);
    }
    const finMidDrag = await sampleCard("finance");
    assert.equal(finMidDrag.dragging, "true");
    assert.notEqual(finMidDrag.positionTransform, finBefore.positionTransform);
    await saveShot(page, "after-home-dragging-1440.png");

    await sendKey(page, "Escape");
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: finHandle.x + 50,
      y: finHandle.y - 40,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await delay(240);
    const finAfterCancel = await sampleCard("finance");
    const cancelWrites = await page.evaluate("window.__spatialStorageWrites");
    const cancelMsg = await page.evaluate("document.getElementById('homeWidgetMessage').textContent.trim()");
    assert.equal(finAfterCancel.dragging, null);
    assert.equal(finAfterCancel.positionTransform, finBefore.positionTransform, "Escape must restore original coordinates");
    assert.equal(cancelWrites, 0, "Escape mid-drag cancel must not write to storage");
    assert.equal(cancelMsg, "已取消本次移动。");

    // 3c. Dynamic zOrder bring-to-front: drag learning card and verify it stays above tools card after release
    const learnHandle = await page.evaluate(`(() => {
      const r = document.querySelector('[data-widget-drag="learning"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.evaluate("window.__spatialStorageWrites = 0; true");
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...learnHandle, buttons: 0 });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...learnHandle, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 6; step++) {
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: learnHandle.x + step * 8,
        y: learnHandle.y + step * 5,
        button: "left",
        buttons: 1,
      });
      await delay(20);
    }
    assert.equal(await page.evaluate("window.__spatialStorageWrites"), 0, "Zero storage writes during pointermove");
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: learnHandle.x + 48,
      y: learnHandle.y + 30,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await delay(260);
    const zCheck = await page.evaluate(`({
      writes: window.__spatialStorageWrites,
      guestMsg: document.getElementById("homeWidgetMessage").textContent.trim(),
      learningZ: Number(getComputedStyle(document.querySelector('[data-home-widget="learning"]')).zIndex),
      toolsZ: Number(getComputedStyle(document.querySelector('[data-home-widget="tools"]')).zIndex),
    })`);
    assert.equal(zCheck.writes, 0, "Guest drag must never persist to localStorage");
    assert.equal(zCheck.guestMsg, "演示布局仅在本次预览中生效。");
    assert.ok(zCheck.learningZ > zCheck.toolsZ, `Active card learning zIndex (${zCheck.learningZ}) must stay above tools (${zCheck.toolsZ})`);

    // Capture custom layout screenshot (resize finance to large, rotate -4.5deg)
    await page.click('[data-widget-edit="finance"]');
    await page.waitFor("document.getElementById('homeWidgetEditor').open");
    await page.setFields({
      '#homeWidgetEditor [name="size"]': "large",
      '#homeWidgetEditor [name="rotation"]': "-4.5",
    });
    await page.click('#homeWidgetEditor [type="submit"]');
    await page.waitFor("!document.getElementById('homeWidgetEditor').open");
    await page.click("#homeLayoutToggle"); // exit edit outline for clean custom layout view
    await delay(200);
    await saveShot(page, "after-home-custom-layout-1440.png");

    // Re-enter edit mode & run 30 controlled drag-release gestures across all 3 cards
    await page.click("#homeLayoutReset");
    await page.click("#homeLayoutToggle");
    await page.waitFor("document.querySelector('.public-hero-scene').dataset.editing === 'true'");
    const gestureStarted = Date.now();
    for (let round = 0; round < 30; round++) {
      const card = ["learning", "finance", "tools"][round % 3];
      const pt = await page.evaluate(`(() => {
        const n = document.querySelector('[data-widget-drag="${card}"]');
        n.scrollIntoView({ block: "nearest", behavior: "instant" });
        const r = n.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      const sign = round % 2 ? -1 : 1;
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pt, buttons: 0 });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...pt, button: "left", buttons: 1, clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: pt.x + sign * 12,
        y: pt.y + sign * 8,
        button: "left",
        buttons: 1,
      });
      await delay(180);
      const active = await sampleCard(card);
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: pt.x + sign * 12,
        y: pt.y + sign * 8,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      await delay(240);
      const settled = await sampleCard(card);
      assert.equal(active.dragging, "true");
      assert.ok(active.visualScale > 1.005, `Round ${round + 1} expected drag lift scale > 1.005, got ${active.visualScale}`);
      assert.equal(settled.path, "/");
      assert.ok(Math.abs(settled.visualScale - 1) < 0.004, `Round ${round + 1} expected settled scale ~1, got ${settled.visualScale}`);
      assert.ok(settled.animations.every((a) => a.iterations === 1));
    }
    const thirtyRoundsMs = Date.now() - gestureStarted;
    await page.click("#homeLayoutReset");
    await page.click("#homeLayoutToggle");

    // 3d. Reduced motion (browser + native signal)
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: idle.rect.x + 60,
      y: idle.rect.y + 60,
      buttons: 0,
    });
    await delay(100);
    const reduced = await sampleCard("learning");
    assert.equal(reduced.animations.length, 0);
    assert.ok(Math.abs(reduced.visualY) < 0.01);
    assert.ok(Math.abs(reduced.visualScale - 1) < 0.003);
    await saveShot(page, "after-home-reduced-motion-1440.png");

    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    await page.evaluate("document.documentElement.dataset.androidReducedMotion = 'true'; true");
    await delay(80);
    const androidReduced = await sampleCard("learning");
    assert.equal(androidReduced.animations.length, 0);
    assert.ok(Math.abs(androidReduced.visualY) < 0.01);
    await page.evaluate("delete document.documentElement.dataset.androidReducedMotion; true");

    return {
      hoverLiftVerified: true,
      escapeCancelVerified: true,
      dynamicZOrderVerified: zCheck,
      thirtyGestureRoundsPass: 30,
      thirtyGestureDurationMs: thirtyRoundsMs,
      reducedMotionVerified: true,
    };
  });

  // 4. Accessibility, Keyboard Roving Focus, Modal Focus Trap, Enlarged Text (200%), and Flag-OFF Fallback
  await runCheck("p07-01a-01d-accessibility-keyboard-and-text-scaling", async () => {
    await page.navigate("/login");
    await waitLoginReady(page);
    await loadDesignSystemModule(page);

    // Labels & ARIA tablist/tabpanel contracts
    const ariaAudit = await page.evaluate(String.raw`(() => ({
      labels: ["wordInput", "answerInput", "currentSecretInput", "newSecretInput", "newSecretConfirmInput", "deleteSecretInput", "adminNewSecretInput"].map((id) => ({
        id,
        count: document.getElementById(id)?.labels?.length || 0,
      })),
      brokenTabs: [...document.querySelectorAll('.auth-tabs [role="tab"], .feedback-tabs [role="tab"], .admin-tabs [role="tab"], #workspace > .tabs [role="tab"]')].filter((tab) => {
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        return !tab.id || !panel || panel.getAttribute("role") !== "tabpanel" || panel.getAttribute("aria-labelledby") !== tab.id;
      }).map((tab) => tab.id),
    }))()`);
    assert.ok(ariaAudit.labels.every((item) => item.count === 1));
    assert.deepEqual(ariaAudit.brokenTabs, []);

    // Skip link
    await page.evaluate("document.getElementById('skipToContent').focus()");
    await sendKey(page, "Enter");
    const skipResult = await page.evaluate("({ hasAuth: document.activeElement.contains(document.getElementById('authPanel')), hasNav: document.activeElement.contains(document.getElementById('accountBar')) })");
    assert.ok(skipResult.hasAuth && !skipResult.hasNav);

    // Auth tabs keyboard roving focus + subtitle sync
    await page.evaluate("document.getElementById('showLoginBtn').click(); document.getElementById('showLoginBtn').focus()");
    await sendKey(page, "ArrowRight");
    assert.equal(await page.evaluate("document.activeElement.id"), "showRegisterBtn");
    assert.equal(await page.evaluate("document.getElementById('registerForm').classList.contains('hidden')"), false);
    assert.ok((await page.evaluate("document.getElementById('authSubtitle').textContent")).includes("创建你的个人账户"));
    await sendKey(page, "Home");
    assert.equal(await page.evaluate("document.activeElement.id"), "showLoginBtn");
    assert.deepEqual(await page.evaluate("[...document.querySelectorAll('.auth-tabs [role=tab]')].map(t => t.tabIndex)"), [0, -1]);

    // Inline validation + policy(false) kill-switch reset
    const validation = await page.evaluate(String.raw`(() => {
      document.getElementById("loginForm").reportValidity();
      const input = document.getElementById("usernameInput");
      return {
        invalid: input.getAttribute("aria-invalid"),
        describedBy: input.getAttribute("aria-describedby"),
        msg: document.getElementById("p07-validation-usernameInput")?.textContent || "",
      };
    })()`);
    assert.equal(validation.invalid, "true");
    assert.ok(validation.describedBy.includes("p07-validation-usernameInput"));
    assert.ok(validation.msg.length > 0);
    await page.setFields({ "#usernameInput": "synthetic-valid" });
    assert.equal(await page.evaluate("document.getElementById('p07-validation-usernameInput')"), null);
    await page.setFields({ "#usernameInput": "" });

    // Contrast ratio >= 4.5:1 in light and dark modes (primary CTA + danger button)
    const contrasts = [];
    for (const theme of ["light", "dark"]) {
      contrasts.push(
        await page.evaluate(String.raw`(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          const lum = (c) => {
            const rgb = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255).map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
            return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          };
          const ratioOf = (el) => {
            const s = getComputedStyle(el);
            const a = lum(s.color), b = lum(s.backgroundColor);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          return {
            theme: ${JSON.stringify(theme)},
            primaryRatio: Number(ratioOf(document.getElementById("loginSubmitBtn")).toFixed(2)),
            dangerRatio: Number(ratioOf(document.getElementById("acceptConfirmBtn")).toFixed(2)),
          };
        })()`)
      );
    }
    await page.evaluate("document.documentElement.removeAttribute('data-theme'); true");
    assert.ok(contrasts.every((c) => c.primaryRatio >= 4.5 && c.dangerRatio >= 4.5), `Contrast failure: ${JSON.stringify(contrasts)}`);

    // Nested modal focus trap & Escape restoration
    await page.evaluate("document.getElementById('showLoginBtn').focus(); document.getElementById('accountBtn').click()");
    assert.equal(await page.evaluate("document.getElementById('appShell').inert"), true);
    await page.evaluate("document.getElementById('openDeleteAccountBtn').focus()");
    await sendKey(page, "Enter");
    assert.equal(await page.evaluate("document.activeElement.hasAttribute('data-dialog-initial-focus')"), true);
    assert.equal(await page.evaluate("document.getElementById('accountModal').inert"), true);
    await sendKey(page, "Escape");
    await page.waitFor("document.getElementById('deleteAccountModal').classList.contains('hidden')");
    assert.equal(await page.evaluate("document.activeElement.id"), "openDeleteAccountBtn");
    await sendKey(page, "Escape");
    await page.waitFor("document.getElementById('accountModal').classList.contains('hidden')");
    assert.equal(await page.evaluate("document.getElementById('appShell').inert"), false);
    assert.equal(await page.evaluate("document.activeElement.id"), "showLoginBtn");

    // 200% enlarged root text reflow on Home (/) + Flag-OFF fallback screenshot
    await page.navigate("/");
    await waitHomeReady(page);
    await loadDesignSystemModule(page);

    for (const [name, width, height, mobile] of [
      ["small", 320, 740, true],
      ["phone", 390, 844, true],
      ["landscape", 844, 390, true],
      ["tablet", 768, 1024, false],
      ["desktop", 1440, 960, false],
    ]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await page.evaluate("window.__uiQualityDesign.setInterfaceEnhancementsEnabled(true); document.documentElement.style.fontSize = '200%'; window.dispatchEvent(new Event('resize')); true");
      await delay(220);
      const reflow = await page.evaluate(String.raw`(() => {
        const cards = [...document.querySelectorAll("#publicHome [data-home-widget]")].map((node) => {
          const r = node.getBoundingClientRect();
          return { id: node.dataset.homeWidget, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        });
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          largeText: document.documentElement.dataset.largeText,
          cards,
        };
      })()`);
      assert.equal(reflow.largeText, "true");
      assert.ok(reflow.scrollWidth <= reflow.width + 1, `${name} 200% text overflow: ${reflow.scrollWidth} > ${reflow.width}`);
      assert.ok(reflow.cards.every((c) => c.x >= -1 && c.right <= reflow.width + 1), `${name} 200% card out of viewport`);
      for (let i = 0; i < reflow.cards.length; i++) {
        for (let j = i + 1; j < reflow.cards.length; j++) {
          const a = reflow.cards[i], b = reflow.cards[j];
          assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `${name} 200% cards overlapped`);
        }
      }
    }
    await page.evaluate("document.documentElement.style.fontSize = ''; window.dispatchEvent(new Event('resize')); true");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await delay(180);

    // Flag-OFF rollback proof
    await page.evaluate("window.__uiQualityDesign.setInterfaceEnhancementsEnabled(false); true");
    await delay(180);
    assert.equal(await page.evaluate("document.documentElement.dataset.p07Ui"), "disabled");
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('label[for=wordInput]')).display"), "none");
    await saveShot(page, "after-home-flag-off-fallback-1440.png");
    await page.evaluate("window.__uiQualityDesign.setInterfaceEnhancementsEnabled(true); true");
    await delay(160);

    return { ariaAudit, contrasts, enlargedTextReflowCombinations: 5, flagOffRollbackVerified: true };
  });

  // 5. Authenticated Home State + Route Non-Regression Smoke (only when synthetic local admin secret is provided)
  if (ADMIN_SECRET && (host === "127.0.0.1" || host === "localhost")) {
    await runCheck("authenticated-home-and-route-non-regression", async () => {
      await page.navigate("/login");
      await waitLoginReady(page);
      await page.setFields({ "#usernameInput": ADMIN_USER, "#secretInput": ADMIN_SECRET });
      await page.click("#loginSubmitBtn");
      await page.waitFor(
        "!document.getElementById('publicHome').classList.contains('hidden') && document.getElementById('publicHome').dataset.sessionMode === 'authenticated'",
        30_000,
        "authenticated home ready"
      );
      await delay(250);
      const authState = await page.evaluate(`({
        sessionMode: document.getElementById("publicHome").dataset.sessionMode,
        demoBadgesVisible: document.querySelectorAll("#publicHome [data-widget-demo]:not([hidden])").length,
        accountMenuVisible: !document.getElementById("accountMenu").classList.contains("hidden"),
        personalVisible: [...document.querySelectorAll("[data-home-personal]")].some((el) => !el.hidden),
      })`);
      assert.equal(authState.sessionMode, "authenticated");
      assert.equal(authState.demoBadgesVisible, 0, "Authenticated home must never display guest demo badges");
      assert.equal(authState.accountMenuVisible, true);
      assert.equal(authState.personalVisible, true);
      await saveShot(page, "after-home-authenticated-1440.png");

      // Logout back to guest
      await page.evaluate("document.getElementById('accountMenu').open = true; true");
      await page.click("#logoutBtn");
      await page.waitFor("document.getElementById('publicHome').dataset.sessionMode === 'guest'", 20_000);

      // Route non-regression smoke across guest & workspace gated routes
      const visited = [];
      for (const route of ["/register", "/trial", "/download", "/changelog", "/tools", "/language", "/finance", "/transfer", "/account", "/recharge", "/"]) {
        await page.navigate(route);
        await delay(140);
        visited.push({ route, landedPath: await page.evaluate("location.pathname") });
      }
      assert.deepEqual(page.runtimeErrors, []);
      assert.deepEqual(page.dialogs, []);
      return { authState, visitedCount: visited.length };
    });
  }

  assert.deepEqual(page.runtimeErrors, [], `Unexpected browser runtime errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(page.dialogs, [], `Unexpected browser dialogs: ${JSON.stringify(page.dialogs)}`);
} finally {
  if (page) await page.close().catch(() => {});
}

// Compute exact before/after bundle & asset sizes
const trackedAssets = [
  "index.html",
  "styles.css",
  "design-system.css",
  "product-ui.css",
  "public-experience.css",
  "workspace-experience.css",
  "spatial-experience.css",
  "app.js",
  "js/core/design-system.js",
  "js/core/motion.js",
  "js/core/home-widgets.js",
  "js/core/public-ui-policy.js",
  "js/core/aeris-public.js",
];
const afterAssetBytes = {};
for (const rel of trackedAssets) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) afterAssetBytes[rel] = fs.statSync(full).size;
}
let baselineSummary = null;
const baselinePath = path.join(EVIDENCE_DIR, "baseline/baseline-summary.json");
if (fs.existsSync(baselinePath)) {
  baselineSummary = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

const summary = {
  generatedAt: new Date().toISOString(),
  origin: BASE_URL,
  passCount: checks.filter((c) => c.status === "PASS").length,
  failCount: checks.filter((c) => c.status === "FAIL").length,
  checks,
  afterAssetBytes,
  totalAfterCssBytes: ["styles.css", "design-system.css", "product-ui.css", "public-experience.css", "workspace-experience.css", "spatial-experience.css"]
    .reduce((sum, f) => sum + (afterAssetBytes[f] || 0), 0),
  baselineAssetBytes: baselineSummary?.assetBytes || null,
};

const outFile = host === "127.0.0.1" || host === "localhost"
  ? path.join(EVIDENCE_DIR, "verification-summary.json")
  : path.join(EVIDENCE_DIR, "hosted-preview-browser-verify.json");
await fsp.writeFile(outFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  origin: BASE_URL,
  passCount: summary.passCount,
  failCount: summary.failCount,
  checks: checks.map((c) => ({ id: c.id, status: c.status, durationMs: c.durationMs })),
  outFile: path.relative(ROOT, outFile).replaceAll("\\", "/"),
}));

if (summary.failCount > 0) {
  for (const failed of checks.filter((c) => c.status === "FAIL")) {
    console.error(`FAILED ${failed.id}:\n${failed.error}`);
  }
  process.exitCode = 1;
}
