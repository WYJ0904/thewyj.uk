import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CdpClient, delay } from '../../local-backend/browser_harness.mjs';

// Chromium's real profile zoom preference initializes HostZoomMap. This uses
// the normal default page, not a CDP incognito context or device emulation.
// Primary-source provenance is recorded with every run. No existing profile
// is opened, copied, edited or deleted.
export const zoomSources = [
  'https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc',
  'https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/page/page_zoom.cc',
];
export async function openZoomedBrowser(factor, directory, origin = 'http://127.0.0.1:8898') {
  assert([1, 2, 4].includes(factor));
  assert(['http://127.0.0.1:8898', 'http://127.0.0.1:8894',
    'https://ac8cec2c.thewyj-p07-ui-rc.pages.dev'].includes(origin));
  await fs.mkdir(directory, { recursive: false });
  const profile = path.join(directory, 'private-profile');
  await fs.mkdir(path.join(profile, 'Default'), { recursive: true });
  const preferences = { partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } } };
  await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify(preferences), { flag: 'wx' });
  const executable = process.env.AERIS_QA_CHROME || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
  const log = openSync(path.join(directory, 'private-chrome.log'), 'ax');
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--window-size=1440,960',
    `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', log, log] });
  closeSync(log); child.unref();
  let launchError;
  child.on('error', error => { launchError = error; });
  let endpoint, pageClient, browserClient;
  const runtimeErrors = [], dialogs = [];
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try { const port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) { endpoint = `http://127.0.0.1:${port}`; break; } } catch {}
      await delay(100);
    }
    assert(endpoint, 'Owned zoom browser did not publish a loopback endpoint');
    const version = await fetch(`${endpoint}/json/version`).then(response => response.json());
    browserClient = new CdpClient(version.webSocketDebuggerUrl); await browserClient.connect();
    const targets = await fetch(`${endpoint}/json/list`).then(response => response.json());
    const target = targets.find(value => value.type === 'page' && value.url === 'about:blank'); assert(target);
    pageClient = new CdpClient(target.webSocketDebuggerUrl); await pageClient.connect();
    const send = (method, params = {}) => pageClient.send(method, params);
    pageClient.listeners.add(message => {
      if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') dialogs.push(message.params.message);
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Accessibility.enable'); await send('Network.enable');
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const waitFor = async (condition, timeout = 30000, label = condition) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { try { if (await evaluate(`Boolean(${condition})`)) return; } catch {} await delay(80); }
      throw new Error(`Timeout waiting for ${label}`);
    };
    const navigate = async route => { assert(route.startsWith('/') && !route.startsWith('//')); await send('Page.navigate', { url: origin + route }); await waitFor("document.readyState!=='loading' && document.getElementById('appShell') && !document.getElementById('appShell').classList.contains('app-shell-pending')"); };
    const setFields = fields => evaluate(String.raw`(() => {for(const [selector,value] of Object.entries(${JSON.stringify(fields)})){const node=document.querySelector(selector);if(!node)throw new Error('Missing control '+selector);node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()`);
    return { send, evaluate, waitFor, navigate, setFields, runtimeErrors, dialogs, cdpUrl: endpoint,
      zoom: { requestedFactor: factor, preference: 'partition.default_zoom_level.x', level: preferences.partition.default_zoom_level.x,
        mechanism: 'Chromium browser profile default zoom; no CSS zoom, page-scale or device-metric override', browser: version.Browser, sources: zoomSources },
      close: async () => { try { await Promise.race([browserClient.send('Browser.close'), delay(3000)]); } finally { pageClient.close(); browserClient.close(); if (child.exitCode === null && !child.killed) child.kill(); } },
    };
  } catch (error) {
    pageClient?.close(); browserClient?.close(); if (child.exitCode === null && !child.killed) child.kill(); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.resolve(process.argv[2] || `artifacts/aeris-browser-zoom-proof-${Date.now()}`);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.mkdir(output, { recursive: false });
  const rows = [];
  for (const factor of [1, 2, 4]) {
    let page;
    try {
      page = await openZoomedBrowser(factor, path.join(output, `browser-${factor * 100}`));
      await page.send('Page.navigate', { url: 'data:text/html,<title>Owned browser zoom proof</title><p>Aeris local browser zoom probe</p>' });
      await delay(100);
      rows.push({ ...page.zoom, actual: await page.evaluate('({innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,pageScale:visualViewport.scale,cssZoom:getComputedStyle(document.documentElement).zoom})') });
    } catch (error) { rows.push({ requestedFactor: factor, status: 'FAIL', error: error.stack }); }
    finally { if (page) await page.close(); }
  }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ output, rows }, null, 2));
  const first = rows[0]?.actual;
  assert(first, '100% browser baseline missing');
  for (const row of rows) {
    assert(row.actual, 'Zoom browser launch failed');
    assert(Math.abs(row.actual.dpr / first.dpr - row.requestedFactor) < .01, 'Real browser DPR zoom ratio must match request');
    assert(Math.abs(row.actual.innerWidth * row.requestedFactor - first.innerWidth) <= 2, 'Real layout viewport must shrink with browser zoom');
    assert.equal(row.actual.pageScale, 1, 'Pinch page-scale must remain unchanged'); assert.equal(row.actual.cssZoom, '1');
  }
}
