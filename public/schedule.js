// 共通ロジック層：日付計算
//
// holidays（定休日）の形式:
//   { weekdays: [0..6], dates: ["YYYY-MM-DD", ...] }
//   weekdays … 毎週の定休曜日（0=日, 1=月 ... 6=土）
//   dates    … 臨時休業などの個別日

// ---- 日付ユーティリティ ----

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function todayISO() {
  return toISO(new Date());
}

// ---- 月ユーティリティ（"YYYY-MM"）----

export function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthJP(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${y}年${m}月`;
}

// ---- 宿泊が終了しているか ----
// 「宿泊終了」の判定は次のどちらか：
//   ・お迎え日（checkOutDate）が今日より前          … ボタンを押し忘れても終了扱い
//   ・明示的に「宿泊終了」ボタンを押した（hiddenAt） … TTL（6ヶ月後の自動削除）の起点にもなる
// お迎え日“当日”はまだ終了ではない（最終ケア・お見送りがあるため）。
export function isStayEnded(rabbit, today = todayISO()) {
  if (rabbit && rabbit.hiddenAt) return true;
  return !!(rabbit && rabbit.checkOutDate && rabbit.checkOutDate < today);
}

export function eachDate(startISO, endISO) {
  const out = [];
  let cur = startISO;
  // 上限（無限ループ防止）
  for (let i = 0; i < 366 && cur <= endISO; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function formatJP(iso) {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

// 一覧の列見出し用：日にちと曜日だけ
export function dayWd(iso) {
  const d = parseISO(iso);
  return { day: d.getDate(), wd: WD[d.getDay()] };
}

// ---- 定休日判定 ----

export function isHoliday(iso, holidays) {
  if (!holidays) return false;
  const d = parseISO(iso);
  if (Array.isArray(holidays.weekdays) && holidays.weekdays.includes(d.getDay())) return true;
  if (Array.isArray(holidays.dates) && holidays.dates.includes(iso)) return true;
  return false;
}

// ---- 設計資料に対応する関数 ----

// お迎え日の1日前を計算し、定休日なら直近の営業日まで遡る
export function calculateDefaultCareDate(pickupDate, holidays) {
  let iso = addDays(pickupDate, -1);
  for (let i = 0; i < 14 && isHoliday(iso, holidays); i++) {
    iso = addDays(iso, -1);
  }
  return iso;
}

// ---- 回数式のケア項目 ----
// 「チェック1つ」ではなく「回数（0/n）」で扱う項目。
// 設定画面で各項目に countable フラグを付けて指定する。

export function isCountableItem(m) {
  return !!(m && m.countable);
}

// careMaster（[{id,name,order,countable?}]）から回数式の項目IDの集合を作る
export function countableIdSet(careMaster) {
  return new Set((careMaster || []).filter(isCountableItem).map((m) => m.id));
}

// 繁忙期（店舗設定 busyPeriods: [{ start, end }]）に含まれる日か
export function isBusyPeriod(iso, busyPeriods) {
  if (!Array.isArray(busyPeriods)) return false;
  return busyPeriods.some((p) => p && p.start <= iso && iso <= p.end);
}

// ---- その日のケア／ラン状態の統合ビュー（全画面で共通に使う） ----
//
// 「予定（careSchedule/careCounts・runSchedule）」と
// 「当日記録（dailyRecords[date]）」の2系統を1か所で突き合わせる。
// 各画面はこの戻り値だけを見る（判定ロジックを画面ごとに書かない）。

// その日のケア状態。
//   plannedPlain … 予定の通常項目ID
//   plannedCount … 予定の回数式項目 [{id, need}]
//   recPlain     … 記録の通常項目ID（items のキー）
//   recCount     … 記録の回数式項目 [{id, need, done}]
//   hasPlan/hasRecord … 予定・記録があるか
//   exists       … この日ケアが関係するか（予定 or 記録）
//   done/lineSent … 「ケア完了」「LINE送信済み」フラグ
export function careOnDate(rabbit, date, countableIds = new Set()) {
  const schedIds = (rabbit.careSchedule && rabbit.careSchedule[date]) || [];
  const dayCounts = (rabbit.careCounts && rabbit.careCounts[date]) || {};
  const rec = rabbit.dailyRecords && rabbit.dailyRecords[date];
  const care = (rec && rec.care) || null;

  const plannedPlain = schedIds.filter((id) => !countableIds.has(id));
  const plannedCount = schedIds
    .filter((id) => countableIds.has(id))
    .map((id) => ({ id, need: dayCounts[id] || 1 }));

  const recPlain = care ? Object.keys(care.items || {}) : [];
  const recCount = care
    ? Object.entries(care.counts || {}).map(([id, c]) => ({ id, need: c.need || 0, done: c.done || 0 }))
    : [];

  const hasPlan = schedIds.length > 0;
  const hasRecord = (recPlain.length + recCount.length) > 0;
  const done = !!(care && care.done);
  const lineSent = !!(care && care.lineSent);

  return {
    hasPlan,
    hasRecord,
    exists: hasPlan || hasRecord || done || lineSent,
    done,
    lineSent,
    plannedPlain,
    plannedCount,
    recPlain,
    recCount,
    record: care,
  };
}

// その日のラン状態。予定（runSchedule）を正とし、実施／送信済みは下回らせない。
export function runOnDate(rabbit, date) {
  const rec = rabbit.dailyRecords && rabbit.dailyRecords[date];
  const run = (rec && rec.run) || null;
  const scheduled = (rabbit.runSchedule && rabbit.runSchedule[date]) || 0;
  const done = run ? run.doneCount || 0 : 0;
  const sent = run ? run.sentCount || 0 : 0;
  const need = Math.max(scheduled, done, sent);
  return { need, done, sent, exists: need > 0 };
}

// 写真が必要な日かを自動判定
// （繁忙期・定休日でなく、ケア・ラン予定がともにない日は「必要」）
export function calculatePhotoNeeded(date, careSchedule, runSchedule, holidays, busyPeriods) {
  if (isBusyPeriod(date, busyPeriods)) return false;
  if (isHoliday(date, holidays)) return false;
  const careCount = (careSchedule && careSchedule[date] ? careSchedule[date].length : 0);
  const runCount = (runSchedule && runSchedule[date] ? runSchedule[date] : 0);
  if (careCount > 0) return false;
  if (runCount > 0) return false;
  return true;
}
