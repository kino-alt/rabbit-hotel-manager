import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalItemsOnDay,
  brushUnitsOnDay,
  careUnitsOnDay,
  careScheduleShape,
  entryToSchedules,
  buildEntry,
} from "../public/scheduleGrid.js";

const NO_HOL = { weekdays: [], dates: [] };

function entry(over = {}) {
  return {
    name: "山田 モカ",
    card: {},
    normalIds: ["nail", "ear"],
    brushIds: ["brush"],
    careDays: ["2026-09-08", "2026-09-09"],
    itemDay: { nail: "2026-09-08", ear: "2026-09-09" },
    brushByDay: { "2026-09-08": { brush: 2 } },
    runByDay: { "2026-09-09": 1 },
    ...over,
  };
}

test("normalItemsOnDay / brushUnitsOnDay / careUnitsOnDay", () => {
  const e = entry();
  assert.deepEqual(normalItemsOnDay(e, "2026-09-08"), ["nail"]);
  assert.deepEqual(normalItemsOnDay(e, "2026-09-09"), ["ear"]);
  assert.equal(brushUnitsOnDay(e, "2026-09-08"), 2);
  assert.equal(brushUnitsOnDay(e, "2026-09-09"), 0);
  assert.equal(careUnitsOnDay(e, "2026-09-08"), 3); // nail + brush x2
  assert.equal(careUnitsOnDay(e, "2026-09-09"), 1); // ear
});

test("careScheduleShape: 中身のある日だけ id 配列で返す", () => {
  const shape = careScheduleShape(entry());
  assert.deepEqual(shape, {
    "2026-09-08": ["nail", "brush"],
    "2026-09-09": ["ear"],
  });
});

test("entryToSchedules: Firestore 形式へ変換、空の日は含めない", () => {
  const { careSchedule, careCounts, runSchedule } = entryToSchedules(entry());
  assert.deepEqual(careSchedule, {
    "2026-09-08": ["nail", "brush"],
    "2026-09-09": ["ear"],
  });
  assert.deepEqual(careCounts, { "2026-09-08": { brush: 2 } });
  assert.deepEqual(runSchedule, { "2026-09-09": 1 });
});

test("entryToSchedules: 回数0の回数式項目は落とす", () => {
  const e = entry({ brushByDay: { "2026-09-08": { brush: 0 } } });
  const { careSchedule, careCounts } = entryToSchedules(e);
  assert.deepEqual(careSchedule["2026-09-08"], ["nail"]);
  assert.equal(careCounts["2026-09-08"], undefined);
});

test("buildEntry: 新規は既定ケア日に全項目を置く", () => {
  const shared = { ownerLastName: "山田", checkOutDate: "2026-09-10" };
  const card = { rabbitName: "モカ", careIds: ["nail", "brush"], brushCounts: { brush: 3 } };
  const e = buildEntry(shared, card, null, {
    countableIds: new Set(["brush"]),
    holidays: NO_HOL,
    prevRabbit: null,
  });

  assert.equal(e.name, "山田 モカ");
  assert.deepEqual(e.careDays, ["2026-09-09"]); // お迎え前日
  assert.deepEqual(e.normalIds, ["nail"]);
  assert.deepEqual(e.brushIds, ["brush"]);
  assert.equal(e.itemDay.nail, "2026-09-09");
  assert.equal(e.brushByDay["2026-09-09"].brush, 3); // STEP1 の指定回数
});

test("buildEntry: 編集時は既存 careSchedule から日と割り当てを復元", () => {
  const shared = { ownerLastName: "山田", checkOutDate: "2026-09-12" };
  const card = { rabbitName: "モカ", careIds: ["nail", "ear"], brushCounts: {} };
  const prevRabbit = {
    careSchedule: { "2026-09-09": ["nail"], "2026-09-11": ["ear"] },
    careCounts: {},
    runSchedule: { "2026-09-10": 2 },
  };
  const e = buildEntry(shared, card, null, {
    countableIds: new Set(),
    holidays: NO_HOL,
    prevRabbit,
  });

  assert.deepEqual(e.careDays, ["2026-09-09", "2026-09-11"]);
  assert.equal(e.itemDay.nail, "2026-09-09");
  assert.equal(e.itemDay.ear, "2026-09-11");
  assert.deepEqual(e.runByDay, { "2026-09-10": 2 });
});

test("buildEntry: 回数式の合計が指定とズレていたら既定日にまとめ直す", () => {
  const shared = { ownerLastName: "A", checkOutDate: "2026-09-10" };
  const card = { rabbitName: "x", careIds: ["brush"], brushCounts: { brush: 5 } };
  const prev = {
    name: "A x",
    card,
    normalIds: [],
    brushIds: ["brush"],
    careDays: ["2026-09-08", "2026-09-09"],
    itemDay: {},
    brushByDay: { "2026-09-08": { brush: 1 }, "2026-09-09": { brush: 1 } }, // 合計2 ≠ 指定5
    runByDay: {},
  };
  const e = buildEntry(shared, card, prev, {
    countableIds: new Set(["brush"]),
    holidays: NO_HOL,
    prevRabbit: null,
  });
  const total = e.careDays.reduce(
    (n, d) => n + ((e.brushByDay[d] || {})[d ? "brush" : ""] || 0),
    0,
  );
  assert.equal(total, 5);
});
