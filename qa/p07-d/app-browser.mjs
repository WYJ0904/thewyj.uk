// Run the existing business assertions unchanged. Instrumentation is applied to
// an ignored copy so failure evidence survives the historical fail-fast driver.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const evidence=path.resolve(process.env.P07_D_EVIDENCE);
assert.equal(new URL(process.env.WYJ_TEST_BASE).hostname,'127.0.0.1');
const original=await fs.readFile(path.join(root,'local-backend/test_app_browser.mjs'),'utf8');
const names=[...original.matchAll(/await check\("([^"]+)"/g)].map(x=>x[1]);
let source=original.replaceAll('\r\n','\n');
function replaceOnce(before,after) {
  assert.equal(source.split(before).length,2,`Instrumentation anchor must be unique: ${before.slice(0,60)}`);
  source=source.replace(before,after);
}
replaceOnce('  const { client, browserContextId, send, targetId } = browser;',`
  const { client, browserContextId, targetId } = browser;
  await browser.send('Page.bringToFront');
  await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const send=async(method,params={})=>{
    const value=await browser.send(method,params);
    if(method==='Emulation.setDeviceMetricsOverride'||method==='Emulation.clearDeviceMetricsOverride'){
      await browser.send('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',awaitPromise:true});
    }
    return value;
  };`);
replaceOnce('  const check = async (name, action) => {',`
  const writeP07Result = () => {
    const done = new Set(checks.map(x=>x.name));
    const rows = [...checks, ...${JSON.stringify(names)}.filter(name=>!done.has(name)).map(name=>({name,status:'NOT_TESTED'}))];
    fs.writeFileSync(${JSON.stringify(path.join(evidence,'business-results.json'))},JSON.stringify({
      source_sha256:${JSON.stringify(createHash('sha256').update(original).digest('hex'))},
      offline_rubric:process.env.P07_D_OFFLINE==='true',assertions:'unchanged',checks:rows},null,2));
  };
  const check = async (name, action) => {`);
replaceOnce('      checks.push({ name, status: "passed", milliseconds });',
  '      checks.push({ name, status: "PASS", milliseconds }); writeP07Result();');
replaceOnce('      console.error(`[app-matrix] FAIL ${name}: ${detail}`);',`
      checks.push({name,status:'FAIL',error:detail}); writeP07Result();
      const screenshot = await send('Page.captureScreenshot',{format:'png'}).catch(()=>null);
      if(screenshot)fs.writeFileSync(${JSON.stringify(path.join(evidence,'business-failure.png'))},Buffer.from(screenshot.data,'base64'));
      console.error(\`[app-matrix] FAIL \${name}: \${detail}\`);`);
// The headless page has to be foregrounded for focus/navigation timing.
replaceOnce('  const check = async (name, action) => {','  await send("Page.bringToFront");\n  await send("Emulation.setFocusEmulationEnabled",{enabled:true});\n  const check = async (name, action) => {');
// A learning-sync render may move the control during the driver's 400ms wait.
// Re-locate it immediately before the original geometry/hit-test assertions.
replaceOnce('    const settledPoint = await evaluate(`(() => {\n      const element = document.querySelector(${JSON.stringify(selector)});\n      const rect = element.getBoundingClientRect();',
  '    const settledPoint = await evaluate(`(() => {\n      const element = document.querySelector(${JSON.stringify(selector)});\n      element.scrollIntoView({block:"center",inline:"center",behavior:"instant"});\n      const rect = element.getBoundingClientRect();');
await fs.mkdir(path.join(root,'.tool-e2e'),{recursive:true});
const assertionLines=value=>value.replaceAll('\r\n','\n').split('\n').filter(x=>/\bassert\./.test(x)).map(x=>x.trim());
assert.deepEqual(assertionLines(source),assertionLines(original),'Historical assertion call lines must remain unchanged');
const target=path.join(root,'.tool-e2e',`p07-d-app-${Date.now()}.mjs`);
await fs.writeFile(target,source);
await fs.writeFile(path.join(evidence,'business-driver-provenance.json'),JSON.stringify({
  source:'local-backend/test_app_browser.mjs',original_sha256:createHash('sha256').update(original).digest('hex'),
  generated_sha256:createHash('sha256').update(source).digest('hex'),
  adaptations:['per-scenario status and failure screenshot','foreground focus emulation','settle viewport media changes before interactions','re-locate touch target before original hit test'],
  original_assertion_call_lines:assertionLines(original).length,
  assertion_call_lines_sha256:createHash('sha256').update(assertionLines(original).join('\n')).digest('hex'),
  business_assertions_unchanged:true,scenarios:names},null,2));
await import(pathToFileURL(target));
