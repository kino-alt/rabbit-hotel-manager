// 予定（careSchedule / careCounts / runSchedule）の3-wayマージ。
// db.writeSchedulesMerge のトランザクションから使う純粋ロジック（Firestore に依存しない＝テスト可能）。
//
//   base … STEP2 に入った時点の値（利用者が編集を始めた基準）
//   next … グリッドの現在値（利用者が作りたい状態）
//   cur  … サーバの最新値（別端末の更新を含む）
//
// 「利用者が変えた日（next≠base）」かつ「まだサーバがその値になっていない日（next≠cur）」
// だけを field path 単位で返す。別端末が別の日／同じ結論に更新済みなら触らない。

// 「この field path は削除する」ことを表す番兵。呼び出し側（db.js）が deleteField() へ変換する。
export const DELETE = Symbol("deleteField");

const KEYS = ["careSchedule", "careCounts", "runSchedule"];

export function computeSchedulePatch(base, next, cur) {
  base = base || {};
  next = next || {};
  cur = cur || {};
  const patch = {};

  for (const key of KEYS) {
    if (!next[key]) continue;   // その系統は今回の保存対象外
    const b = base[key] || {};
    const n = next[key] || {};
    const c = cur[key] || {};

    for (const d of new Set([...Object.keys(b), ...Object.keys(n)])) {
      const userChanged = JSON.stringify(n[d]) !== JSON.stringify(b[d]);
      if (!userChanged) continue;                                  // 利用者は触っていない
      if (JSON.stringify(n[d]) === JSON.stringify(c[d])) continue; // 既にサーバがその状態
      patch[`${key}.${d}`] = (d in n) ? n[d] : DELETE;
    }
  }
  return patch;
}
