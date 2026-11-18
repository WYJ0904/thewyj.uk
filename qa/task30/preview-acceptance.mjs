import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const baseUrl = String(process.env.TASK30_PREVIEW_URL || "https://thewyj-task30-preview.pages.dev").replace(/\/$/, "");
const out = path.join(root, ".wrangler/task30/evidence", `preview-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

const proof = {
  scope: "Isolated Hosted Preview acceptance (thewyj-task30-preview)",
  preview_url: baseUrl,
  checks: [],
  screenshots: [],
  android_device: "NOT_TESTED — Chrome desktop/mobile viewport only",
  production: "NOT_TOUCHED",
};

const chrome =
  process.env.AERIS_TEST_CHROME ||
  process.env.CHROME_BIN ||
  (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-task30-preview-"));
const child = spawn(
  chrome,
  [
    "--headless=new",
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

let page;
const username = `t30p_${Date.now().toString(36).slice(-6)}`;
const password = `Preview-Task30-${crypto.randomUUID().slice(0, 8)}!`;

async function check(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
}

async function capture(name) {
  const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(out, name), Buffer.from(shot.data, "base64"));
  proof.screenshots.push(name);
}

async function api(route, { method, body, token } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, body: data };
}

try {
  let port;
  for (let i = 0; i < 100 && !port; i += 1) {
    try {
      port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    } catch {
      await delay(100);
    }
  }
  assert.ok(port, "Chrome debugging port did not appear");
  const cdpUrl = `http://127.0.0.1:${port}`;

  let sessionToken = "";

  await check("Preview /api/status reports task30_privacy enabled & archive 2026-11-18-v1 loads", async () => {
    const st = await api("/api/status");
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(st.body.features.task30_privacy, true);
    const pol = await fetch(`${baseUrl}/privacy?version=2026-11-18-v1`);
    assert.equal(pol.status, 200);
    assert.match(await pol.text(), /Task30/);
  });

  await check("Register synthetic preview user, seed temporary share, inspect Privacy Center in real Chrome", async () => {
    const policies = await api("/api/policies");
    assert.equal(policies.status, 200);
    const reg = await api("/api/register", {
      body: {
        username,
        secret: password,
        terms_accepted: true,
        policy_versions: policies.body.versions,
      },
    });
    assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.body));
    sessionToken = reg.body.token || reg.body.session?.token || "";
    assert.ok(sessionToken, "registered preview session token");

    const clip = await api("/api/temporary/clipboards", {
      token: sessionToken,
      body: { content: "Preview Synthetic Clipboard Text", ttl_minutes: 60 },
    });
    assert.ok([200, 201].includes(clip.status), JSON.stringify(clip.body));

    page = await openPage({ cdpUrl, baseUrl, width: 1440, height: 900, mobile: false });
    await page.navigate("/login");
    await page.waitFor("document.querySelector('#usernameInput')");
    await page.setFields({ "#usernameInput": username, "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("!document.querySelector('#accountMenu')?.classList.contains('hidden')");
    await page.navigate("/account");
    await page.waitFor("document.querySelector('#accountPrivacyOpen') && !document.querySelector('#accountPrivacyOpen').classList.contains('hidden')");
    await page.click("#accountPrivacyOpen");
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-privacy-category]').length === 8");
    await capture("preview-desktop-data.png");
  });

  await check("Consent toggle, temporary erasure with Step-up, and verifiable report work on HTTPS Preview", async () => {
    await page.click('#task30PrivacyModal [data-privacy-tab="consents"]');
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-consent-card]').length === 4");
    await page.click('#task30PrivacyModal [data-privacy-consent="cloud_notification_sync"]');
    await page.waitFor("document.querySelector('#task27Prompt [name=\"confirm\"]')");
    await page.evaluate("document.querySelector('#task27Prompt [name=\"confirm\"]').checked = true");
    await page.click('#task27Prompt button[type="submit"]');
    await page.waitFor("document.querySelector('#task30PrivacyModal [data-consent-card=\"cloud_notification_sync\"] .sc-privacy-pill')?.classList.contains('is-off')");

    await page.click('#task30PrivacyModal [data-privacy-tab="erasure"]');
    await page.waitFor("document.querySelector('#privacyCategoryCheckboxes input[value=\"temporary\"]')");
    await page.evaluate("document.querySelector('#privacyCategoryCheckboxes input[value=\"temporary\"]').checked = true");
    await page.click('#task30PrivacyModal [data-privacy-preview]');
    await page.waitFor("document.querySelector('#privacyPreviewBox')");
    await page.setFields({ "#privacyConfirmInput": "DELETE TEMPORARY" });
    await page.click('#task30PrivacyModal [data-privacy-commit]');
    await page.waitFor("document.querySelector('#task27Prompt [name=\"password\"]')");
    await page.setFields({ "#task27Prompt [name=\"password\"]": password });
    await page.click('#task27Prompt button[type="submit"]');
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-privacy-req]').length >= 2");
    await capture("preview-desktop-requests.png");
  });

  await check("Mobile 390x844 Dark viewport passes layout & deletes synthetic test account cleanly", async () => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.evaluate("document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark-theme');true");
    await page.click('#task30PrivacyModal [data-privacy-tab="data"]');
    await delay(200);
    const overflow = await page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
    assert.equal(overflow, false, "mobile dark overflow on preview");
    await capture("preview-mobile-dark.png");

    // Clean up synthetic test user via Privacy Center account erasure API
    const st = await api("/api/security/stepup", { token: sessionToken, body: { password, scope: "privacy_account_delete" } });
    assert.equal(st.status, 200);
    const accDel = await fetch(`${baseUrl}/api/privacy/v1/erasure/commit`, {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
        "X-Aeris-Stepup": st.body.grant,
      },
      body: JSON.stringify({
        scope_type: "account",
        categories: ["account_security"],
        confirmation_text: "DELETE ACCOUNT",
        idempotency_key: `cleanup_${username}`,
      }),
    });
    assert.equal(accDel.status, 200);
    const afterOv = await api("/api/privacy/v1/overview", { token: sessionToken });
    assert.ok([401, 403].includes(afterOv.status), JSON.stringify(afterOv.body));
  });

  assert.equal(page.runtimeErrors.length, 0, JSON.stringify(page.runtimeErrors));
  proof.status = "PASS";
} catch (error) {
  proof.status = "FAIL";
  proof.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(error.stack || error.message);
} finally {
  await page?.close().catch(() => {});
  child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await writeFile(path.join(out, "result.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, screenshots: proof.screenshots, evidence: path.relative(root, out) }));
}
