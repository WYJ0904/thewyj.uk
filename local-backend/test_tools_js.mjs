import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { searchTools, TOOLS } from "../js/tools/catalog.js";
import {
  csvString,
  md5Bytes,
  parseCsv,
  validateCsvTable,
} from "../js/tools/file.js";
import {
  exifSummary,
  parseColorValue,
  rgbToHex,
  rgbToHsl,
  stripJpegMetadata,
} from "../js/tools/image.js";
import { randomToolResult, secureUuid } from "../js/tools/random.js";
import { runToolRenderer } from "../js/tools/runner.js";
import { buildVcardPayload, buildWifiPayload } from "../js/tools/temporary.js";
import { getOpenCcSource, loadOpenCcMaps, parseOpenCcCharacterDictionary, runTextOperation } from "../js/tools/text.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const originalCsv = 'name,note\r\nAlice,"line 1\nline 2"\r\nBob,"x,y"';
const rows = parseCsv(originalCsv);
assert.equal(rows.length, 3);
assert.equal(rows[1][1], "line 1\nline 2");
assert.equal(rows[2][1], "x,y");
assert.deepEqual(parseCsv(csvString(rows)), rows);
assert.throws(() => validateCsvTable([["a", "b"], ["only one"]], "broken.csv"), /列数/);

assert.equal(md5Bytes(new TextEncoder().encode("abc")), "900150983cd24fb0d6963f7d28e17f72");

assert.equal(rgbToHex(...parseColorValue("rgb(36, 109, 168)")), "#246da8");
assert.equal(rgbToHex(...parseColorValue("hsl(204, 65%, 40%)")), "#2473a8");
assert.deepEqual(rgbToHsl(36, 109, 168), [207, 65, 40]);
assert.throws(() => parseColorValue("not-a-color"), /HEX/);

const stMap = parseOpenCcCharacterDictionary(fs.readFileSync(path.join(root, "vendor", "opencc-st-characters.txt"), "utf8"));
const tsMap = parseOpenCcCharacterDictionary(fs.readFileSync(path.join(root, "vendor", "opencc-ts-characters.txt"), "utf8"));
assert.ok(stMap.size > 3000);
assert.ok(tsMap.size > 3000);
assert.equal(stMap.get("忆"), "憶");
assert.equal(tsMap.get("憶"), "忆");
let openCcFetchCount = 0;
await loadOpenCcMaps(async (url) => {
  openCcFetchCount += 1;
  if (openCcFetchCount === 1) throw new Error("synthetic first-load race");
  const fileName = url.includes("-st-") ? "opencc-st-characters.txt" : "opencc-ts-characters.txt";
  return fs.readFileSync(path.join(root, "vendor", fileName), "utf8");
});
assert.ok(openCcFetchCount >= 3, "OpenCC loader should retry one failed batch");
assert.equal(getOpenCcSource(), "opencc");
assert.equal(runTextOperation("chinese-convert", "学习网站", "", "", "traditional"), "學習網站");
assert.equal(runTextOperation("camel-case", "Hello world", "", "", ""), "helloWorld");
assert.match(runTextOperation("text-stats", "中文 test", "", "", ""), /中日韩字符：2/);

const syntheticJpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe1, 0x00, 0x06, 0x58, 0x4d, 0x50, 0x00,
  0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb,
  0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
]);
const stripped = stripJpegMetadata(syntheticJpeg);
assert.ok(stripped.length < syntheticJpeg.length);
assert.deepEqual([...stripped.slice(0, 8)], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb]);
assert.match(exifSummary(stripped), /APP1 区块：0/);

assert.equal(
  buildWifiPayload({ name: ' WYJ;Lab:5G\\" ', security: "WPA", password: "safe;pass", hidden: true }),
  'WIFI:T:WPA;S: WYJ\\;Lab\\:5G\\\\\\" ;P:safe\\;pass;H:true;;',
);
assert.equal(buildWifiPayload({ name: "Guest WiFi", security: "nopass", password: "ignored" }), "WIFI:T:nopass;S:Guest WiFi;P:;H:false;;");
assert.throws(() => buildWifiPayload({ name: "x", security: "WPA", password: "short" }), /8/);
assert.throws(() => buildWifiPayload({ name: "x", security: "WEP", password: "bad" }), /WEP/);
const vcard = buildVcardPayload({
  family: "王", given: "小明", phone: "+86 13800000000", email: "wyj@example.com",
  organization: "WYJ, Lab", title: "开发;测试", street: "一号路", city: "上海",
  region: "上海", postal: "200000", country: "中国", website: "https://thewyj.uk/contact",
  note: "第一行\n第二行",
});
assert.match(vcard, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
assert.match(vcard, /N:王;小明;;;/);
assert.match(vcard, /ORG:WYJ\\, Lab/);
assert.match(vcard, /TITLE:开发\\;测试/);
assert.match(vcard, /ADR;TYPE=HOME:;;一号路;上海;上海;200000;中国/);
assert.match(vcard, /NOTE:第一行\\n第二行/);
assert.throws(() => buildVcardPayload({ email: "broken" }), /邮箱/);
assert.throws(() => buildVcardPayload({ website: "javascript:alert(1)" }), /http/);

assert.equal(TOOLS.length, 103);
assert.equal(new Set(TOOLS.map((tool) => tool.id)).size, 103);
assert.ok(searchTools("jsoon").some((tool) => tool.id === "csv-json"));
assert.match(secureUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.match(randomToolResult("dice-d20", {}), /^(?:[1-9]|1\d|20)$/);
assert.equal(runToolRenderer({ category: "text" }, { text: () => "rendered" }), "rendered");
assert.throws(() => runToolRenderer({ category: "missing" }, {}), /没有渲染器/);

console.log("tool module self-checks: 38 passed");
