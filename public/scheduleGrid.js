// うさぎ登録・編集 STEP2 のグリッド作業データ（entry）と、
// Firestore 形式（careSchedule / careCounts / runSchedule）の相互変換。
// DOM には触れない純粋ロジック。register.js の STEP2 から使う。
//
// entry = {
//   name, card,
//   normalIds:  [id]            通常ケア項目（この宿泊で行うもの）
//   brushIds:   [id]            回数式ケア項目（プチブラシ等）
//   careDays:   [YYYY-MM-DD]    ケアを行う日
//   itemDay:    { id: day }     通常項目 → その項目をやる1日
//   brushByDay: { day: { id: n } }  回数式項目 → 日ごとの回数
//   runByDay:   { day: n }      ラン回数
// }

import { calculateDefaultCareDate } from "./schedule.js";

export function normalItemsOnDay(e, d) {
  return e.normalIds.filter((id) => e.itemDay[id] === d);
}
export function brushUnitsOnDay(e, d) {
  return Object.values(e.brushByDay[d] || {}).reduce((n, x) => n + x, 0);
}
export function careUnitsOnDay(e, d) {
  return normalItemsOnDay(e, d).length + brushUnitsOnDay(e, d);
}

// calculatePhotoNeeded 用に careSchedule 形式 { day: [ids] } を作る
export function careScheduleShape(e) {
  const m = {};
  e.careDays.forEach((d) => {
    const ids = [...normalItemsOnDay(e, d), ...Object.keys(e.brushByDay[d] || {})];
    if (ids.length) m[d] = ids;
  });
  return m;
}

// entry → Firestore 形式。中身の無い日は含めない。
export function entryToSchedules(e) {
  const careSchedule = {};
  e.careDays.forEach((d) => {
    const ids = [
      ...normalItemsOnDay(e, d),
      ...Object.keys(e.brushByDay[d] || {}).filter((id) => (e.brushByDay[d][id] || 0) > 0),
    ];
    if (ids.length) careSchedule[d] = ids;
  });

  const careCounts = {};
  Object.entries(e.brushByDay).forEach(([d, day]) => {
    const dd = {};
    Object.entries(day).forEach(([id, n]) => { if (n > 0) dd[id] = n; });
    if (Object.keys(dd).length) careCounts[d] = dd;
  });

  const runSchedule = {};
  for (const [d, n] of Object.entries(e.runByDay)) if (n > 0) runSchedule[d] = n;

  return { careSchedule, careCounts, runSchedule };
}

// STEP1 のカード + 共有情報から entry を組み立てる。
//   prev      … 直前の作業 entry（同じ日程で STEP2 を出し直したときに引き継ぐ）
//   ctx       … { countableIds, holidays, prevRabbit }
//   prevRabbit… 編集時の既存うさぎ文書（新規なら null）
export function buildEntry(shared, card, prev, ctx) {
  const { countableIds, holidays, prevRabbit } = ctx;
  const normalIds = card.careIds.filter((id) => !countableIds.has(id));
  const brushIds = card.careIds.filter((id) => countableIds.has(id));
  const name = `${shared.ownerLastName} ${card.rabbitName}`;
  const dd = calculateDefaultCareDate(shared.checkOutDate, holidays);

  let careDays, itemDay, brushByDay, runByDay;

  if (prev) {
    careDays = prev.careDays.slice();
    if (!careDays.length) careDays = [dd];
    itemDay = {};
    normalIds.forEach((id) => {
      itemDay[id] = (prev.itemDay[id] && careDays.includes(prev.itemDay[id])) ? prev.itemDay[id] : careDays[0];
    });
    brushByDay = {};
    careDays.forEach((d) => {
      const day = {};
      brushIds.forEach((id) => { const n = (prev.brushByDay[d] || {})[id] || 0; if (n) day[id] = n; });
      if (Object.keys(day).length) brushByDay[d] = day;
    });
    runByDay = { ...prev.runByDay };
  } else if (prevRabbit) {
    const cs = prevRabbit.careSchedule || {};
    const cc = prevRabbit.careCounts || {};
    careDays = Object.keys(cs).filter((d) => (cs[d] || []).length).sort();
    if (!careDays.length) careDays = [dd];
    itemDay = {};
    normalIds.forEach((id) => {
      itemDay[id] = careDays.find((d) => (cs[d] || []).includes(id)) || careDays[0];
    });
    brushByDay = {};
    careDays.forEach((d) => {
      const day = {};
      brushIds.forEach((id) => {
        const n = (cc[d] || {})[id] || ((cs[d] || []).includes(id) ? 1 : 0);
        if (n) day[id] = n;
      });
      if (Object.keys(day).length) brushByDay[d] = day;
    });
    runByDay = { ...(prevRabbit.runSchedule || {}) };
  } else {
    careDays = [dd];
    itemDay = {};
    normalIds.forEach((id) => { itemDay[id] = dd; });
    brushByDay = {};
    runByDay = {};
  }

  // 回数式項目の合計を STEP1 の指定回数に合わせる。
  // 分配済みの合計が一致していればそのまま、違えば既定ケア日にまとめ直す。
  brushIds.forEach((id) => {
    const want = (card.brushCounts && card.brushCounts[id]) || 1;
    const have = careDays.reduce((n, d) => n + ((brushByDay[d] || {})[id] || 0), 0);
    if (have !== want) {
      careDays.forEach((d) => { if (brushByDay[d]) delete brushByDay[d][id]; });
      const t = careDays[0];
      brushByDay[t] = brushByDay[t] || {};
      brushByDay[t][id] = want;
    }
  });
  Object.keys(brushByDay).forEach((d) => {
    if (!Object.keys(brushByDay[d]).length) delete brushByDay[d];
  });

  return { name, card, normalIds, brushIds, careDays, itemDay, brushByDay, runByDay };
}
