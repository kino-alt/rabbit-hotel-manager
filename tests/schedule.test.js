import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toISO,
  parseISO,
  addDays,
  addMonths,
  formatMonthJP,
  isStayEnded,
  eachDate,
  formatJP,
  dayWd,
  isHoliday,
  calculateDefaultCareDate,
  isCountableItem,
  countableIdSet,
  isBusyPeriod,
  careOnDate,
  runOnDate,
  calculatePhotoNeeded,
} from "../public/schedule.js";

const NO_HOL = { weekdays: [], dates: [] };

test("toISO / parseISO はローカル日付を往復する", () => {
  assert.equal(toISO(new Date(2026, 8, 7)), "2026-09-07");
  const d = parseISO("2026-09-07");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 7);
});

test("addDays は月・年をまたいで正しく進む／戻る", () => {
  assert.equal(addDays("2026-09-07", 1), "2026-09-08");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // 閏年
});

test("addMonths / formatMonthJP", () => {
  assert.equal(addMonths("2026-01", 1), "2026-02");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-03", -4), "2025-11");
  assert.equal(formatMonthJP("2026-09"), "2026年9月");
});

test("isStayEnded: hiddenAt があれば終了、無ければお迎え日が今日より前なら終了", () => {
  assert.equal(isStayEnded({ hiddenAt: {}, checkOutDate: "2999-01-01" }), true);
  assert.equal(isStayEnded({ checkOutDate: "2026-09-05" }, "2026-09-10"), true);
  assert.equal(isStayEnded({ checkOutDate: "2026-09-10" }, "2026-09-10"), false); // 当日はまだ
  assert.equal(isStayEnded({ checkOutDate: "2026-09-20" }, "2026-09-10"), false);
  assert.equal(isStayEnded(null), false);
});

test("eachDate は両端を含み、逆順や過大範囲でも暴走しない", () => {
  assert.deepEqual(eachDate("2026-09-07", "2026-09-09"), [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
  ]);
  assert.deepEqual(eachDate("2026-09-09", "2026-09-07"), []);
  assert.ok(eachDate("2020-01-01", "2030-01-01").length <= 366);
});

test("formatJP / dayWd", () => {
  // 2026-09-07 は月曜
  assert.equal(formatJP("2026-09-07"), "9/7(月)");
  assert.deepEqual(dayWd("2026-09-07"), { day: 7, wd: "月" });
});

test("isHoliday: 曜日指定と個別日指定の両方", () => {
  assert.equal(isHoliday("2026-09-07", { weekdays: [1], dates: [] }), true); // 月曜
  assert.equal(isHoliday("2026-09-07", { weekdays: [2], dates: [] }), false);
  assert.equal(isHoliday("2026-09-07", { weekdays: [], dates: ["2026-09-07"] }), true);
  assert.equal(isHoliday("2026-09-07", NO_HOL), false);
  assert.equal(isHoliday("2026-09-07", null), false);
});

test("calculateDefaultCareDate: お迎え前日、定休日なら営業日まで遡る", () => {
  assert.equal(calculateDefaultCareDate("2026-09-10", NO_HOL), "2026-09-09");
  assert.equal(
    calculateDefaultCareDate("2026-09-10", { weekdays: [], dates: ["2026-09-09"] }),
    "2026-09-08",
  );
  assert.equal(
    calculateDefaultCareDate("2026-09-10", { weekdays: [], dates: ["2026-09-09", "2026-09-08"] }),
    "2026-09-07",
  );
});

test("countableIdSet / isCountableItem", () => {
  assert.equal(isCountableItem({ countable: true }), true);
  assert.equal(isCountableItem({}), false);
  assert.equal(isCountableItem(null), false);
  const set = countableIdSet([
    { id: "a" },
    { id: "b", countable: true },
    { id: "c", countable: false },
  ]);
  assert.deepEqual([...set], ["b"]);
  assert.deepEqual([...countableIdSet(null)], []);
});

test("isBusyPeriod: 期間の両端を含む", () => {
  const p = [{ start: "2026-12-27", end: "2027-01-04" }];
  assert.equal(isBusyPeriod("2026-12-27", p), true);
  assert.equal(isBusyPeriod("2027-01-04", p), true);
  assert.equal(isBusyPeriod("2026-12-26", p), false);
  assert.equal(isBusyPeriod("2027-01-05", p), false);
  assert.equal(isBusyPeriod("2026-12-30", null), false);
});

test("careOnDate: 予定のみ（記録なし）", () => {
  const rabbit = {
    careSchedule: { "2026-09-10": ["nail", "brush"] },
    careCounts: { "2026-09-10": { brush: 3 } },
    dailyRecords: {},
  };
  const c = careOnDate(rabbit, "2026-09-10", new Set(["brush"]));
  assert.equal(c.hasPlan, true);
  assert.equal(c.hasRecord, false);
  assert.equal(c.exists, true);
  assert.equal(c.done, false);
  assert.equal(c.lineSent, false);
  assert.deepEqual(c.plannedPlain, ["nail"]);
  assert.deepEqual(c.plannedCount, [{ id: "brush", need: 3 }]);
});

test("careOnDate: 記録あり（done / lineSent を反映）", () => {
  const rabbit = {
    careSchedule: { d: ["nail"] },
    careCounts: {},
    dailyRecords: {
      d: {
        care: {
          items: { nail: true },
          counts: { brush: { need: 3, done: 1 } },
          done: true,
          lineSent: true,
        },
      },
    },
  };
  const c = careOnDate(rabbit, "d", new Set(["brush"]));
  assert.equal(c.hasRecord, true);
  assert.equal(c.done, true);
  assert.equal(c.lineSent, true);
  assert.deepEqual(c.recPlain, ["nail"]);
  assert.deepEqual(c.recCount, [{ id: "brush", need: 3, done: 1 }]);
});

test("careOnDate: 予定も記録も無ければ exists=false", () => {
  const c = careOnDate({ careSchedule: {}, careCounts: {}, dailyRecords: {} }, "d");
  assert.equal(c.exists, false);
});

test("runOnDate: 予定を正とし、実施・送信済みは下回らせない", () => {
  assert.deepEqual(runOnDate({ runSchedule: { d: 2 }, dailyRecords: {} }, "d"), {
    need: 2,
    done: 0,
    sent: 0,
    exists: true,
  });
  assert.deepEqual(
    runOnDate(
      {
        runSchedule: { d: 1 },
        dailyRecords: { d: { run: { needed: 1, doneCount: 2, sentCount: 2 } } },
      },
      "d",
    ),
    { need: 2, done: 2, sent: 2, exists: true },
  );
  assert.equal(runOnDate({ runSchedule: {}, dailyRecords: {} }, "d").exists, false);
});

test("calculatePhotoNeeded: 予定なし・定休日でない・繁忙期でない日だけ必要", () => {
  assert.equal(calculatePhotoNeeded("2026-09-10", {}, {}, NO_HOL, []), true);
  assert.equal(calculatePhotoNeeded("2026-09-10", { "2026-09-10": ["x"] }, {}, NO_HOL, []), false);
  assert.equal(calculatePhotoNeeded("2026-09-10", {}, { "2026-09-10": 1 }, NO_HOL, []), false);
  assert.equal(
    calculatePhotoNeeded("2026-09-10", {}, {}, { weekdays: [], dates: ["2026-09-10"] }, []),
    false,
  );
  assert.equal(
    calculatePhotoNeeded("2026-09-10", {}, {}, NO_HOL, [
      { start: "2026-09-01", end: "2026-09-30" },
    ]),
    false,
  );
});
