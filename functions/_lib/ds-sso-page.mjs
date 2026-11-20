import { createSessionToken } from './task12-crypto.mjs';

export const secureHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function callbackUrl(client, state, code) {
  const url = new URL(client.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('iss', client.issuer);
  if (code) url.searchParams.set('code', code);
  else url.searchParams.set('error', 'access_denied');
  return url.href;
}

export function authorizationPage(client, input) {
  const cancel = callbackUrl(client, input.state).replaceAll('&', '&amp;');
  const nonce = createSessionToken();
  return new Response(`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>授权 DS 登录 · Aeris</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; font: 16px/1.6 system-ui, sans-serif; }
  body { margin: 0; padding: 24px; }
  main { max-width: 36rem; margin: 7vh auto; }
  h1 { line-height: 1.25; }
  form, nav { margin-block: 1.5rem; }
  input, button { display: block; box-sizing: border-box; max-width: 100%; font: inherit; padding: .55rem .75rem; margin-block: .35rem .9rem; }
  a { margin-inline-end: 1rem; }
</style>
<main>
  <h1>授权 DS 使用 Aeris 身份</h1>
  <p id="sso-status" role="status">正在检查 Aeris 登录状态…</p>
  <form id="sso-approval" method="post" hidden>
    <p>当前账户 <strong id="sso-account"></strong>。DS 将收到用于登录的 Aeris 账户标识。</p>
    <label for="sso-password">重新输入 Aeris 密码</label>
    <input id="sso-password" type="password" required autocomplete="current-password">
    <button type="submit">验证并授权 DS</button>
  </form>
  <form id="sso-mfa" method="post" hidden>
    <label id="sso-mfa-label" for="sso-mfa-code">安全验证码</label>
    <input id="sso-mfa-code" required autocomplete="one-time-code">
    <button type="submit">确认并返回 DS</button>
  </form>
  <nav aria-label="授权操作">
    <a href="/">在 Aeris 登录或切换账户</a>
    <a id="sso-cancel" href="${cancel}">取消并返回 DS</a>
  </nav>
  <p>在 Aeris 完成登录或账户切换后，使用浏览器返回此页。</p>
</main>
<script type="module" src="/js/account/ds-sso.js"></script>
</html>`, {
    headers: {
      ...secureHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'nonce-" + nonce
        + "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
