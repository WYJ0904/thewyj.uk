import assert from "node:assert/strict";

import { createWrongBookPdf } from "../js/language/pdf.js";

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9);
const renderedText = [];

function testDocument() {
  return {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      const context = {
        fillStyle: "",
        font: "",
        lineWidth: 0,
        strokeStyle: "",
        textBaseline: "",
        beginPath() {},
        fillRect() {},
        lineTo() {},
        moveTo() {},
        stroke() {},
        fillText(text) { renderedText.push(String(text)); },
        measureText(text) { return { width: Array.from(String(text)).length * 16 }; },
      };
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
        toBlob(callback, type) {
          assert.equal(type, "image/jpeg");
          callback(new Blob([jpeg], { type }));
        },
      };
    },
  };
}

function parsePdf(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4\n"), "PDF header is missing");
  assert.ok(text.endsWith("%%EOF"), "PDF trailer is missing");
  const startXref = /startxref\n(\d+)\n%%EOF$/u.exec(text);
  assert.ok(startXref, "startxref is missing");
  const xrefOffset = Number(startXref[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), "xref", "startxref points to the wrong byte");
  const xref = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n/u.exec(text.slice(xrefOffset));
  assert.ok(xref, "xref table is malformed");
  const size = Number(xref[1]);
  const entries = xref[2].trimEnd().split("\n");
  assert.equal(entries.length, size, "xref entry count does not match /Size");
  for (let objectId = 1; objectId < size; objectId += 1) {
    const entry = /^(\d{10}) 00000 n ?$/u.exec(entries[objectId]);
    assert.ok(entry, `xref entry ${objectId} is malformed: ${JSON.stringify(entries[objectId])}`);
    const offset = Number(entry[1]);
    const marker = `${objectId} 0 obj`;
    assert.equal(text.slice(offset, offset + marker.length), marker, `xref object ${objectId} points to the wrong byte`);
  }
  const count = Number(/\/Type \/Pages \/Count (\d+)/u.exec(text)?.[1] || 0);
  const pageObjects = (text.match(/\/Type \/Page(?!s)\b/gu) || []).length;
  const imageObjects = (text.match(/\/Subtype \/Image\b/gu) || []).length;
  assert.equal(pageObjects, count, "page tree count does not match page objects");
  assert.equal(imageObjects, count, "each page must contain one JPEG image");
  assert.equal((text.match(/\/Filter \/DCTDecode\b/gu) || []).length, count, "page images must use JPEG streams");
  assert.equal((text.match(/\xff\xd8/gu) || []).length, count, "each image stream must contain a JPEG signature");
  return { count, size };
}

const wrongBook = {};
for (let index = 0; index < 28; index += 1) {
  const skipped = index === 1;
  wrongBook[`词条-${index + 1}`] = {
    accepted: [`释义-${index + 1}`, `同义-${index + 1}`],
    correct_answer: `标准答案-${index + 1}`,
    last_answer: skipped ? "（跳过）" : `错误答案-${index + 1}`,
    last_time: "2026-08-24T12:00:00.000Z",
    skipped,
    wrong_count: skipped ? 1 : index + 1,
  };
}

const blob = await createWrongBookPdf(wrongBook, {
  title: "Task 15 本地 PDF 语义回归",
  meta: {
    grading_mode: "严格",
    language: "日语",
    practice_mode: "释义",
    profile: "隔离测试账户",
    scope: "历史错题",
  },
}, testDocument());

assert.equal(blob.type, "application/pdf");
const artifact = parsePdf(new Uint8Array(await blob.arrayBuffer()));
assert.ok(artifact.count > 1, "large wrong book should produce multiple pages");
const drawOutput = renderedText.join("\n");
const compactDrawOutput = renderedText.join("");
for (const expected of [
  "Task 15 本地 PDF 语义回归",
  "生成方式:浏览器本地处理",
  "使用者:隔离测试账户",
  "我的答案:已跳过",
  "正确答案:标准答案-2",
  "可接受答案:释义-2、同义-2",
]) assert.ok(drawOutput.includes(expected) || compactDrawOutput.includes(expected), `rendered PDF content is missing: ${expected}`);

console.log(`Task 15 browser-local PDF checks passed: ${artifact.count} pages, ${artifact.size - 1} objects.`);
