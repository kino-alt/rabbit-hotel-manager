// 当日記録のケア（items / counts）を、その日の予定（careSchedule / careCounts）へ
// 合わせる純粋ロジック。dailyRecord.js から使う（Firestore に依存しない＝テスト可能）。

// items: { id: bool }（通常項目） / counts: { id: {need,done} }（回数式項目）
export function computeAllDone(items, counts) {
  const itemVals = Object.values(items || {});
  const countVals = Object.values(counts || {});
  if (itemVals.length === 0 && countVals.length === 0) return true;
  return itemVals.every(Boolean) && countVals.every((c) => (c.done || 0) >= (c.need || 0));
}

// 記録のケアを予定へ合わせる。
//   ・予定に増えた項目 → 追加（done=false）／回数式は need を追随
//   ・removeUnfulfilled=true のとき、予定から外れた未実施項目 → 削除
//   ・実施済み（items[id]===true / counts[id].done>0）は常に保持
// 戻り値 { items, counts, changed }
export function reconcileCare(existingCare, schedIds, dayCounts, countableIds, removeUnfulfilled) {
  const care = existingCare || { items: {}, counts: {} };
  dayCounts = dayCounts || {};
  const wantPlain = new Set();
  const wantCount = new Set();
  (schedIds || []).forEach((id) => (countableIds.has(id) ? wantCount : wantPlain).add(id));

  const items = { ...(care.items || {}) };
  const counts = { ...(care.counts || {}) };
  let changed = false;

  for (const id of wantPlain) if (!(id in items)) { items[id] = false; changed = true; }
  for (const id of wantCount) {
    const need = dayCounts[id] || 1;
    if (!counts[id]) { counts[id] = { need, done: 0 }; changed = true; }
    else if ((counts[id].need || 0) !== need) { counts[id] = { ...counts[id], need }; changed = true; }
  }

  if (removeUnfulfilled) {
    for (const id of Object.keys(items)) {
      if (!wantPlain.has(id) && items[id] !== true) { delete items[id]; changed = true; }
    }
    for (const id of Object.keys(counts)) {
      if (!wantCount.has(id) && !((counts[id].done || 0) > 0)) { delete counts[id]; changed = true; }
    }
  }
  return { items, counts, changed };
}
