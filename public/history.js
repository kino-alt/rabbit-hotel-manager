// 過去の記録参照画面。
// 全体一覧と同じグリッド様式で、表示範囲を「1か月」にしたもの。
// ここに出すのは「宿泊終了（hiddenAt あり）」にしたうさぎだけ（＝全体一覧から消えたぶん）。
// 閲覧専用：うさぎ名から編集画面へは飛ばない。

import { requireAuth } from "./auth.js";
import * as db from "./db.js";
import { STORE_ID, currentStoreName } from "./firebase-config.js";
import {
  todayMonth,
  addMonths,
  formatMonthJP,
  eachDate,
  countableIdSet,
  isStayEnded,
} from "./schedule.js";
import { scheduleGridHTML } from "./overviewView.js";

const gridEl = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const monthLabel = document.getElementById("month-label");
const summaryEl = document.getElementById("summary");
const nextBtn = document.getElementById("next-month");

let rabbits = [];
let holidays = { weekdays: [], dates: [] };
let busyPeriods = [];
let countableIds = new Set();
let currentMonth = todayMonth(); // "YYYY-MM"

// その月の初日・末日（"YYYY-MM-DD"）
function monthRange(mk) {
  const [y, m] = mk.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${mk}-01`, last: `${mk}-${String(lastDay).padStart(2, "0")}` };
}

function render() {
  monthLabel.textContent = formatMonthJP(currentMonth);
  nextBtn.disabled = currentMonth >= todayMonth();

  const { first, last } = monthRange(currentMonth);

  // 宿泊終了（お迎え日が過ぎた or 明示的に非表示）で、その月に滞在期間が重なるうさぎだけ
  const inMonth = rabbits.filter(
    (r) =>
      isStayEnded(r) &&
      r.checkInDate &&
      r.checkOutDate &&
      r.checkInDate <= last &&
      r.checkOutDate >= first,
  );

  emptyEl.hidden = inMonth.length > 0;
  if (inMonth.length === 0) {
    gridEl.innerHTML = "";
    summaryEl.textContent = "";
    return;
  }

  summaryEl.textContent = `宿泊終了 ${inMonth.length}件`;

  const dates = eachDate(first, last);
  gridEl.innerHTML = scheduleGridHTML(
    inMonth,
    dates,
    { holidays, busyPeriods, countableIds },
    { nameLink: false },
  );
}

document.getElementById("prev-month").addEventListener("click", () => {
  currentMonth = addMonths(currentMonth, -1);
  render();
});
nextBtn.addEventListener("click", () => {
  if (currentMonth >= todayMonth()) return;
  currentMonth = addMonths(currentMonth, 1);
  render();
});

requireAuth(async () => {
  document.getElementById("store-name").textContent = currentStoreName();
  const cfg = await db.getStoreConfig(STORE_ID);
  holidays = cfg.holidays;
  busyPeriods = cfg.busyPeriods;
  countableIds = countableIdSet(cfg.careItemsMaster);
  rabbits = await db.getAllRabbits(STORE_ID);
  render();
});
