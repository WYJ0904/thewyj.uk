import assert from "node:assert/strict";
import test from "node:test";
import {
  HALF_PERCENT_MAX,
  computeCoinTargetAngle,
  computeDiceTargetTransform,
  computeWeightedSectors,
  computeWheelNextRotation,
  DICE_D6_FACE_ROTATIONS,
  drawWeightedSector,
  formatWeightPercent,
  halfUnitsToPercent,
  parseWeightedEntries,
  percentToHalfUnits,
  randomToolResult,
  renderRmbOneYuanCoinSvg,
  renderWheelSvg,
  sectorAtPointerAngle,
  serializeWeightedEntries,
} from "../js/tools/random.js";
import { CATALOG_TOOLS, toolIconName } from "../js/tools/catalog.js";

test("weight slider half-percent integer engine handles 0%, 0.5%, 50%, 99.5%, 100% without float drift", () => {
  assert.equal(HALF_PERCENT_MAX, 200);
  const cases = [
    [0, 0, "0%"],
    [0.5, 1, "0.5%"],
    [50, 100, "50%"],
    [99.5, 199, "99.5%"],
    [100, 200, "100%"],
  ];
  for (const [pct, expectedUnits, expectedText] of cases) {
    const units = percentToHalfUnits(pct);
    assert.equal(units, expectedUnits);
    assert.equal(halfUnitsToPercent(units), pct);
    assert.equal(formatWeightPercent(units), expectedText);
  }
  // Clamping out-of-range values
  assert.equal(percentToHalfUnits(-10), 0);
  assert.equal(percentToHalfUnits(150), 200);
});

test("all-zero weights block drawing and zero-weight options are never drawn", () => {
  assert.throws(
    () => drawWeightedSector([{ name: "A", halfUnits: 0 }, { name: "B", halfUnits: 0 }]),
    /权重均为 0%/,
  );

  const items = [
    { name: "ExcludedZero", halfUnits: 0 },
    { name: "TinyHalf", halfUnits: 1 }, // 0.5%
    { name: "Major", halfUnits: 199 }, // 99.5%
  ];
  const model = computeWeightedSectors(items);
  assert.equal(model.activeSectors.length, 2);
  assert.equal(model.rows[0].excluded, true);
  assert.equal(model.rows[0].probability, 0);

  for (const r of [0, 0.001, 0.0049, 0.005, 0.5, 0.9999]) {
    const draw = drawWeightedSector(items, () => r);
    assert.notEqual(draw.winner, "ExcludedZero");
  }
  assert.equal(drawWeightedSector(items, () => 0.001).winner, "TinyHalf");
  assert.equal(drawWeightedSector(items, () => 0.01).winner, "Major");
});

test("legacy name|weight preset parsing, serialization and randomToolResult compatibility", () => {
  const standard = parseWeightedEntries("方案 A|50\n方案 B|30.5\n方案 C|0");
  assert.equal(standard.convertedFromLegacy, false);
  assert.deepEqual(standard.items, [
    { name: "方案 A", halfUnits: 100 },
    { name: "方案 B", halfUnits: 61 },
    { name: "方案 C", halfUnits: 0 },
  ]);
  const serialized = serializeWeightedEntries(standard.items);
  assert.equal(serialized, "方案 A|50\n方案 B|30.5\n方案 C|0");
  const result = randomToolResult("weighted-wheel", { entries: serialized });
  assert.ok(["方案 A", "方案 B"].includes(result));

  // Legacy weights > 100 proportionally mapped with explicit notice flag
  const legacy = parseWeightedEntries("大奖|300\n普奖|150");
  assert.equal(legacy.convertedFromLegacy, true);
  assert.equal(legacy.items[0].halfUnits, 200);
  assert.equal(legacy.items[1].halfUnits, 100);
});

test("deterministic RNG wheel pointer angle always lands inside the drawn winning sector", () => {
  const items = [
    { name: "一等奖", halfUnits: 10 },
    { name: "二等奖", halfUnits: 40 },
    { name: "三等奖", halfUnits: 150 },
  ];
  let rotation = 0;
  for (const r of [0.01, 0.12, 0.24, 0.26, 0.65, 0.99]) {
    const draw = drawWeightedSector(items, () => r);
    rotation = computeWheelNextRotation(rotation, draw.pointerAlignedMod, 6);
    const landed = sectorAtPointerAngle(rotation, draw.model.activeSectors);
    assert.equal(landed.name, draw.winner, `Pointer must land inside winning sector for r=${r}`);
  }
  const svg = renderWheelSvg(computeWeightedSectors(items).activeSectors, 1);
  assert.match(svg, /class="wheel-slice is-winner"/);
});

test("3D dice and 3D RMB 1 Yuan coin visual mappings match generated outcomes", () => {
  let rx = 0;
  let ry = 0;
  for (let face = 1; face <= 6; face += 1) {
    const next = computeDiceTargetTransform(face, rx, ry, 2, 3);
    rx = next.rx;
    ry = next.ry;
    const expected = DICE_D6_FACE_ROTATIONS[face];
    assert.equal(((rx % 360) + 360) % 360, ((expected.rx % 360) + 360) % 360);
    assert.equal(((ry % 360) + 360) % 360, ((expected.ry % 360) + 360) % 360);
  }

  let coinAngle = 0;
  for (const side of ["正面", "反面", "反面", "正面"]) {
    const target = computeCoinTargetAngle(side, coinAngle, 6);
    coinAngle = target.angleY;
    assert.equal(target.side, side);
    assert.equal(target.mod360, side === "正面" ? 0 : 180);
  }

  const obverse = renderRmbOneYuanCoinSvg("正面");
  const reverse = renderRmbOneYuanCoinSvg("反面");
  assert.match(obverse, /中国人民银行/);
  assert.match(obverse, /YIYUAN/);
  assert.match(reverse, /ZHONGGUO RENMIN YINHANG/);
  assert.match(reverse, /2019/);
});

test("distinct fine-line SVG icons differentiate similar text and random tools", () => {
  const byId = new Map(CATALOG_TOOLS.map((t) => [t.id, t]));
  const groupA = ["text-stats", "dedupe-lines", "remove-empty-lines", "collapse-spaces", "sort-lines", "shuffle-lines"];
  assert.equal(new Set(groupA.map((id) => toolIconName(byId.get(id)))).size, groupA.length);
  const groupB = ["random-password", "random-uuid", "dice-d6", "coin-flip", "random-wheel", "weighted-wheel"];
  assert.equal(new Set(groupB.map((id) => toolIconName(byId.get(id)))).size, groupB.length);
});
