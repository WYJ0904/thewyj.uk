function uint32(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function uint16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

export function joinBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function zipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = encoder.encode(String(entry.name).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180) || "file");
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);
    const local = joinBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name, data,
    ]);
    localParts.push(local);
    centralParts.push(joinBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), name,
    ]));
    offset += local.length;
  });
  const central = joinBytes(centralParts);
  const end = joinBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length),
    uint32(central.length), uint32(offset), uint16(0),
  ]);
  return new Blob([...localParts, central, end], { type: "application/zip" });
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item !== "") || rows.length === 0) rows.push(row);
  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvString(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function decodeLocalText(file, encoding = "utf-8") {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder(encoding || "utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof RangeError) throw new Error(`当前浏览器不支持 ${encoding} 编码`);
    throw new Error(`${file.name} 不是有效的 ${String(encoding || "utf-8").toUpperCase()} 文本，请选择正确的源编码`);
  }
}

export function validateCsvTable(rows, fileName = "CSV 文件") {
  if (!rows.length || (rows.length === 1 && rows[0].every((cell) => !cell))) throw new Error(`${fileName} 没有可处理的数据`);
  const width = rows[0].length;
  if (!width || rows[0].every((cell) => !String(cell).trim())) throw new Error(`${fileName} 缺少表头`);
  const invalidRow = rows.findIndex((row) => row.length !== width);
  if (invalidRow >= 0) throw new Error(`${fileName} 第 ${invalidRow + 1} 行列数与表头不一致`);
  return rows;
}

export function md5Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const length = bytes.length;
  const paddedLength = (((length + 8) >>> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const bitLength = length * 8;
  for (let index = 0; index < 8; index += 1) buffer[paddedLength - 8 + index] = Math.floor(bitLength / (2 ** (8 * index))) & 255;
  const view = new DataView(buffer.buffer);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
  const rotate = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f; let g;
      if (index < 16) { f = (b & c) | (~b & d); g = index; }
      else if (index < 32) { f = (d & b) | (~d & c); g = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * index) % 16; }
      const nextD = c;
      c = b;
      b = (b + rotate((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
      a = d;
      d = nextD;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((value) => [0, 8, 16, 24].map((shift) => ((value >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

export async function digestFile(file, algorithm) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (algorithm === "MD5") return md5Bytes(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
