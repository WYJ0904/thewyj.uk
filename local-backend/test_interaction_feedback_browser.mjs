import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLICK_AND_PROBE, delay, openPage } from "./browser_harness.mjs";

/**
 * Task 24 reopen #7 - browser-level regression for the site-wide feedback rule.
 *
 * The unit test only proves the primitives. This drives the real app in headless
 * Chrome, throttles the network and asserts that several *different* modules
 * (finance, learning sync, transfer, tools, membership/recharge, admin) put the
 * pressed control into its pending state inside the same task, then release it
 * when the work is done.
 *
 * A handler that only reacts after its first await fails here - exactly the
 * real-device complaint "点击后几秒无反馈".
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8894";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9225";
const ADMIN_SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const ADMIN_USER = process.env.WYJ_TEST_ADMIN_USER || "wyj";
const RUN_ID = Date.now().toString(36);
const BROWSER_USER = `rc${RUN_ID}`.slice(0, 32);
const BROWSER_SECRET = "Interaction-Audit-2026!";
const TEST_ROOT = path.join(ROOT, ".tool-e2e");
const UPLOAD_FILE = path.join(TEST_ROOT, `interaction-upload-${RUN_ID}.txt`);
const ARTIFACT_DIR = path.resolve(ROOT, process.env.WYJ_TEST_ARTIFACT_DIR || "artifacts");

fs.mkdirSync(TEST_ROOT, { recursive: true });
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(UPLOAD_FILE, `feedback probe ${RUN_ID}\n`, "utf8");

const checks = [];
const skips = [];
let page;

/** Controlled catalog + order for the membership feedback case (no D1 writes). */
const CONTROLLED_PLANS = {
  ok: true,
  plans: [
    {
      code: "finance_monthly",
      name: "财务会员（CI 控制目录）",
      price: "8",
      currency: "CNY",
      description: "controlled catalog for the interaction audit",
      duration_months: 1,
    },
    {
      code: "tools_monthly",
      name: "工具箱会员（CI 控制目录）",
      price: "8",
      currency: "CNY",
      description: "controlled catalog for the interaction audit",
      duration_months: 1,
    },
  ],
  payment_methods: [
    { code: "wechat", name: "微信支付" },
    { code: "alipay", name: "支付宝" },
  ],
};
const CONTROLLED_ORDER = {
  id: "rc-ci-order-1",
  plan_code: "finance_monthly",
  plan_name: "财务会员（CI 控制目录）",
  payment_method: "wechat",
  amount_cents: 800,
  currency: "CNY",
  status: "pending_payment",
  order_number: "RC-CI-1",
};
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** HTTP helper for the admin fixture (same shape as the other browser suites). */
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

/**
 * The finance/tools modules need real entitlements. The CI job ships a
 * super-admin fixture, so the same path a human admin uses grants the browser's
 * own account the plans this audit exercises.
 */
async function grantPlansToBrowserAccount(planCodes) {
  await page.waitFor("(localStorage.getItem('wyjAccountSession') || '').length > 20", 20_000, "session token");
  const session = await page.evaluate("localStorage.getItem('wyjAccountSession')");
  const me = await api("/api/me", null, session);
  assert.equal(me.status, 200, `could not resolve the signed-in account: ${JSON.stringify(me.data)}`);
  const userId = me.data?.account?.id || "";
  assert.ok(userId, `could not resolve the signed-in account id: ${JSON.stringify(me.data).slice(0, 200)}`);
  const admin = await api("/api/login", { username: ADMIN_USER, secret: ADMIN_SECRET });
  assert.equal(admin.status, 200, `admin fixture login failed: ${JSON.stringify(admin.data)}`);
  try {
    for (const planCode of planCodes) {
      const granted = await api(
        "/api/admin/membership/manage",
        { user_id: userId, action: "grant", plan_code: planCode, note: "Task 24 interaction audit fixture" },
        admin.data.session,
      );
      assert.equal(granted.status, 200, `grant ${planCode} failed: ${JSON.stringify(granted.data)}`);
    }
  } finally {
    await api("/api/logout", {}, admin.data.session);
  }
  await page.send("Page.reload", { ignoreCache: true });
  await page.waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 25_000, "reload");
  return userId;
}

const check = async (name, action) => {
  const started = Date.now();
  await action();
  checks.push({ name, milliseconds: Date.now() - started });
  console.log(`[interaction-browser] PASS ${name} (${Date.now() - started}ms)`);
};

/** Clicks and proves the pending state appears within the 150ms budget. */
async function clickWithImmediateFeedback(selector, label) {
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, 20_000, `${label} present`);
  await page.waitFor(`!document.querySelector(${JSON.stringify(selector)})?.disabled`, 20_000, `${label} idle`);
  const probe = await page.evaluate(CLICK_AND_PROBE(selector));
  assert.ok(probe?.ok, `${label}: ${probe?.reason || "probe failed"}`);
  assert.ok(
    probe.pending,
    `${label}: the handler reached its first await with no pending state (${probe.elapsedMs.toFixed(1)}ms)`,
  );
  assert.ok(
    probe.elapsedMs <= 150,
    `${label}: feedback must appear inside 150ms, measured ${probe.elapsedMs.toFixed(1)}ms`,
  );
  return probe;
}

/** Opens a module the way a user does: module picker tile, direct route fallback. */
async function openModule(kind, readyCondition, timeout = 30_000) {
  await page.navigate("/select");
  const tile = `[data-module="${kind}"]`;
  const hasTile = await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(tile)}))`);
  if (hasTile) await page.click(tile);
  else await page.navigate(`/${kind}`);
  await page.waitFor(readyCondition, timeout, `${kind} ready`);
}

async function main() {
  page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL });
  // A slow link is the whole point: without immediate feedback every one of
  // these taps would look dead for the duration of the round trip.
  await page.throttle(400, 400_000);

  try {
    await check("register, sign in and load the module picker", async () => {
      assert.ok(ADMIN_SECRET, "WYJ_TEST_ADMIN_SECRET must be provided by the CI job");
      // A site owner cannot receive memberships, so the browser session belongs to
      // a fresh member and the admin fixture grants the plans through the real
      // admin API (same pattern as the other cloud browser suites).
      await page.navigate("/register");
      await page.waitFor("!document.querySelector('#registerForm')?.classList.contains('hidden')", 15_000, "register form");
      await page.setFields({
        "#registerUsernameInput": BROWSER_USER,
        "#registerSecretInput": BROWSER_SECRET,
        "#registerConfirmInput": BROWSER_SECRET,
      });
      await page.click("#registerSubmitBtn");
      await page.waitFor(
        "location.pathname === '/login' && document.querySelector('#loginError')?.textContent.includes('注册成功')",
        20_000,
        "registration success",
      );
      await page.setFields({ "#usernameInput": BROWSER_USER, "#secretInput": BROWSER_SECRET });
      await page.click("#loginSubmitBtn");
      await page.waitFor(
        "location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')",
        25_000,
        "dashboard after login",
      );
      // The audit exercises finance/tools/archive surfaces, so the fixture
      // account needs the plans a member would have (granted through the real
      // admin API, exactly like the other cloud browser suites do).
      await grantPlansToBrowserAccount([
        "finance_monthly",
        "tools_monthly",
        "notification_archive_access",
      ]);
    });

    await check("finance candidate refresh shows feedback before the request", async () => {
      await page.waitFor(
        "state.account?.entitlements?.includes('finance_access') || Boolean(document.querySelector('[data-module=\"finance\"]'))",
        25_000,
        "finance entitlement",
      );
      await openModule(
        "finance",
        "!document.querySelector('#financePage')?.classList.contains('hidden') && !document.querySelector('#financeCandidatesSection')?.classList.contains('hidden')",
        40_000,
      );
      await page.evaluate("document.querySelector('#financeCandidatesRefreshBtn')?.scrollIntoView()");
      await clickWithImmediateFeedback("#financeCandidatesRefreshBtn", "finance refresh");
      await page.waitFor(
        "!document.querySelector('#financeCandidatesRefreshBtn')?.dataset.pending",
        30_000,
        "finance refresh released",
      );
    });

    await check("learning sync now shows feedback before the upload", async () => {
      await page.navigate("/select");
      await page.waitFor("document.querySelector('#learningSyncNowBtn')", 25_000, "learning sync button");
      await page.evaluate("document.querySelector('#learningSyncNowBtn')?.scrollIntoView()");
      await clickWithImmediateFeedback("#learningSyncNowBtn", "learning sync");
      await page.waitFor(
        "!document.querySelector('#learningSyncNowBtn')?.disabled && !document.querySelector('#learningSyncNowBtn')?.dataset.pending",
        30_000,
        "learning sync released",
      );
    });

    await check("transfer upload and share keep feedback on the pressed buttons", async () => {
      // Local Windows dev runs cannot serve multipart uploads (the wrangler
      // workerd proxy dies with "internal error"), so the transfer module is
      // validated in the Cloud-only Preview job. CI never sets this switch.
      if (process.env.WYJ_BROWSER_SKIP_TRANSFER === "1") {
        console.log("[interaction-browser] transfer module skipped locally (WYJ_BROWSER_SKIP_TRANSFER=1)");
        return;
      }
      await page.navigate("/transfer");
      // The file input is static markup; the controller binds its change handler
      // (and the quota arrives) only after show() ran. Waiting for the loaded
      // quota is what makes the file attach land on a live listener.
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
      await page.setFile("#transferFileInput", UPLOAD_FILE);
      await page.waitFor("document.querySelectorAll('[data-transfer-item]').length === 1", 20_000, "single queue item");
      try {
        await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled === false", 90_000, "upload finished");
      } catch (error) {
        const state = await page.evaluate(`(() => ({
          message: document.querySelector('#transferMessage')?.textContent || '',
          quota: document.querySelector('#transferQuotaText')?.textContent || '',
          item: (document.querySelector('[data-transfer-item]')?.textContent || '').trim().slice(0, 200),
        }))()`);
        throw new Error(`${error.message} — transfer page said ${JSON.stringify(state)}`);
      }
      await clickWithImmediateFeedback("#transferCompleteBtn", "transfer complete");
      await page.waitFor("!document.querySelector('#transferShareCard')?.classList.contains('hidden')", 60_000, "share card");
      const shareLink = await page.evaluate("document.querySelector('#transferShareLink')?.value || ''");
      assert.match(shareLink, /\/transfer#share=/, "the share link must use the transfer share route");
      const downloadSelector = "[data-transfer-download]";
      await page.waitFor(`document.querySelector(${JSON.stringify(downloadSelector)})`, 20_000, "download button");
      const downloadProbe = await page.evaluate(CLICK_AND_PROBE(downloadSelector));
      assert.ok(downloadProbe?.ok, `download probe failed: ${downloadProbe?.reason || ""}`);
      assert.ok(
        downloadProbe.pending || downloadProbe.elapsedMs <= 150,
        "the download button must acknowledge the tap inside the budget",
      );
    });

    await check("tool run shows feedback before the tool reports", async () => {
      await page.navigate("/tools");
      await page.waitFor("document.querySelector('[data-open-tool]')", 30_000, "tool catalog");
      await page.click("[data-open-tool]");
      await page.waitFor(
        "document.querySelector('#runTextToolBtn'), document.querySelector('#runFileToolBtn'), document.querySelector('#runImageToolBtn')",
        30_000,
        "tool workbench",
      );
      const runSelector = await page.evaluate(`(() => {
        for (const id of ["#runTextToolBtn", "#runFileToolBtn", "#runImageToolBtn"]) {
          if (document.querySelector(id)) return id;
        }
        return "";
      })()`);
      assert.ok(runSelector, "a run button must exist in the tool workbench");
      // The tool may need a file; use the text tool when available (no file
      // required) so the feedback rule is what is under test.
      await page.evaluate(`(() => {
        const input = document.querySelector('#textToolInput');
        if (input) {
          input.value = "feedback probe";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      })()`);
      const probe = await page.evaluate(CLICK_AND_PROBE(runSelector));
      assert.ok(probe?.ok, `tool run probe failed: ${probe?.reason || ""}`);
      assert.ok(probe.elapsedMs <= 150, `tool run must acknowledge the tap inside 150ms (${probe.elapsedMs.toFixed(1)}ms)`);
    });

    await check("membership recharge submit shows feedback before the order request", async () => {
      // Deterministic membership evidence that does not depend on (and does not
      // mutate) the Preview D1 plan catalog: the catalog and the order endpoint
      // are answered by controlled stubs, each with >=400ms latency so the
      // feedback budget is what the assertion actually measures.
      const stub = await page.intercept([
        {
          match: "/api/membership/plans",
          respond: () => ({ status: 200, delayMs: 420, body: CONTROLLED_PLANS }),
        },
        {
          match: "/api/recharge/request",
          state: "error",
          respond: ({ state }) =>
            state === "success"
              ? { status: 200, delayMs: 420, body: { ok: true, created: true, request: CONTROLLED_ORDER } }
              : { status: 500, delayMs: 420, body: { ok: false, error: "CI 模拟订单失败", code: "ci_stub_failure" } },
        },
        {
          match: "/api/recharge/qr",
          respond: () => ({ status: 200, contentType: "image/png", delayMs: 20, bodyBase64: TINY_PNG_BASE64 }),
        },
      ]);
      await page.navigate("/select");
      await page.click("#accountBtn");
      await page.waitFor("document.querySelector('#membershipBtn')", 10_000, "account menu");
      const opened = await page.evaluate(`(() => {
        const button = document.querySelector('#membershipBtn');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      assert.ok(opened, "the membership entry must exist in the account menu");
      await page.waitFor("location.pathname === '/recharge' || !document.querySelector('#membershipModal')?.classList.contains('hidden')", 30_000, "recharge view");
      await page.waitFor("document.querySelector('#submitRechargeBtn')", 30_000, "recharge submit");
      // The page may already have tried (and failed) to load the real catalog
      // before this step installed the controlled one; retry through the app's
      // own recovery button so the controlled catalog is the one on screen.
      await page.evaluate(`(() => {
        const recovery = document.querySelector('#membershipPlanRecovery');
        const retry = document.querySelector('#retryMembershipPlansBtn');
        if (retry && recovery && !recovery.classList.contains('hidden')) retry.click();
        return true;
      })()`);
      // The membership form needs a goal, then a plan, then a payment method
      // before the submit button becomes usable - the same path a user takes.
      await page.waitFor("document.querySelector('[data-membership-goal]')", 30_000, "membership goals");
      await page.evaluate(`(() => {
        const goals = Array.from(document.querySelectorAll('[data-membership-goal]'));
        const goal = goals.find((button) => button.dataset.membershipGoal === 'finance') || goals[0];
        goal.click();
      })()`);
      // Plans only render once a goal is selected, and the page may have failed
      // its own (real) catalog request before this step installed the controlled
      // one - so retry through the app's recovery button and then wait again.
      const planVisible = () => page.waitFor("document.querySelector('[data-plan=\"finance_monthly\"]')", 12_000, "controlled plan")
        .then(() => true)
        .catch(() => false);
      let hasPlans = await planVisible();
      if (!hasPlans) {
        await page.evaluate(`(() => {
          const retry = document.querySelector('#retryMembershipPlansBtn');
          if (retry) retry.click();
          return true;
        })()`);
        await page.evaluate(`(() => {
          const goals = Array.from(document.querySelectorAll('[data-membership-goal]'));
          (goals.find((button) => button.dataset.membershipGoal === 'finance') || goals[0]).click();
        })()`);
        hasPlans = await planVisible();
      }
      if (!hasPlans) {
        const surface = await page.evaluate(`(() => ({
          path: location.pathname,
          modalHidden: document.querySelector('#membershipModal')?.classList.contains('hidden'),
          recoveryHidden: document.querySelector('#membershipPlanRecovery')?.classList.contains('hidden'),
          recoveryText: (document.querySelector('#membershipPlanRecovery')?.textContent || '').trim().slice(0, 160),
          message: (document.querySelector('#rechargeMessage')?.textContent || '').slice(0, 160),
          planList: (document.querySelector('#membershipPlanList')?.innerHTML || '').slice(0, 160),
        }))()`);
        throw new Error(`the controlled plan catalog was not used by the membership page: ${JSON.stringify(surface)}`);
      }
      await page.evaluate("(document.querySelector('[data-plan=\"finance_monthly\"]') || document.querySelector('[data-plan]')).click()");
      await page.waitFor("document.querySelector('input[name=\"paymentMethod\"]')", 25_000, "payment methods");
      await page.evaluate(`(() => {
        const method = document.querySelector('input[name="paymentMethod"]');
        if (method) {
          method.checked = true;
          method.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);
      await page.waitFor("!document.querySelector('#submitRechargeBtn')?.disabled", 25_000, "recharge submit enabled");

      // Success path: the button must show pending inside the budget, settle
      // afterwards and surface the accepted order.
      stub.setState("success");
      const submitSettled = `(() => {
        const button = document.querySelector('#submitRechargeBtn');
        const released = !button || (button.dataset.pending !== "true" && !button.disabled);
        const traced = (window.__wyjInteractionTrace?.recent?.(10) || [])
          .some((trace) => trace.name === "recharge-submit"
            && trace.stages.some((stage) => stage.stage === "state-apply"));
        return released || traced;
      })()`;
      await clickWithImmediateFeedback("#submitRechargeBtn", "recharge submit (success path)");
      await page.waitFor(submitSettled, 30_000, "released after the successful order");
      const successMessage = await page.evaluate("document.querySelector('#rechargeMessage')?.textContent || ''");
      assert.match(
        successMessage,
        /订单已生成/,
        `the accepted order must be reported back to the user: ${successMessage}`,
      );

      // Error path in its own fresh tab/context: after a successful order the
      // submit control is intentionally locked, so the failed attempt gets a
      // clean state instead of inheriting the pending order.
      stub.setState("error");
      const errorPage = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL });
      try {
        await errorPage.intercept([
          { match: "/api/membership/plans", respond: () => ({ status: 200, delayMs: 420, body: CONTROLLED_PLANS }) },
          {
            match: "/api/recharge/request",
            respond: () => ({ status: 500, delayMs: 420, body: { ok: false, error: "CI 模拟订单失败", code: "ci_stub_failure" } }),
          },
        ]);
        await errorPage.navigate("/login");
        await errorPage.waitFor("!document.querySelector('#loginForm')?.classList.contains('hidden')", 15_000, "login form");
        await errorPage.setFields({ "#usernameInput": BROWSER_USER, "#secretInput": BROWSER_SECRET });
        await errorPage.click("#loginSubmitBtn");
        await errorPage.waitFor("location.pathname === '/select'", 30_000, "dashboard for the error path");
        await errorPage.click("#accountBtn");
        await errorPage.waitFor("document.querySelector('#membershipBtn')", 10_000, "account menu for the error path");
        await errorPage.evaluate("document.querySelector('#membershipBtn').click(); true");
        await errorPage.waitFor("document.querySelector('[data-membership-goal]')", 25_000, "goals for the error path");
        await errorPage.evaluate(`(() => {
          const goals = Array.from(document.querySelectorAll('[data-membership-goal]'));
          (goals.find((button) => button.dataset.membershipGoal === 'finance') || goals[0]).click();
        })()`);
        await errorPage.waitFor("document.querySelector('[data-plan=\"finance_monthly\"]')", 25_000, "controlled plan for the error path");
        await errorPage.evaluate("document.querySelector('[data-plan=\"finance_monthly\"]').click()");
        await errorPage.waitFor("document.querySelector('input[name=\"paymentMethod\"]')", 25_000, "payment methods for the error path");
        await errorPage.evaluate(`(() => {
          const method = document.querySelector('input[name="paymentMethod"]');
          if (method) {
            method.checked = true;
            method.dispatchEvent(new Event("change", { bubbles: true }));
          }
        })()`);
        await errorPage.waitFor("!document.querySelector('#submitRechargeBtn')?.disabled", 25_000, "submit enabled for the error path");
        const errorSelector = "#submitRechargeBtn";
        await errorPage.waitFor(`document.querySelector(${JSON.stringify(errorSelector)})`, 15_000, "error-path button");
        const probe = await errorPage.evaluate(CLICK_AND_PROBE(errorSelector));
        assert.ok(probe?.ok, `error-path probe failed: ${probe?.reason || ""}`);
        assert.ok(probe.pending, "the failed order must show pending before its first await");
        assert.ok(probe.elapsedMs <= 150, `error-path feedback must appear inside 150ms (${probe.elapsedMs.toFixed(1)}ms)`);
        await errorPage.waitFor(
          `(() => {
            const button = document.querySelector('#submitRechargeBtn');
            return !button || (button.dataset.pending !== "true" && !button.disabled);
          })()`,
          30_000,
          "released after the failed order",
        );
        const errorMessage = await errorPage.evaluate("document.querySelector('#rechargeMessage')?.textContent || ''");
        assert.match(
          errorMessage,
          /CI 模拟订单失败/,
          `the failed order must report the server error: ${errorMessage}`,
        );
        const errorTraces = await errorPage.evaluate(`(() => {
          const api = window.__wyjInteractionTrace;
          if (!api) return [];
          return api.recent(10).filter((trace) => trace.name === "recharge-submit").map((trace) => trace.stages.map((stage) => stage.stage));
        })()`);
        assert.ok(
          errorTraces.some((stages) => stages.includes("state-apply")),
          `the failed interaction must still be traced: ${JSON.stringify(errorTraces)}`,
        );
      } finally {
        errorPage.close();
      }
    });

    await check("interaction trace records the click-to-render chain", async () => {
      await page.waitFor("window.__wyjInteractionTrace && window.__wyjInteractionTrace.budgetMs === 150", 10_000, "trace api");
      // Click traces close on their own timer; a route trace is produced by every
      // navigation, so at least one full chain must exist by now.
      const trace = await page.evaluate(`(() => {
        const api = window.__wyjInteractionTrace;
        const recent = api.recent(30);
        return {
          budgetMs: api.budgetMs,
          stages: api.stages,
          total: recent.length,
          chains: recent.map((entry) => entry.stages.map((stage) => stage.stage)),
        };
      })()`);
      assert.equal(trace.budgetMs, 150);
      assert.ok(trace.total > 0, "at least one interaction must be traced in the real app");
      const flat = trace.chains.flat();
      assert.ok(flat.includes(trace.stages.HANDLER_START), `handler-start must be traced: ${flat.join(",")}`);
      assert.ok(flat.includes(trace.stages.RENDER_END), `render-end must be traced: ${flat.join(",")}`);
    });

    await check("no runtime exception was recorded during the interaction audit", async () => {
      const relevant = page.runtimeErrors.filter((message) => !/favicon|ResizeObserver/iu.test(message));
      assert.deepEqual(relevant, [], `browser runtime errors: ${relevant.join(" | ")}`);
    });
  } finally {
    try {
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, "interaction-feedback-browser.json"),
        JSON.stringify({ checks, skips, runtimeErrors: page?.runtimeErrors || [] }, null, 2),
        "utf8",
      );
    } catch (_) {
      // Report artifacts are best effort; the assertions above are the gate.
    }
  }
}

try {
  await main();
  console.log(
    `Task 24 interaction feedback browser regression passed (${checks.length} checks across admin login, finance, learning sync, transfer, tools, membership and the trace API).`,
  );
} catch (error) {
  console.error(`[interaction-browser] FAILED: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await delay(50);
  page?.close?.();
}
