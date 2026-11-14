import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Keep the original fixture and assertions. Catch a failure at each original
// result boundary so the remaining five cases are actually exercised.
const root = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.env.FINANCE_P04_OUTPUT || '');
if (!process.env.FINANCE_P04_OUTPUT || !out.startsWith(path.join(root, 'docs/migration-evidence/finance-p04') + path.sep)) {
  throw Error('Use an owned P04 evidence directory');
}
await mkdir(out, { recursive: true });
const originalPath = path.join(root, 'qa/aeris/state-consistency-browser.mjs');
const original = await readFile(originalPath, 'utf8');
const source = original.replace(/\r\n/g, '\n');
const boundaries = [...source.matchAll(/results\.push\('([^']+)'\);/g)];
if (boundaries.length !== 6) throw Error('Review a changed original browser driver before adapting it');
const start = source.indexOf('  let state=await read();');
const consoleStart = source.indexOf('  console.log(JSON.stringify({kind:', boundaries.at(-1).index);
const consoleEnd = source.indexOf('\n', consoleStart);
if (start < 0 || consoleStart < 0 || consoleEnd < 0) throw Error('Original boundaries changed');
let generated = source.slice(0, start) + '  let state;\n';
let cursor = start;
for (let index = 0; index < boundaries.length; index++) {
  const boundary = boundaries[index];
  const end = index === boundaries.length - 1 ? consoleStart : boundary.index + boundary[0].length;
  let body = source.slice(cursor, end);
  if (index === 0) body = body.replace('let state=await read();', 'state=await read();');
  generated += `  await exercise(${JSON.stringify(boundary[1])}, async () => {\n${body}\n  });\n`;
  cursor = end;
}
generated += `  console.log(JSON.stringify({kind:'LOCAL_HEADLESS_BROWSER_ORIGINAL_FIXTURE_ALL_CASES',tests:attempts.length,pass:attempts.filter(r=>r.status==='PASS').length,fail:attempts.filter(r=>r.status==='FAIL').length,phoneTest:false,backendRequests:0,results:attempts},null,2));\n`;
generated += source.slice(consoleEnd + 1);
const recordPath = path.join(out, 'original-six.ndjson');
await writeFile(recordPath, '', { flag: 'wx' });
const recorder = `const attempts=[];
async function exercise(case_id, run) {
  const started_utc=new Date().toISOString(); let error='';
  try { await run(); } catch (failure) { error=failure.stack || String(failure); process.exitCode=1; }
  const row={case_id,status:error?'FAIL':'PASS',error,started_utc,finished_utc:new Date().toISOString(),fixture:'original omitted-currency fixture; no added account default'};
  attempts.push(row); await evidenceAppend(${JSON.stringify(recordPath)},JSON.stringify(row)+'\\n');
}
`;
generated = generated.replace("const results=[];", 'const results=[];\n' + recorder)
  .replace("import {mkdtemp,readFile} from 'node:fs/promises';", "import {mkdtemp,readFile,appendFile as evidenceAppend} from 'node:fs/promises';")
  .replace("'../../local-backend/browser_harness.mjs'", JSON.stringify(pathToFileURL(path.join(root, 'local-backend/browser_harness.mjs')).href))
  .replace("const root=path.resolve(import.meta.dirname,'../..');", 'const root=' + JSON.stringify(root) + ';');
const fixture = text => text.slice(text.indexOf('const html=`'), text.indexOf('</script>`;') + '</script>`;'.length);
if (fixture(source) !== fixture(generated)) throw Error('Original browser fixture changed');
if ((source.match(/assert\./g) || []).length !== (generated.match(/assert\./g) || []).length) throw Error('An assertion was removed');
const sha = value => createHash('sha256').update(value).digest('hex');
await writeFile(path.join(out, 'driver-preservation.json'), JSON.stringify({
  source: path.relative(root, originalPath), original_sha256: sha(original),
  original_fixture_sha256: sha(fixture(source)), generated_fixture_sha256: sha(fixture(generated)),
  original_assertions: (source.match(/assert\./g) || []).length,
  original_case_ids: boundaries.map(match => match[1]),
  adaptation: 'Only paths, per-case failure capture and result reporting; same original inputs, expected values and assertion statements.',
}, null, 2) + '\n', { flag: 'wx' });
const runner = path.join(out, 'original-six-driver.mjs');
await writeFile(runner, generated, { flag: 'wx' });
await import(pathToFileURL(runner));
