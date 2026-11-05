import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Artificial vocabulary semantics required by the historical A-H UI scenario.
// This is neither a dictionary correction nor an AI-quality fixture.
export const WORDS = Object.freeze(['amber','birch','cedar','delta','elm','fir',
  'garden','harbor','island','jasmine','kernel','linen','mango','nectar','orbit',
  'apple','book','cat','dog','earth','flower','green','house','idea','juice']);
export function offlineRubric(env, word) {
  if (env?.P07_D_ISOLATED_RUBRIC !== 'synthetic-browser-only' || !WORDS.includes(word)) return null;
  return {rubric:{language:'英语',gloss:'测试释义',accepted:[],
    notes:'P07-D synthetic UI fixture; not linguistic evidence',reading:''},source:'p07_d_synthetic'};
}
export async function installOfflineRubric(runtime, evidence) {
  const root = path.resolve(import.meta.dirname,'../..');
  const resolved = path.resolve(runtime);
  assert.ok(resolved.startsWith(path.join(root,'.wrangler')+path.sep));
  const target = path.join(resolved,'functions/_lib/task15-service.mjs');
  const before = await fs.readFile(target,'utf8');
  const anchor = '  const common = COMMON_RUBRICS[word] || COMMON_RUBRICS[normalizeWord(word, "english")];';
  assert.equal(before.split(anchor).length,2,'Runtime injection must match exactly once');
  const after = `import {offlineRubric} from './p07-d-offline-rubric.mjs';\n`+
    before.replace(anchor,'  const synthetic = offlineRubric(context.env, word);\n  if (synthetic) return synthetic;\n'+anchor);
  await fs.copyFile(new URL(import.meta.url),path.join(resolved,'functions/_lib/p07-d-offline-rubric.mjs'));
  // The installed worker must not import Node-only tooling. Keep just the pure adapter.
  await fs.writeFile(path.join(resolved,'functions/_lib/p07-d-offline-rubric.mjs'),
    `const WORDS=${JSON.stringify(WORDS)};\nexport ${offlineRubric.toString()}\n`);
  await fs.writeFile(target,after);
  const sha = value => createHash('sha256').update(value).digest('hex');
  await fs.writeFile(path.join(evidence,'offline-rubric-provenance.json'),JSON.stringify({
    synthetic:true,real_ai:false,workers_ai_enabled:false,scope:'copied ignored runtime only',
    module:'functions/_lib/task15-service.mjs',source_sha256:sha(before),runtime_sha256:sha(after),
    words:WORDS,gloss:'测试释义',unchanged_production_file:true},null,2));
}
