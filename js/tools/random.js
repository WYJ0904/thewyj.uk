export function randomUnit() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x100000000;
}

export function secureInt(minimum, maximum) {
  const min = Math.ceil(Number(minimum));
  const max = Math.floor(Number(maximum));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error("数值范围无效");
  const range = max - min + 1;
  if (range <= 0 || range > 0x100000000) throw new Error("数值范围过大");
  const limit = Math.floor(0x100000000 / range) * range;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return min + (values[0] % range);
}

export function randomColor() {
  return `#${secureInt(0, 0xffffff).toString(16).padStart(6, "0")}`;
}

export function secureUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function shuffled(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = secureInt(0, index);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

export function randomToolResult(toolId, values) {
  const minimum = Number(values.minimum || 0);
  const maximum = Number(values.maximum || 100);
  const count = Math.max(1, Math.min(1000, Number(values.count || 1)));
  const entries = String(values.entries || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  if (toolId === "random-integer") return Array.from({ length: count }, () => secureInt(minimum, maximum)).join("\n");
  if (toolId === "random-decimal") return Array.from({ length: count }, () => (minimum + randomUnit() * (maximum - minimum)).toFixed(Math.max(0, Math.min(12, Number(values.precision || 2))))).join("\n");
  if (toolId === "random-string") {
    const alphabet = [...new Set(String(values.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))].join("");
    if (!alphabet) throw new Error("字符集不能为空");
    const length = Math.max(1, Math.min(4096, Number(values.length || 16)));
    return Array.from({ length }, () => alphabet[secureInt(0, alphabet.length - 1)]).join("");
  }
  if (toolId === "random-password") {
    const sets = [
      values.passwordUpper !== false && "ABCDEFGHJKLMNPQRSTUVWXYZ",
      values.passwordLower !== false && "abcdefghijkmnopqrstuvwxyz",
      values.passwordDigits !== false && "23456789",
      values.passwordSymbols !== false && "!@#$%^&*_-+=",
    ].filter(Boolean);
    if (!sets.length) throw new Error("请至少选择一种密码字符");
    const length = Math.max(sets.length, Math.min(4096, Number(values.length || 20)));
    const alphabet = sets.join("");
    const characters = sets.map((set) => set[secureInt(0, set.length - 1)]);
    while (characters.length < length) characters.push(alphabet[secureInt(0, alphabet.length - 1)]);
    return shuffled(characters).join("");
  }
  if (toolId === "random-uuid") return Array.from({ length: count }, secureUuid).join("\n");
  if (["random-draw", "random-wheel", "random-decision"].includes(toolId)) {
    if (!entries.length) throw new Error("请至少输入一个选项");
    return entries[secureInt(0, entries.length - 1)];
  }
  if (toolId === "weighted-wheel") {
    const weighted = entries.map((line) => {
      const [name, rawWeight] = line.split("|");
      return { name: name.trim(), weight: Math.max(0, Number(rawWeight || 1)) };
    }).filter((item) => item.name && item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (!total) throw new Error("请按“选项|权重”输入至少一项");
    let target = randomUnit() * total;
    return weighted.find((item) => (target -= item.weight) <= 0)?.name || weighted[weighted.length - 1].name;
  }
  if (toolId === "random-groups") {
    if (!entries.length) throw new Error("请输入分组成员");
    const groups = Array.from({ length: Math.max(1, Math.min(entries.length, Number(values.groups || 2))) }, () => []);
    shuffled(entries).forEach((entry, index) => groups[index % groups.length].push(entry));
    return groups.map((group, index) => `第 ${index + 1} 组\n${group.join("\n")}`).join("\n\n");
  }
  if (toolId === "random-date") {
    const start = new Date(values.startDate || "2000-01-01").getTime();
    const end = new Date(values.endDate || new Date().toISOString().slice(0, 10)).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("日期范围无效");
    return new Date(start + Math.floor(randomUnit() * (end - start + 86400000))).toISOString().slice(0, 10);
  }
  if (toolId === "random-time") return `${String(secureInt(0, 23)).padStart(2, "0")}:${String(secureInt(0, 59)).padStart(2, "0")}:${String(secureInt(0, 59)).padStart(2, "0")}`;
  if (toolId === "random-color") return randomColor();
  if (toolId === "random-palette") return Array.from({ length: Math.max(2, Math.min(20, Number(values.count || 5))) }, randomColor).join("\n");
  if (toolId === "coin-flip") return secureInt(0, 1) ? "正面" : "反面";
  if (toolId.startsWith("dice-d")) return String(secureInt(1, Number(toolId.slice(6))));
  if (toolId === "custom-dice") return String(secureInt(1, Math.max(2, Math.min(1_000_000, Number(values.sides || 6)))));
  return "";
}
