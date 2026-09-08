// 共通ロジック層：当日記録（dailyRecords）の生成・更新
//
// 各関数は購読中の rabbit 文書（最新スナップショット）を受け取り、
// 新しい値を計算して db.js 経由でうさぎ文書内の dailyRecords.{date} を部分更新する。

import * as db from "./db.js";
import { calculatePhotoNeeded, isBusyPeriod } from "./schedule.js";
import { computeAllDone, reconcileCare } from "./careReconcile.js";

function emptyRecord() {
  return {
    care: { items: {}, counts: {}, allDone: true, done: false, lineSent: false },
    run: { needed: 0, doneCount: 0, sentCount: 0 },
    photo: { needed: false, taken: false, sent: false },
  };
}

// その日の記録が無ければ careSchedule / runSchedule / photoSchedule からコピーして新規作成。
// 既にあれば何もしない（＝複数スタッフの同時アクセスに安全）。
export async function getOrCreateDailyRecord(
  storeId,
  rabbit,
  date,
  holidays,
  busyPeriods = [],
  countableIds = new Set(),
) {
  const existing = rabbit.dailyRecords && rabbit.dailyRecords[date];
  if (existing) {
    const patch = {};
    let merged = existing;

    // 登録画面でラン回数を変更した場合に記録の needed を追随させる
    // （すでに実施した回数は下回らせない）
    const scheduled = (rabbit.runSchedule && rabbit.runSchedule[date]) || 0;
    const run = existing.run || {};
    const target = Math.max(scheduled, run.doneCount || 0);
    if (target !== (run.needed || 0)) {
      patch.run = { needed: target };
      merged = { ...merged, run: { ...run, needed: target } };
    }

    // 登録画面であとからケア日・ケア項目を足した場合に、
    // まだ記録に無い予定ぶんを取り込む（実施済みの記録は保持。削除はしない）
    const care = existing.care || { items: {}, counts: {} };
    const {
      items,
      counts,
      changed: careChanged,
    } = reconcileCare(
      care,
      (rabbit.careSchedule && rabbit.careSchedule[date]) || [],
      (rabbit.careCounts && rabbit.careCounts[date]) || {},
      countableIds,
      false,
    );
    if (careChanged) {
      const allDone = computeAllDone(items, counts);
      patch.care = { items, counts, allDone };
      merged = { ...merged, care: { ...care, items, counts, allDone } };
    }

    if (Object.keys(patch).length) {
      await db.writeDailyRecord(storeId, rabbit.id, date, patch);
    }
    return merged;
  }

  const careIds = (rabbit.careSchedule && rabbit.careSchedule[date]) || [];
  const dayCounts = (rabbit.careCounts && rabbit.careCounts[date]) || {};
  const items = {};
  const counts = {};
  careIds.forEach((id) => {
    if (countableIds.has(id)) counts[id] = { need: dayCounts[id] || 1, done: 0 };
    else items[id] = false;
  });

  const runNeeded = (rabbit.runSchedule && rabbit.runSchedule[date]) || 0;

  let photoNeeded;
  const ps = rabbit.photoSchedule && rabbit.photoSchedule[date];
  if (isBusyPeriod(date, busyPeriods))
    photoNeeded = false; // 繁忙期は写真不要
  else if (ps === "needed") photoNeeded = true;
  else if (ps === "not_needed") photoNeeded = false;
  else
    photoNeeded = calculatePhotoNeeded(
      date,
      rabbit.careSchedule,
      rabbit.runSchedule,
      holidays,
      busyPeriods,
    );

  const record = {
    care: { items, counts, allDone: computeAllDone(items, counts), done: false, lineSent: false },
    run: { needed: runNeeded, doneCount: 0, sentCount: 0 },
    photo: { needed: photoNeeded, taken: false, sent: false },
  };

  await db.writeDailyRecord(storeId, rabbit.id, date, record);
  return record;
}

// 既存の当日記録を、現在の予定へ「完全に」合わせる（登録画面での予定変更を保存した直後に呼ぶ）。
// 予定に増えた項目は追加、外れた未実施項目は削除。実施済み・done・lineSent は保持。
// 記録がまだ無い日は何もしない（記録の生成はケア/ラン画面の担当）。
export async function reconcileDailyRecord(storeId, rabbit, date, countableIds = new Set()) {
  const rec = rabbit.dailyRecords && rabbit.dailyRecords[date];
  if (!rec) return;

  const patch = {};

  if (rec.care) {
    const { items, counts, changed } = reconcileCare(
      rec.care,
      (rabbit.careSchedule && rabbit.careSchedule[date]) || [],
      (rabbit.careCounts && rabbit.careCounts[date]) || {},
      countableIds,
      true,
    );
    if (changed) {
      // field path 書き込みで items/counts サブマップを丸ごと差し替え（done/lineSent は保持）
      patch[`dailyRecords.${date}.care.items`] = items;
      patch[`dailyRecords.${date}.care.counts`] = counts;
      patch[`dailyRecords.${date}.care.allDone`] = computeAllDone(items, counts);
    }
  }

  const scheduled = (rabbit.runSchedule && rabbit.runSchedule[date]) || 0;
  const run = rec.run || {};
  const runTarget = Math.max(scheduled, run.doneCount || 0);
  if (runTarget !== (run.needed || 0)) {
    patch[`dailyRecords.${date}.run.needed`] = runTarget;
  }

  await db.patchRabbit(storeId, rabbit.id, patch);
}

function recordOf(rabbit, date) {
  return (rabbit.dailyRecords && rabbit.dailyRecords[date]) || emptyRecord();
}

// ケア項目1つの実施状況を更新し、全完了かを自動判定する（通常項目：チェック）
export async function updateCareItem(storeId, rabbit, date, itemId, done) {
  const rec = recordOf(rabbit, date);
  const items = { ...(rec.care.items || {}), [itemId]: done };
  const allDone = computeAllDone(items, rec.care.counts);

  await db.writeDailyRecord(storeId, rabbit.id, date, { care: { items, allDone } });

  const was = rec.care.items && rec.care.items[itemId] === true;
  let delta = 0;
  if (done && !was) delta = 1;
  else if (!done && was) delta = -1;
  if (delta) await db.bumpTotals(storeId, rabbit.id, { careItemId: itemId, careDelta: delta });
}

// 回数式ケア項目の実施回数を設定する（done は新しい実施回数 0..need）
export async function setCareCount(storeId, rabbit, date, itemId, done) {
  const rec = recordOf(rabbit, date);
  const cur = (rec.care.counts && rec.care.counts[itemId]) || { need: 1, done: 0 };
  const next = Math.max(0, Math.min(done, cur.need || 0));
  const delta = next - (cur.done || 0);
  if (delta === 0) return;

  const counts = { ...(rec.care.counts || {}), [itemId]: { ...cur, done: next } };
  const allDone = computeAllDone(rec.care.items, counts);
  await db.writeDailyRecord(storeId, rabbit.id, date, {
    care: { counts: { [itemId]: counts[itemId] }, allDone },
  });
  await db.bumpTotals(storeId, rabbit.id, { careItemId: itemId, careDelta: delta });
}

// その日だけケア項目を追加する（careScheduleマスタは変更しない）
export async function addCareItemForToday(storeId, rabbit, date, itemId, countable = false) {
  const rec = recordOf(rabbit, date);
  if (countable) {
    if (rec.care.counts && itemId in rec.care.counts) return;
    const counts = { ...(rec.care.counts || {}), [itemId]: { need: 1, done: 0 } };
    await db.writeDailyRecord(storeId, rabbit.id, date, {
      care: {
        counts: { [itemId]: counts[itemId] },
        allDone: computeAllDone(rec.care.items, counts),
      },
    });
    return;
  }
  if (rec.care.items && itemId in rec.care.items) return;
  const items = { ...(rec.care.items || {}), [itemId]: false };
  await db.writeDailyRecord(storeId, rabbit.id, date, {
    care: { items, allDone: computeAllDone(items, rec.care.counts) },
  });
}

// その日だけケア項目を削除する
export async function removeCareItemForToday(storeId, rabbit, date, itemId, countable = false) {
  const rec = recordOf(rabbit, date);

  if (countable) {
    const cur = (rec.care.counts && rec.care.counts[itemId]) || { done: 0 };
    await db.deleteCareCountForDate(storeId, rabbit.id, date, itemId);
    const remaining = { ...(rec.care.counts || {}) };
    delete remaining[itemId];
    await db.writeDailyRecord(storeId, rabbit.id, date, {
      care: { allDone: computeAllDone(rec.care.items, remaining) },
    });
    if (cur.done)
      await db.bumpTotals(storeId, rabbit.id, { careItemId: itemId, careDelta: -cur.done });
    return;
  }

  const wasDone = rec.care.items && rec.care.items[itemId] === true;
  await db.deleteCareItemForDate(storeId, rabbit.id, date, itemId);
  const remaining = { ...(rec.care.items || {}) };
  delete remaining[itemId];
  await db.writeDailyRecord(storeId, rabbit.id, date, {
    care: { allDone: computeAllDone(remaining, rec.care.counts) },
  });
  if (wasDone) {
    await db.bumpTotals(storeId, rabbit.id, { careItemId: itemId, careDelta: -1 });
  }
}

// ---- ケア担当「項目を編集」：その日の予定（careSchedule/careCounts）と当日記録の両方を直す ----

export async function addCareToday(storeId, rabbit, date, itemId, countable = false) {
  const ops = { addCareItem: { date, id: itemId } };
  if (countable) {
    const cur = ((rabbit.careCounts || {})[date] || {})[itemId] || 1;
    ops.setCareCount = { date, id: itemId, n: cur };
  }
  await db.patchScheduleDay(storeId, rabbit.id, ops);
  await addCareItemForToday(storeId, rabbit, date, itemId, countable);
}

export async function removeCareToday(storeId, rabbit, date, itemId, countable = false) {
  const ops = { removeCareItem: { date, id: itemId } };
  if (countable) ops.delCareCount = { date, id: itemId };
  await db.patchScheduleDay(storeId, rabbit.id, ops);
  await removeCareItemForToday(storeId, rabbit, date, itemId, countable);
}

// 回数式項目の「必要回数」を変更（その日の予定＋当日記録）
export async function setCareNeedToday(storeId, rabbit, date, itemId, need) {
  need = Math.max(1, Math.min(9, need));
  await db.patchScheduleDay(storeId, rabbit.id, { setCareCount: { date, id: itemId, n: need } });

  const rec = recordOf(rabbit, date);
  const cur = (rec.care.counts && rec.care.counts[itemId]) || { need: 1, done: 0 };
  const next = { need, done: Math.min(cur.done || 0, need) };
  const merged = { ...(rec.care.counts || {}), [itemId]: next };
  await db.writeDailyRecord(storeId, rabbit.id, date, {
    care: { counts: { [itemId]: next }, allDone: computeAllDone(rec.care.items, merged) },
  });
}

// ケア：「ケア完了」（◐）の設定／取消。ケア担当画面の一覧から隠れ、ラン画面のケア行が出る。
export async function setCareDone(storeId, rabbit, date, value = true) {
  await db.writeDailyRecord(storeId, rabbit.id, date, { care: { done: !!value } });
}
// ケア：「LINE送信済み」（●）の設定／取消。
export async function markCareLineSent(storeId, rabbit, date) {
  await db.writeDailyRecord(storeId, rabbit.id, date, { care: { lineSent: true } });
}
export async function unmarkCareLineSent(storeId, rabbit, date) {
  await db.writeDailyRecord(storeId, rabbit.id, date, { care: { lineSent: false } });
}

// ランの実施済み回数を更新する（index 番目のチェック操作）
export async function updateRunCheck(storeId, rabbit, date, index, done) {
  const rec = recordOf(rabbit, date);
  const cur = rec.run.doneCount || 0;
  const next = done ? Math.max(cur, index + 1) : Math.min(cur, index);
  const delta = next - cur;
  if (delta === 0) return;

  await db.writeDailyRecord(storeId, rabbit.id, date, { run: { doneCount: next } });
  await db.bumpTotals(storeId, rabbit.id, { runDelta: delta });
}

// ラン1回分をLINE送信済みにする
export async function markRunLineSent(storeId, rabbit, date, index) {
  const rec = recordOf(rabbit, date);
  const needed = rec.run.needed || 0;
  const next = Math.min(Math.max(rec.run.sentCount || 0, index + 1), Math.max(needed, index + 1));
  await db.writeDailyRecord(storeId, rabbit.id, date, { run: { sentCount: next } });
}

// ランのLINE送信済みを取り消す（index 回目以降を未送信に戻す）
export async function unmarkRunLineSent(storeId, rabbit, date, index) {
  const rec = recordOf(rabbit, date);
  const next = Math.min(rec.run.sentCount || 0, Math.max(0, index));
  await db.writeDailyRecord(storeId, rabbit.id, date, { run: { sentCount: next } });
}

// 写真の 必要か / 撮影済み / 送信済み を更新する（自動判定後も手動で上書き可能）
export async function updatePhotoStatus(storeId, rabbit, date, field, value) {
  if (!["needed", "taken", "sent"].includes(field)) throw new Error("不正なフィールド: " + field);
  await db.writeDailyRecord(storeId, rabbit.id, date, { photo: { [field]: value } });
}
