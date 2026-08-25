const PAGE_WIDTH = 1000;
const PAGE_HEIGHT = 1414;
const PAGE_MARGIN = 72;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const FONT_FAMILY = 'system-ui, "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';
const MAX_ENTRIES = 250;

function joinBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function pdfBytesFromJpegs(images) {
  if (!Array.isArray(images) || !images.length) throw new TypeError("PDF 至少需要一页");
  const encoder = new TextEncoder();
  const objectCount = 2 + images.length * 3;
  const pageIds = images.map((_, index) => 3 + index * 3);
  const objects = new Map();
  objects.set(1, encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, encoder.encode(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
  images.forEach((image, index) => {
    if (!image?.bytes?.length || image.width < 1 || image.height < 1) throw new TypeError("PDF 页面图片无效");
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const pageWidth = 595;
    const pageHeight = 842;
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const width = Math.round(image.width * scale * 100) / 100;
    const height = Math.round(image.height * scale * 100) / 100;
    const x = Math.round((pageWidth - width) / 2 * 100) / 100;
    const y = Math.round((pageHeight - height) / 2 * 100) / 100;
    const commands = encoder.encode(`q ${width} 0 0 ${height} ${x} ${y} cm /Im${index + 1} Do Q`);
    objects.set(pageId, encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${index + 1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.set(imageId, joinBytes([
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      encoder.encode("\nendstream"),
    ]));
    objects.set(contentId, joinBytes([
      encoder.encode(`<< /Length ${commands.length} >>\nstream\n`),
      commands,
      encoder.encode("\nendstream"),
    ]));
  });

  const parts = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let offset = parts[0].length;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = offset;
    const object = objects.get(id);
    if (!object) throw new TypeError(`PDF 对象 ${id} 缺失`);
    const part = joinBytes([encoder.encode(`${id} 0 obj\n`), object, encoder.encode("\nendobj\n")]);
    parts.push(part);
    offset += part.length;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return joinBytes(parts);
}

function safeText(value, maximum = 500) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maximum);
}

function wrapText(context, value, maximumWidth) {
  const text = safeText(value);
  if (!text) return [""];
  const lines = [];
  let line = "";
  for (const character of text) {
    const candidate = `${line}${character}`;
    if (line && context.measureText(candidate).width > maximumWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("浏览器无法生成 PDF 页面"));
        return;
      }
      try {
        resolve({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
      } catch (_) {
        reject(new Error("浏览器无法读取 PDF 页面"));
      }
    }, "image/jpeg", 0.9);
  });
}

function createPageCanvas(documentRef) {
  const canvas = documentRef.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器不支持本地 PDF 画布");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = "top";
  return { canvas, context, y: PAGE_MARGIN };
}

function normalizedEntries(wrongBook) {
  return Object.entries(wrongBook && typeof wrongBook === "object" ? wrongBook : {})
    .filter(([, info]) => info && typeof info === "object" && !Array.isArray(info))
    .slice(-MAX_ENTRIES)
    .sort((left, right) => Number(right[1].wrong_count || 0) - Number(left[1].wrong_count || 0));
}

export async function createWrongBookPdf(wrongBook, options = {}, documentRef = globalThis.document) {
  if (!documentRef?.createElement) throw new Error("当前环境不支持浏览器本地 PDF");
  const entries = normalizedEntries(wrongBook);
  if (!entries.length) throw new Error("错题本为空");
  const pages = [];
  let page = createPageCanvas(documentRef);

  const finishPage = async () => {
    pages.push(await canvasToJpeg(page.canvas));
    page.canvas.width = 1;
    page.canvas.height = 1;
  };
  const newPage = async () => {
    await finishPage();
    page = createPageCanvas(documentRef);
  };
  const ensureSpace = async (height) => {
    if (page.y + height <= PAGE_HEIGHT - PAGE_MARGIN) return;
    await newPage();
  };
  const drawText = async (value, style = {}) => {
    const size = Number(style.size || 24);
    const lineHeight = Number(style.lineHeight || Math.round(size * 1.45));
    page.context.font = `${style.weight || 400} ${size}px ${FONT_FAMILY}`;
    page.context.fillStyle = style.color || "#1f2937";
    const lines = wrapText(page.context, value, CONTENT_WIDTH - Number(style.indent || 0));
    for (const line of lines) {
      await ensureSpace(lineHeight);
      page.context.fillText(line, PAGE_MARGIN + Number(style.indent || 0), page.y);
      page.y += lineHeight;
    }
    page.y += Number(style.after || 0);
  };

  const title = safeText(options.title || "WYJ的网站错题本", 80);
  await drawText(title, { size: 38, lineHeight: 52, weight: 700, color: "#0f172a", after: 10 });
  await drawText("错题练习册", { size: 25, lineHeight: 36, weight: 600, color: "#2563eb", after: 14 });
  const meta = options.meta && typeof options.meta === "object" ? options.meta : {};
  const metaLines = [
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `生成方式：浏览器本地处理`,
    meta.profile ? `使用者：${safeText(meta.profile, 80)}` : "",
    meta.scope ? `范围：${safeText(meta.scope, 40)}` : "",
    meta.language ? `语言：${safeText(meta.language, 40)}` : "",
    meta.practice_mode ? `练习：${safeText(meta.practice_mode, 40)}` : "",
    meta.grading_mode ? `判卷模式：${safeText(meta.grading_mode, 40)}` : "",
  ].filter(Boolean);
  for (const line of metaLines) await drawText(line, { size: 19, lineHeight: 29, color: "#475569" });
  const totalWrong = entries.reduce((total, [, info]) => {
    const count = Number(info.wrong_count || 0);
    return total + (Number.isFinite(count) ? Math.max(0, count) : 0);
  }, 0);
  page.y += 12;
  await drawText(`错题数：${entries.length} 个；累计错误：${totalWrong} 次`, { size: 21, lineHeight: 32, weight: 600, after: 8 });
  await drawText("复习建议：先遮住标准答案，完成订正后再核对。", { size: 19, lineHeight: 29, color: "#475569", after: 18 });

  for (const [index, [word, info]] of entries.entries()) {
    const accepted = Array.isArray(info.accepted) ? info.accepted.map((item) => safeText(item, 120)).filter(Boolean).slice(0, 12) : [];
    const skipped = Boolean(info.skipped) || safeText(info.last_answer) === "（跳过）";
    await ensureSpace(250);
    page.context.strokeStyle = "#cbd5e1";
    page.context.lineWidth = 2;
    page.context.beginPath();
    page.context.moveTo(PAGE_MARGIN, page.y);
    page.context.lineTo(PAGE_WIDTH - PAGE_MARGIN, page.y);
    page.context.stroke();
    page.y += 18;
    const wrongCount = Number(info.wrong_count || 0);
    await drawText(`${index + 1}. ${safeText(word, 240)}  [${skipped ? "已跳过" : `错 ${Number.isFinite(wrongCount) ? Math.max(0, wrongCount) : 0} 次`}]`, { size: 27, lineHeight: 38, weight: 700, color: "#0f172a", after: 5 });
    await drawText(skipped ? "我的答案：已跳过" : `我的答案：${safeText(info.last_answer, 240) || "（未作答）"}`, { size: 20, lineHeight: 30, indent: 18 });
    await drawText(`正确答案：${safeText(info.correct_answer, 240) || "（未保存）"}`, { size: 20, lineHeight: 30, indent: 18, weight: 600 });
    if (accepted.length) await drawText(`可接受答案：${safeText(accepted.join("、"), 600)}`, { size: 18, lineHeight: 28, indent: 18, color: "#475569" });
    await drawText("订正：________________________________________", { size: 18, lineHeight: 28, indent: 18, color: "#64748b" });
    await drawText("复习：□ 今天  □ 3天后  □ 7天后", { size: 18, lineHeight: 28, indent: 18, color: "#64748b" });
    if (info.last_time) await drawText(`记录时间：${safeText(info.last_time, 80)}`, { size: 16, lineHeight: 25, indent: 18, color: "#64748b", after: 14 });
  }
  await finishPage();
  return new Blob([pdfBytesFromJpegs(pages)], { type: "application/pdf" });
}
