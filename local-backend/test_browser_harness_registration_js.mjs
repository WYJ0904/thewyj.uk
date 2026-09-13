import assert from "node:assert/strict";

import { registerAndSignIn } from "./browser_harness.mjs";

/**
 * Regression for main CI run 34741604805.
 *
 * The Cloud-only job hit:
 *   1. `POST /api/register 201 Created`
 *   2. the localized「注册成功」 indicator did not appear inside the wait window
 *   3. the helper retried the *whole* attempt → `POST /api/register 409 Conflict`
 *   4. the job failed before the transfer upload even started
 *
 * The state machine now treats the HTTP answer as the evidence and only retries
 * the registration request when *no answer at all* was observed.
 */

function fakePage({ registerStatuses = [201], registrationIndicatorTimesOut = false, dashboardFails = false, loginError = "" } = {}) {
  const calls = {
    navigations: [],
    registerClicks: 0,
    loginClicks: 0,
    waits: [],
    fields: [],
  };
  const page = {
    watchResponses: (pattern) => {
      assert.equal(pattern, "/api/register");
      return {
        entries: registerStatuses.map((status) => ({ url: "/api/register", status })),
        statuses: () => registerStatuses.slice(),
        count: () => registerStatuses.length,
      };
    },
    navigate: async (path) => {
      calls.navigations.push(path);
    },
    waitFor: async (condition, timeout, label) => {
      calls.waits.push(label);
      if (label === "registration success indicator" && registrationIndicatorTimesOut) {
        throw new Error("timeout waiting for registration success indicator");
      }
      if (label.includes("dashboard") && dashboardFails) {
        throw new Error("timeout waiting for the dashboard");
      }
      return true;
    },
    setFields: async (fields) => {
      calls.fields.push(fields);
    },
    click: async (selector) => {
      if (selector === "#registerSubmitBtn") {
        calls.registerClicks += 1;
        assert.ok(calls.registerClicks <= 2, "the harness must never send more than two registration requests");
      }
      if (selector === "#loginSubmitBtn") calls.loginClicks += 1;
    },
    evaluate: async (expression) => {
      if (expression.includes("registerSubmitBtn")) return true;
      if (expression.includes("loginError")) return loginError;
      return false;
    },
  };
  return { page, calls };
}

const options = { username: "harness-user", secret: "Harness-Secret-2026!" };

// 1. The exact main-CI race: the server created the account (201) but the UI
//    indicator timed out. The helper must sign in with that account instead of
//    registering again.
{
  const { page, calls } = fakePage({ registerStatuses: [201], registrationIndicatorTimesOut: true });
  const result = await registerAndSignIn(page, options);
  assert.equal(calls.registerClicks, 1, "a 201 answer must never trigger a second registration");
  assert.equal(calls.loginClicks, 1, "the helper must sign in with the created account");
  assert.equal(
    result.registrationStatuses.filter((status) => status >= 200 && status < 300).length,
    1,
    "exactly one account creation must be observed",
  );
  assert.equal(result.uiObserved, false);
  assert.equal(result.recoveredFromUiTimeout, true);
  assert.equal(result.duplicateRegistrationObserved, false, "no 409 may be produced");
  assert.ok(
    calls.navigations.some((path) => path.startsWith("/login")),
    `the helper must navigate to /login, saw ${JSON.stringify(calls.navigations)}`,
  );
  assert.ok(
    calls.waits.some((label) => label.includes("dashboard")),
    "the authenticated dashboard must still be asserted",
  );
}

// 2. The fast path keeps working exactly as before.
{
  const { page, calls } = fakePage({ registerStatuses: [201] });
  const result = await registerAndSignIn(page, options);
  assert.equal(calls.registerClicks, 1);
  assert.equal(calls.loginClicks, 1);
  assert.equal(result.uiObserved, true);
  assert.equal(result.recoveredFromUiTimeout, false);
  assert.equal(result.registrationCreated, true);
}

// 3. No answer at all (the click never reached the server): exactly one retry of
//    the same request is allowed, then the login path still decides the outcome.
{
  const { page, calls } = fakePage({ registerStatuses: [] });
  const result = await registerAndSignIn(page, options);
  assert.equal(calls.registerClicks, 2, "a request with no answer at all may be retried once");
  assert.equal(calls.loginClicks, 1);
  assert.equal(result.registrationCreated, false);
  assert.deepEqual(result.registrationStatuses, []);
}

// 4. An existing account (409) is reported, not disguised as a fresh creation,
//    and it still must be usable through the login path.
{
  const { page, calls } = fakePage({ registerStatuses: [409] });
  const result = await registerAndSignIn(page, options);
  assert.equal(calls.registerClicks, 1, "a 409 answer must not be retried");
  assert.equal(calls.loginClicks, 1);
  assert.equal(result.duplicateRegistrationObserved, true);
  assert.equal(result.registrationCreated, false);
}

// 5. A login that really fails must surface the evidence instead of silently
//    passing the preparation phase.
{
  const { page, calls } = fakePage({ registerStatuses: [201], dashboardFails: true, loginError: "用户名或密钥不正确" });
  await assert.rejects(
    () => registerAndSignIn(page, options),
    (error) => {
      assert.match(error.message, /could not sign in after registration/);
      assert.match(error.message, /用户名或密钥不正确/);
      assert.match(error.message, /\[201\]/);
      return true;
    },
  );
  assert.equal(calls.registerClicks, 1, "a failed login must not be answered with another registration");
}

console.log(
  "Task 24 browser harness registration checks passed (201 + delayed UI indicator -> single registration and login, fast path, no-answer retry, 409 reporting, failed-login evidence).",
);
