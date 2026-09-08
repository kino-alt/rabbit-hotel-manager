import { test } from "node:test";
import assert from "node:assert/strict";

import { scheduleTableHTML, careBreakdownHTML } from "../public/registerGridView.js";

const NO_HOL = { weekdays: [], dates: [] };

function entry(over = {}) {
  return {
    name: "山田 モカ",
    normalIds: ["nail"],
    brushIds: [],
    careDays: ["2026-09-09"],
    itemDay: { nail: "2026-09-09" },
    brushByDay: {},
    runByDay: {},
    ...over,
  };
}

test("scheduleTableHTML: ケアのある日は ✓、ない日は ＋（data-addday）", () => {
  const html = scheduleTableHTML([entry()], ["2026-09-08", "2026-09-09"], {
    holidays: NO_HOL,
    busyPeriods: [],
  });
  // 9/9 はケアあり（nail 1件）→ ✓
  assert.match(html, /cell-care on">✓/);
  // 9/8 はケアなし → ＋ の追加セル
  assert.match(html, /data-addday data-e="0" data-d="2026-09-08"/);
  // うさぎ名の見出し
  assert.match(html, /sched-name">山田 モカ/);
});

test("scheduleTableHTML: ケア日だが中身0なら – の取り消しセル", () => {
  const html = scheduleTableHTML(
    [entry({ careDays: ["2026-09-08", "2026-09-09"] })],
    ["2026-09-08"],
    {
      holidays: NO_HOL,
      busyPeriods: [],
    },
  );
  // 9/8 は careDays に入っているが nail は 9/9 → units 0 → –
  assert.match(html, /data-rmday data-e="0" data-d="2026-09-08"[^>]*>–/);
});

test("scheduleTableHTML: ラン回数はセレクトで、選択済みが selected", () => {
  const html = scheduleTableHTML([entry({ runByDay: { "2026-09-09": 2 } })], ["2026-09-09"], {
    holidays: NO_HOL,
    busyPeriods: [],
  });
  assert.match(html, /select class="run-sel" data-e="0" data-d="2026-09-09"/);
  assert.match(html, /<option value="2" selected>2<\/option>/);
  assert.match(html, /cell-run on/);
});

test("scheduleTableHTML: 定休日の列は cell-off で操作不可", () => {
  const html = scheduleTableHTML([entry()], ["2026-09-09"], {
    holidays: { weekdays: [], dates: ["2026-09-09"] },
    busyPeriods: [],
  });
  assert.match(html, /col-holiday/);
  assert.match(html, /cell-off/);
  assert.doesNotMatch(html, /data-addday/);
});

test("careBreakdownHTML: ケア日が1日なら空文字", () => {
  assert.equal(careBreakdownHTML([entry()], { holidays: NO_HOL, careItemName: (id) => id }), "");
});

test("careBreakdownHTML: 通常項目は日付チップ（選択中に on）", () => {
  const e = entry({
    careDays: ["2026-09-08", "2026-09-09"],
    itemDay: { nail: "2026-09-09" },
  });
  const html = careBreakdownHTML([e], { holidays: NO_HOL, careItemName: () => "爪切り" });
  assert.match(html, /補足：ケアが複数日/);
  assert.match(html, /daychip on"><input type="radio"[^>]*data-d="2026-09-09"[^>]*checked/);
  assert.match(html, /爪切り/);
});

test("careBreakdownHTML: 回数式項目は日ごとの − n + と合計", () => {
  const e = entry({
    normalIds: [],
    brushIds: ["brush"],
    careDays: ["2026-09-08", "2026-09-09"],
    itemDay: {},
    brushByDay: { "2026-09-08": { brush: 1 }, "2026-09-09": { brush: 2 } },
  });
  const html = careBreakdownHTML([e], { holidays: NO_HOL, careItemName: () => "プチブラシ" });
  assert.match(html, /全3回/);
  assert.match(html, /data-binc data-e="0" data-d="2026-09-08" data-id="brush"/);
});
