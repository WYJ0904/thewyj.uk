import fs from "node:fs";
import path from "node:path";

export function benchmarkFixture() {
  const file = path.resolve(process.env.AERIS_BENCH_FILE || ".tool-e2e/aeris-p1-200MiB.bin");
  if (process.env.AERIS_BENCH_FILE || fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = (i * 31 + 17) % 251;
  const descriptor = fs.openSync(file, "wx");
  try { for (let i = 0; i < 200; i++) fs.writeSync(descriptor, block); }
  finally { fs.closeSync(descriptor); }
  return file;
}
