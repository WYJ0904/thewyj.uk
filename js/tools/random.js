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

// ============================================================================
// Phase 3 V2: Weight Slider Engine & Interactive Random Visuals (Wheel/Dice/Coin)
// ============================================================================

export const HALF_PERCENT_MAX = 200; // 200 * 0.5% = 100.0%

export const WHEEL_PALETTE = Object.freeze([
  "#546e87",
  "#5d8268",
  "#9b7c54",
  "#7b668a",
  "#4f8389",
  "#96645e",
  "#68788c",
  "#7c8756",
]);

export function percentToHalfUnits(percent) {
  const num = Number(percent);
  if (!Number.isFinite(num)) return 0;
  const clamped = Math.max(0, Math.min(100, num));
  return Math.round(clamped * 2);
}

export function halfUnitsToPercent(units) {
  const clamped = Math.max(0, Math.min(HALF_PERCENT_MAX, Math.round(Number(units) || 0)));
  return clamped / 2;
}

export function formatWeightPercent(units) {
  const pct = halfUnitsToPercent(units);
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function parseWeightedEntries(rawText, { defaultHalfUnits = 50 } = {}) {
  const lines = String(rawText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return {
      items: [
        { name: "选项 A", halfUnits: 100 },
        { name: "选项 B", halfUnits: 60 },
        { name: "选项 C", halfUnits: 40 },
      ],
      convertedFromLegacy: false,
    };
  }
  const parsed = lines.map((line) => {
    const parts = line.split("|");
    const name = String(parts[0] || "").trim();
    const hasWeight = parts.length > 1 && String(parts[1] || "").trim() !== "";
    const rawNum = hasWeight ? Number(parts[1].trim().replace(/%$/, "")) : Number.NaN;
    return { name, rawNum, hasWeight };
  }).filter((item) => item.name);

  if (!parsed.length) {
    return { items: [], convertedFromLegacy: false };
  }

  const maxRaw = parsed.reduce((max, item) => (Number.isFinite(item.rawNum) && item.rawNum > max ? item.rawNum : max), 0);
  const convertedFromLegacy = maxRaw > 100;
  const items = parsed.map((item) => {
    if (!item.hasWeight || !Number.isFinite(item.rawNum)) {
      return { name: item.name, halfUnits: defaultHalfUnits };
    }
    const clampedNonNeg = Math.max(0, item.rawNum);
    const pct = convertedFromLegacy && maxRaw > 0 ? (clampedNonNeg / maxRaw) * 100 : clampedNonNeg;
    return { name: item.name, halfUnits: percentToHalfUnits(pct) };
  });
  return { items, convertedFromLegacy };
}

export function serializeWeightedEntries(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: String(item?.name || "").trim(),
      halfUnits: Math.max(0, Math.min(HALF_PERCENT_MAX, Math.round(Number(item?.halfUnits) || 0))),
    }))
    .filter((item) => item.name)
    .map((item) => `${item.name}|${halfUnitsToPercent(item.halfUnits)}`)
    .join("\n");
}

export function computeWeightedSectors(items) {
  const normalizedItems = (Array.isArray(items) ? items : []).map((item, idx) => ({
    index: idx,
    name: String(item?.name || "").trim() || `选项 ${idx + 1}`,
    halfUnits: Math.max(0, Math.min(HALF_PERCENT_MAX, Math.round(Number(item?.halfUnits) || 0))),
  }));
  const totalHalfUnits = normalizedItems.reduce((sum, item) => sum + item.halfUnits, 0);
  let cursorDeg = 0;
  const activeSectors = [];
  const allRows = normalizedItems.map((item, idx) => {
    const probability = totalHalfUnits > 0 ? item.halfUnits / totalHalfUnits : 0;
    const sweepDeg = probability * 360;
    const excluded = item.halfUnits <= 0;
    const startDeg = cursorDeg;
    const endDeg = excluded ? cursorDeg : cursorDeg + sweepDeg;
    const midDeg = excluded ? cursorDeg : startDeg + sweepDeg / 2;
    const color = WHEEL_PALETTE[idx % WHEEL_PALETTE.length];
    if (!excluded) cursorDeg = endDeg;
    const entry = {
      ...item,
      weightPercent: halfUnitsToPercent(item.halfUnits),
      probability,
      probabilityPercent: probability * 100,
      excluded,
      startDeg,
      endDeg,
      midDeg,
      sweepDeg,
      color,
    };
    if (!excluded) activeSectors.push(entry);
    return entry;
  });
  return {
    totalHalfUnits,
    totalWeightPercent: totalHalfUnits / 2,
    rows: allRows,
    activeSectors,
  };
}

export function drawWeightedSector(items, rng = randomUnit) {
  const model = computeWeightedSectors(items);
  if (!model.totalHalfUnits || !model.activeSectors.length) {
    throw new Error("所有选项权重均为 0%，请至少将一个选项调至大于 0%");
  }
  const drawValue = Math.max(0, Math.min(0.999999999999, Number(rng()))) * model.totalHalfUnits;
  let acc = 0;
  let chosen = model.activeSectors[model.activeSectors.length - 1];
  for (const sector of model.activeSectors) {
    acc += sector.halfUnits;
    if (drawValue < acc) {
      chosen = sector;
      break;
    }
  }
  // Keep landing angle strictly inside [22%, 78%] of the winning sector so it
  // never visually hovers ambiguously on a divider line.
  const marginRatio = 0.22 + Math.max(0, Math.min(1, Number(rng()))) * 0.56;
  const landingSectorDeg = chosen.startDeg + chosen.sweepDeg * marginRatio;
  // Because CSS rotate(theta) rotates the wheel clockwise and the pointer sits
  // fixed at 12 o'clock (0 deg), the sector angle alpha ends up at 0 deg when
  // (theta + alpha) mod 360 === 0 => theta mod 360 === (360 - alpha) mod 360.
  const pointerAlignedMod = ((360 - (landingSectorDeg % 360)) + 360) % 360;
  return {
    winner: chosen.name,
    sector: chosen,
    landingSectorDeg,
    pointerAlignedMod,
    model,
  };
}

export function computeWheelNextRotation(currentRotationDeg, pointerAlignedMod, extraTurns = 6) {
  const currentMod = ((currentRotationDeg % 360) + 360) % 360;
  const deltaToTarget = ((pointerAlignedMod - currentMod) + 360) % 360;
  const turns = Math.max(4, Math.round(extraTurns));
  return currentRotationDeg + turns * 360 + deltaToTarget;
}

export function sectorAtPointerAngle(rotationDeg, activeSectors) {
  if (!Array.isArray(activeSectors) || !activeSectors.length) return null;
  const pointerOnWheel = ((360 - (((rotationDeg % 360) + 360) % 360)) + 360) % 360;
  return activeSectors.find((s) => pointerOnWheel >= s.startDeg && pointerOnWheel < s.endDeg)
    || activeSectors[activeSectors.length - 1];
}

function escapeSvgText(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[ch]));
}

export function renderWheelSvg(activeSectors, winnerIndex = -1) {
  const cx = 160;
  const cy = 160;
  const r = 148;
  if (!activeSectors.length) {
    return `<svg class="wheel-svg" viewBox="0 0 320 320" role="img" aria-label="空转盘">
      <circle cx="${cx}" cy="${cy}" r="${r}" class="wheel-empty-ring" />
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" class="wheel-empty-text">请设置大于 0% 的选项</text>
    </svg>`;
  }
  const sliceMarkup = activeSectors.map((sector) => {
    const isWinner = sector.index === winnerIndex;
    if (activeSectors.length === 1 || sector.sweepDeg >= 359.99) {
      const label = sector.name.length > 12 ? `${sector.name.slice(0, 11)}…` : sector.name;
      return `<g class="wheel-slice${isWinner ? " is-winner" : ""}" data-sector-index="${sector.index}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${sector.color}" />
        <text x="${cx}" y="${cy - 68}" text-anchor="middle" dominant-baseline="central" class="wheel-slice-label">${escapeSvgText(label)}</text>
      </g>`;
    }
    const startRad = (sector.startDeg - 90) * Math.PI / 180;
    const endRad = (sector.endDeg - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = sector.sweepDeg > 180 ? 1 : 0;
    const pathD = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    const midRad = (sector.midDeg - 90) * Math.PI / 180;
    const labelRadius = sector.sweepDeg < 22 ? r * 0.72 : r * 0.62;
    const lx = cx + labelRadius * Math.cos(midRad);
    const ly = cy + labelRadius * Math.sin(midRad);
    const textAngle = sector.midDeg - 90;
    const flipText = sector.midDeg > 180 ? textAngle + 180 : textAngle;
    const maxChars = sector.sweepDeg < 20 ? 5 : sector.sweepDeg < 40 ? 7 : 10;
    const label = sector.name.length > maxChars ? `${sector.name.slice(0, maxChars - 1)}…` : sector.name;
    const showLabel = sector.sweepDeg >= 10;
    return `<g class="wheel-slice${isWinner ? " is-winner" : ""}" data-sector-index="${sector.index}">
      <path d="${pathD}" fill="${sector.color}" stroke="rgba(255,255,255,0.65)" stroke-width="1.5" />
      ${showLabel ? `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${flipText.toFixed(1)} ${lx.toFixed(2)} ${ly.toFixed(2)})" class="wheel-slice-label">${escapeSvgText(label)}</text>` : ""}
    </g>`;
  }).join("");

  return `<svg class="wheel-svg" viewBox="0 0 320 320" role="img" aria-label="交互式权重转盘">
    <circle cx="${cx}" cy="${cy}" r="${r + 4}" class="wheel-outer-rim" />
    ${sliceMarkup}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(15,23,42,0.16)" stroke-width="2" />
    <circle cx="${cx}" cy="${cy}" r="22" class="wheel-hub-outer" />
    <circle cx="${cx}" cy="${cy}" r="10" class="wheel-hub-inner" />
  </svg>`;
}

export const DICE_D6_FACE_ROTATIONS = Object.freeze({
  1: { rx: 0, ry: 0 },
  2: { rx: -90, ry: 0 },
  3: { rx: 0, ry: -90 },
  4: { rx: 0, ry: 90 },
  5: { rx: 90, ry: 0 },
  6: { rx: 0, ry: 180 },
});

export function computeDiceTargetTransform(face, prevRx = 0, prevRy = 0, extraTurnsX = 2, extraTurnsY = 3) {
  const safeFace = Math.max(1, Math.min(6, Math.round(Number(face) || 1)));
  const base = DICE_D6_FACE_ROTATIONS[safeFace];
  const baseTurnsX = Math.floor(prevRx / 360) + Math.max(2, Math.round(extraTurnsX));
  const baseTurnsY = Math.floor(prevRy / 360) + Math.max(2, Math.round(extraTurnsY));
  return {
    face: safeFace,
    rx: baseTurnsX * 360 + base.rx,
    ry: baseTurnsY * 360 + base.ry,
  };
}

export function computeCoinTargetAngle(side, prevAngle = 0, extraTurns = 6) {
  const isObverse = side === "正面";
  const targetMod = isObverse ? 0 : 180;
  const currentBase = Math.floor(prevAngle / 360) * 360;
  const turns = Math.max(5, Math.round(extraTurns));
  const nextAngle = currentBase + turns * 360 + targetMod;
  return {
    side: isObverse ? "正面" : "反面",
    angleY: nextAngle,
    mod360: ((nextAngle % 360) + 360) % 360,
  };
}

/**
 * Authentic 2019 5th Series RMB 1 Yuan (CNY ¥1) coin SVG artwork based on
 * People's Bank of China Announcement [2019] No. 4 (nickel-plated steel,
 * 22.25mm diameter). Obverse: "中国人民银行", "1 元", "YIYUAN", edge beads.
 * Reverse: Chrysanthemum blossom, "2019", "ZHONGGUO RENMIN YINHANG".
 */
export function renderRmbOneYuanCoinSvg(side = "正面") {
  const isObverse = side === "正面";
  const uid = isObverse ? "obv" : "rev";
  const beads = Array.from({ length: 48 }, (_, i) => {
    const a = (i * 360 / 48) * Math.PI / 180;
    const bx = (100 + 88.5 * Math.cos(a)).toFixed(2);
    const by = (100 + 88.5 * Math.sin(a)).toFixed(2);
    return `<circle cx="${bx}" cy="${by}" r="1.25" fill="#7c8590" opacity="0.72" />`;
  }).join("");

  if (isObverse) {
    return `<svg class="coin-face-svg" viewBox="0 0 200 200" role="img" aria-label="2019版人民币1元硬币正面">
      <defs>
        <radialGradient id="rmbMetal-${uid}" cx="36%" cy="30%" r="72%">
          <stop offset="0%" stop-color="#f5f7fa" />
          <stop offset="48%" stop-color="#d5dbe2" />
          <stop offset="82%" stop-color="#aeb7c2" />
          <stop offset="100%" stop-color="#8b94a0" />
        </radialGradient>
        <linearGradient id="rmbRim-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="50%" stop-color="#b4bcc6" />
          <stop offset="100%" stop-color="#7c8591" />
        </linearGradient>
        <path id="rmbTopArc-${uid}" d="M 32 100 A 68 68 0 0 1 168 100" />
      </defs>
      <circle cx="100" cy="100" r="97" fill="url(#rmbRim-${uid})" stroke="#7d8692" stroke-width="2" />
      <circle cx="100" cy="100" r="91.5" fill="url(#rmbMetal-${uid})" stroke="#9aa3ae" stroke-width="1" />
      ${beads}
      <circle cx="100" cy="100" r="83" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1" />
      <text class="coin-cny-bank" fill="#414a56" font-size="14.5" font-weight="600" letter-spacing="4.5">
        <textPath href="#rmbTopArc-${uid}" startOffset="50%" text-anchor="middle">中国人民银行</textPath>
      </text>
      <g transform="translate(0,4)">
        <text x="86" y="128" text-anchor="middle" fill="#3b4450" font-family="Georgia, 'Times New Roman', serif" font-size="78" font-weight="700" stroke="#f7f9fc" stroke-width="1.2" paint-order="stroke">1</text>
        <text x="131" y="124" text-anchor="middle" fill="#414a56" font-size="27" font-weight="600">元</text>
      </g>
      <text x="100" y="156" text-anchor="middle" fill="#4f5865" font-size="10.5" font-weight="600" letter-spacing="2.2">YIYUAN</text>
    </svg>`;
  }

  const petals = Array.from({ length: 16 }, (_, i) => {
    const angle = i * 22.5;
    const len = i % 2 === 0 ? 44 : 37;
    return `<ellipse cx="100" cy="${100 - len * 0.56}" rx="6.2" ry="${(len * 0.48).toFixed(1)}" transform="rotate(${angle} 100 100)" fill="#eef2f6" stroke="#858f9c" stroke-width="1.15" />`;
  }).join("");
  const innerPetals = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 30 + 11;
    return `<ellipse cx="100" cy="83" rx="4.2" ry="13.5" transform="rotate(${angle} 100 100)" fill="#f7f9fb" stroke="#7c8694" stroke-width="1" />`;
  }).join("");

  return `<svg class="coin-face-svg" viewBox="0 0 200 200" role="img" aria-label="2019版人民币1元硬币反面菊花">
    <defs>
      <radialGradient id="rmbMetal-${uid}" cx="36%" cy="30%" r="72%">
        <stop offset="0%" stop-color="#f5f7fa" />
        <stop offset="48%" stop-color="#d4dae1" />
        <stop offset="82%" stop-color="#acb5c0" />
        <stop offset="100%" stop-color="#89929e" />
      </radialGradient>
      <linearGradient id="rmbRim-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="50%" stop-color="#b4bcc6" />
        <stop offset="100%" stop-color="#7c8591" />
      </linearGradient>
      <path id="rmbTopArc-${uid}" d="M 30 100 A 70 70 0 0 1 170 100" />
    </defs>
    <circle cx="100" cy="100" r="97" fill="url(#rmbRim-${uid})" stroke="#7d8692" stroke-width="2" />
    <circle cx="100" cy="100" r="91.5" fill="url(#rmbMetal-${uid})" stroke="#9aa3ae" stroke-width="1" />
    ${beads}
    <text fill="#49525f" font-size="8.2" font-weight="600" letter-spacing="1.8">
      <textPath href="#rmbTopArc-${uid}" startOffset="50%" text-anchor="middle">ZHONGGUO RENMIN YINHANG</textPath>
    </text>
    <g transform="translate(100, 106) scale(0.92) translate(-100, -100)">
      ${petals}
      ${innerPetals}
      <circle cx="100" cy="100" r="10.5" fill="#d8dfe7" stroke="#727c89" stroke-width="1.2" />
      <circle cx="100" cy="100" r="5" fill="#eef2f6" stroke="#858f9c" stroke-width="0.9" />
    </g>
    <text x="100" y="166" text-anchor="middle" fill="#424b57" font-size="13" font-weight="700" letter-spacing="2">2019</text>
  </svg>`;
}
