import { joinBytes } from "./file.js?v=20260901-task19-remediation-r4";

function colorRgb(hex) {
  const normalized = String(hex || "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalized)) throw new Error("请输入有效的 HEX 颜色");
  const full = normalized.length === 3 ? [...normalized].map((char) => char + char).join("") : normalized;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
}

function hslToRgb(hue, saturation, light) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, Number(saturation))) / 100;
  const l = Math.max(0, Math.min(100, Number(light))) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, second, 0] : section < 2 ? [second, chroma, 0] : section < 3 ? [0, chroma, second] : section < 4 ? [0, second, chroma] : section < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const match = l - chroma / 2;
  return [red, green, blue].map((value) => Math.round((value + match) * 255));
}

export function parseColorValue(value) {
  const input = String(value || "").trim();
  if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(input)) return colorRgb(input);
  const rgb = input.match(/^rgba?\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i);
  if (rgb) {
    const percent = /%/.test(input);
    return rgb.slice(1, 4).map((item) => Math.round(Math.max(0, Math.min(percent ? 100 : 255, Number(item))) * (percent ? 2.55 : 1)));
  }
  const hsl = input.match(/^hsla?\(\s*([-\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i);
  if (hsl) return hslToRgb(hsl[1], hsl[2], hsl[3]);
  throw new Error("请输入 HEX、RGB 或 HSL 颜色，例如 #246da8、rgb(36,109,168) 或 hsl(204,65%,40%)");
}

export function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl(red, green, blue) {
  const values = [red, green, blue].map((value) => value / 255);
  const max = Math.max(...values); const min = Math.min(...values);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(light * 100)];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  let hue = max === values[0] ? ((values[1] - values[2]) / delta) % 6 : max === values[1] ? (values[2] - values[0]) / delta + 2 : (values[0] - values[1]) / delta + 4;
  hue = Math.round(hue * 60); if (hue < 0) hue += 360;
  return [hue, Math.round(saturation * 100), Math.round(light * 100)];
}

function readExifField(bytes, view, tiffStart, entryOffset, littleEndian) {
  if (entryOffset + 12 > bytes.length) return null;
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const unitSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 0;
  const byteLength = count * unitSize;
  if (!unitSize || !Number.isSafeInteger(byteLength) || byteLength > bytes.length) return null;
  const dataOffset = byteLength <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, littleEndian);
  if (dataOffset < 0 || dataOffset + byteLength > bytes.length) return null;
  if (type === 2) return new TextDecoder("ascii").decode(bytes.slice(dataOffset, dataOffset + byteLength)).replace(/\0+$/, "").trim();
  if (type === 3) return view.getUint16(dataOffset, littleEndian);
  if (type === 4) return view.getUint32(dataOffset, littleEndian);
  return null;
}

function parseExifIfd(bytes, view, tiffStart, relativeOffset, littleEndian) {
  const start = tiffStart + Number(relativeOffset || 0);
  if (start < 0 || start + 2 > bytes.length) return new Map();
  const count = view.getUint16(start, littleEndian);
  if (count > 512 || start + 2 + count * 12 > bytes.length) return new Map();
  const fields = new Map();
  for (let index = 0; index < count; index += 1) {
    const entry = start + 2 + index * 12;
    const tag = view.getUint16(entry, littleEndian);
    const value = readExifField(bytes, view, tiffStart, entry, littleEndian);
    if (value !== null && value !== "") fields.set(tag, value);
  }
  return fields;
}

export function exifSummary(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "不是 JPEG 文件；当前查看器只解析 JPEG EXIF，图片仍然只在本机读取。";
  let offset = 2;
  let app1 = 0;
  let fields = new Map();
  let exifFields = new Map();
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    const segmentEnd = offset + 2 + length;
    if (length < 2 || segmentEnd > bytes.length) break;
    const payload = offset + 4;
    if (marker === 0xe1) {
      app1 += 1;
      const exifHeader = bytes[payload] === 0x45 && bytes[payload + 1] === 0x78 && bytes[payload + 2] === 0x69 && bytes[payload + 3] === 0x66 && bytes[payload + 4] === 0 && bytes[payload + 5] === 0;
      if (exifHeader) {
        const tiffStart = payload + 6;
        if (tiffStart + 8 <= segmentEnd) {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
          const bigEndian = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
          if ((littleEndian || bigEndian) && view.getUint16(tiffStart + 2, littleEndian) === 42) {
            fields = parseExifIfd(bytes, view, tiffStart, view.getUint32(tiffStart + 4, littleEndian), littleEndian);
            if (fields.has(0x8769)) exifFields = parseExifIfd(bytes, view, tiffStart, fields.get(0x8769), littleEndian);
          }
        }
      }
    }
    offset = segmentEnd;
  }
  const orientationNames = { 1: "正常", 2: "水平镜像", 3: "旋转 180°", 4: "垂直镜像", 5: "镜像并旋转 90°", 6: "旋转 90°", 7: "镜像并旋转 270°", 8: "旋转 270°" };
  return [
    `JPEG APP1 区块：${app1}`,
    `相机厂商：${fields.get(0x010f) || "未记录"}`,
    `相机型号：${fields.get(0x0110) || "未记录"}`,
    `拍摄时间：${exifFields.get(0x9003) || fields.get(0x0132) || "未记录"}`,
    `镜头型号：${exifFields.get(0xa434) || "未记录"}`,
    `方向：${orientationNames[fields.get(0x0112)] || fields.get(0x0112) || "未记录"}`,
    `图像尺寸：${exifFields.get(0xa002) && exifFields.get(0xa003) ? `${exifFields.get(0xa002)} × ${exifFields.get(0xa003)}` : "未记录"}`,
    `GPS 标签：${fields.has(0x8825) ? "检测到，分享前建议移除" : "未检测到"}`,
    "说明：仅在浏览器本地读取，不显示具体定位坐标。",
  ].join("\n");
}

export function stripJpegMetadata(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff || offset + 1 >= bytes.length) { parts.push(bytes.slice(offset)); break; }
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) { parts.push(bytes.slice(offset)); break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(bytes.slice(offset, offset + 2)); offset += 2; continue; }
    if (offset + 4 > bytes.length) break;
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    const segmentEnd = offset + 2 + length;
    if (length < 2 || segmentEnd > bytes.length) { parts.push(bytes.slice(offset)); break; }
    if (marker !== 0xe1 && marker !== 0xfe) parts.push(bytes.slice(offset, segmentEnd));
    offset = segmentEnd;
  }
  return joinBytes(parts);
}
