// データアクセス層：Firestoreへの読み書きをまとめる薄い層
// 画面層・共通ロジック層はこのファイル経由でのみFirestoreに触れる。

import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  deleteField,
  Timestamp,
  runTransaction,
  arrayUnion,
  arrayRemove,
} from "./vendor.js";

import { firestore, STORE_ID } from "./firebase-config.js";
import { computeSchedulePatch, DELETE } from "./scheduleMerge.js";

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 182;

function storeRef(storeId) {
  return doc(firestore, "stores", storeId);
}
function rabbitsCol(storeId) {
  return collection(firestore, "stores", storeId, "rabbits");
}
function rabbitRef(storeId, rabbitId) {
  return doc(firestore, "stores", storeId, "rabbits", rabbitId);
}

// ---- config（全店舗共通） ----

export async function getConfig() {
  const snap = await getDoc(doc(firestore, "config", "common"));
  return snap.exists() ? snap.data() : null;
}

// ---- うさぎ（宿泊記録） ----

// 新規登録・編集を保存。data.id があれば更新、なければ新規。
export async function saveRabbit(storeId, data) {
  const { id, ...fields } = data;
  if (id) {
    await updateDoc(rabbitRef(storeId, id), fields);
    return id;
  }
  const ref = await addDoc(rabbitsCol(storeId), {
    careSchedule: {},
    careCounts: {},
    runSchedule: {},
    dailyRecords: {},
    hiddenAt: null,
    expireAt: null,
    createdAt: serverTimestamp(),
    ...fields,
  });
  return ref.id;
}

// うさぎ文書1件を一度だけ取得
export async function getRabbit(storeId, rabbitId) {
  const snap = await getDoc(rabbitRef(storeId, rabbitId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// うさぎ文書1件をリアルタイム購読（dailyRecordsを含む文書全体）
export function subscribeRabbit(storeId, rabbitId, callback) {
  return onSnapshot(rabbitRef(storeId, rabbitId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// 非表示になっていないうさぎ一覧をリアルタイム購読（全体一覧が使う）
// （画面側で日付範囲などに絞り込む）
export function subscribeActiveRabbits(storeId, callback) {
  const q = query(rabbitsCol(storeId), where("hiddenAt", "==", null));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r._placeholder));
  });
}

// 宿泊終了（hiddenAt あり）も含めた全うさぎをリアルタイム購読（ケア/ラン担当が使う）。
// 宿泊終了したうさぎも、その滞在期間の日付を開けば記録が見られるようにするため。
// TTL設定用のダミー（_placeholder）は除外する。画面側で日付で絞り込む。
export function subscribeAllRabbits(storeId, callback) {
  return onSnapshot(rabbitsCol(storeId), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r._placeholder));
  });
}

// 非表示分も含めた全うさぎを一度だけ取得（過去記録の参照用）
// TTL設定用のダミー（_placeholder）は除外する。
export async function getAllRabbits(storeId) {
  const snap = await getDocs(rabbitsCol(storeId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r._placeholder);
}

// うさぎ文書内の dailyRecords.{date} 部分だけを部分更新する（マージ書き込み）
export async function writeDailyRecord(storeId, rabbitId, date, data) {
  await setDoc(rabbitRef(storeId, rabbitId), { dailyRecords: { [date]: data } }, { merge: true });
}

// うさぎ文書の field path をまとめて更新する低レベル関数（updateDoc）。
// 例: { "dailyRecords.2026-09-07.care.items": {...}, "dailyRecords.2026-09-07.run.needed": 2 }
export async function patchRabbit(storeId, rabbitId, fieldPatch) {
  if (fieldPatch && Object.keys(fieldPatch).length) {
    await updateDoc(rabbitRef(storeId, rabbitId), fieldPatch);
  }
}

// その日のケア項目マップから1項目を完全に削除する
export async function deleteCareItemForDate(storeId, rabbitId, date, itemId) {
  await updateDoc(rabbitRef(storeId, rabbitId), {
    [`dailyRecords.${date}.care.items.${itemId}`]: deleteField(),
  });
}

// その日の回数式ケア（care.counts）から1項目を完全に削除する
export async function deleteCareCountForDate(storeId, rabbitId, date, itemId) {
  await updateDoc(rabbitRef(storeId, rabbitId), {
    [`dailyRecords.${date}.care.counts.${itemId}`]: deleteField(),
  });
}

// ケア担当「項目を編集」：その日の予定を1項目単位で足す／消す。
//   addCareItem:    { date, id }   careSchedule[date] へ arrayUnion（配列単位でアトミック）
//   removeCareItem: { date, id }   careSchedule[date] から arrayRemove
//   setCareCount:   { date, id, n } careCounts[date][id] = n
//   delCareCount:   { date, id }   careCounts[date][id] を削除
//   setRunCount:    { date, n }    runSchedule[date] = n（n<=0 なら削除）
// arrayUnion/arrayRemove を使うので、同じうさぎ・同じ日に別スタッフが
// 別項目を足しても取りこぼさない。
export async function patchScheduleDay(storeId, rabbitId, ops) {
  const { addCareItem, removeCareItem, setCareCount, delCareCount, setRunCount } = ops;
  const patch = {};
  if (addCareItem) patch[`careSchedule.${addCareItem.date}`] = arrayUnion(addCareItem.id);
  if (removeCareItem) patch[`careSchedule.${removeCareItem.date}`] = arrayRemove(removeCareItem.id);
  if (setCareCount) patch[`careCounts.${setCareCount.date}.${setCareCount.id}`] = setCareCount.n;
  if (delCareCount) patch[`careCounts.${delCareCount.date}.${delCareCount.id}`] = deleteField();
  if (setRunCount)
    patch[`runSchedule.${setRunCount.date}`] = setRunCount.n > 0 ? setRunCount.n : deleteField();
  if (Object.keys(patch).length) await updateDoc(rabbitRef(storeId, rabbitId), patch);
}

// 予定の保存（3-way マージ・トランザクション版）。登録画面の保存から使う。
// マージ判定は scheduleMerge.computeSchedulePatch（純粋関数）に切り出してテスト可能にしている。
// 戻り値：実際に書き込んだ field path の配列。
export async function writeSchedulesMerge(storeId, rabbitId, base, next) {
  const ref = rabbitRef(storeId, rabbitId);
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : {};
    const raw = computeSchedulePatch(base, next, cur);
    const patch = {};
    for (const [path, val] of Object.entries(raw)) {
      patch[path] = val === DELETE ? deleteField() : val;
    }
    const paths = Object.keys(patch);
    if (paths.length) tx.update(ref, patch);
    return paths;
  });
}

// 宿泊終了：非表示にした日時と、その6ヶ月後のexpireAt（Firestore TTLの起点）を書き込む
export async function hideRabbit(storeId, rabbitId) {
  await updateDoc(rabbitRef(storeId, rabbitId), {
    hiddenAt: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + SIX_MONTHS_MS),
  });
}

// 非表示を取り消す（誤操作の復旧用）
export async function unhideRabbit(storeId, rabbitId) {
  await updateDoc(rabbitRef(storeId, rabbitId), { hiddenAt: null, expireAt: null });
}

// ---- 店舗設定（ケア項目マスタ・定休日） ----
// careItemsMaster は店舗文書内の配列フィールドとして保持する:
//   [{ id, name, order }, ...]  （店長設定で一括編集するため、コレクションより配列が扱いやすい）

export async function getStore(storeId) {
  const snap = await getDoc(storeRef(storeId));
  return snap.exists() ? snap.data() : null;
}

// 店舗設定（ケア項目マスタ・定休日・繁忙期）をまとめて1回の読み取りで返す。
// 画面起動時はこれを使い、getStore（＝stores/{id} の読み取り）が3回走るのを防ぐ。
export async function getStoreConfig(storeId) {
  return shapeStoreConfig(await getStore(storeId));
}

function shapeStoreConfig(s) {
  s = s || {};
  return {
    careItemsMaster: [...(s.careItemsMaster || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    holidays: s.holidays || { weekdays: [], dates: [] },
    busyPeriods: [...(s.busyPeriods || [])].sort((a, b) =>
      (a.start || "").localeCompare(b.start || ""),
    ),
  };
}

// 店舗設定をリアルタイム購読する。設定画面での変更が開いている画面へ即反映される。
export function subscribeStoreConfig(storeId, callback) {
  return onSnapshot(storeRef(storeId), (snap) => {
    callback(shapeStoreConfig(snap.exists() ? snap.data() : null));
  });
}

export async function getCareItemsMaster(storeId) {
  const s = await getStore(storeId);
  const items = (s && s.careItemsMaster) || [];
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function updateCareItemsMaster(storeId, items) {
  await setDoc(storeRef(storeId), { careItemsMaster: items }, { merge: true });
}

export async function updateHolidays(storeId, holidays) {
  await setDoc(storeRef(storeId), { holidays }, { merge: true });
}

// 繁忙期（店舗単位）。busyPeriods: [{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }]
// この期間中は全うさぎで写真が「不要」になる。
export async function updateBusyPeriods(storeId, busyPeriods) {
  await setDoc(storeRef(storeId), { busyPeriods }, { merge: true });
}

export { STORE_ID };
