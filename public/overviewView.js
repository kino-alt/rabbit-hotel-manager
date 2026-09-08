// 全体一覧（日付 × うさぎ）の描画ロジック。main.html（担当選択の下）に埋め込んで使う。

import * as db from "./db.js";
import { STORE_ID } from "./firebase-config.js";
import {
  todayISO,
  addDays,
  eachDate,
  dayWd,
  calculatePhotoNeeded,
  isBusyPeriod,
  isHoliday,
  countableIdSet,
  careOnDate,
  runOnDate,
} from "./schedule.js";
import { esc } from "./esc.js";

const SPAN = 7; // 本日から1週間

function shortDate(iso) {
  const { day, wd } = dayWd(iso);
  return `${day}<span class="wd">${wd}</span>`;
}

// 〇＝未実施　◐＝実施済み　●＝LINE送信済み
function mark3(need, done, sent) {
  if (need <= 0) return "";
  if (sent) return "●";
  if (done >= need) return "◐";
  return "〇";
}

// その日が未来なら予定、今日以降なら実績を参照してセル内容を決める
function getCellStatus(rabbit, date, type, holidays, busyPeriods, countableIds) {
  if (!(rabbit.checkInDate <= date && date <= rabbit.checkOutDate)) return "";
  const today = todayISO();
  const rec = rabbit.dailyRecords && rabbit.dailyRecords[date];
  const isFuture = date > today;

  if (type === "care") {
    const c = careOnDate(rabbit, date, countableIds);
    if (isFuture) return c.hasPlan ? "〇" : ""; // 未来日は予定だけを見る
    if (!c.exists) return "";
    if (c.lineSent) return "●";
    if (c.done) return "◐"; // 「ケア完了」ボタンが押されたとき
    return "〇";
  }

  if (type === "run") {
    const { need, done, sent } = runOnDate(rabbit, date);
    if (isFuture) return need > 0 ? "〇" : "";
    return mark3(need, done, need > 0 && sent >= need);
  }

  // photo
  if (!isFuture && rec && rec.photo) {
    if (rec.photo.sent) return "●";
    if (rec.photo.taken) return "◐";
    return rec.photo.needed ? "〇" : "";
  }
  if (isBusyPeriod(date, busyPeriods)) return "";
  const needed = calculatePhotoNeeded(
    date,
    rabbit.careSchedule,
    rabbit.runSchedule,
    holidays,
    busyPeriods,
  );
  return needed ? "〇" : "";
}

// うさぎ1匹分の予定を、全体一覧と同じ様式（種別×宿泊日）の表HTMLで返す。
// ctx = { holidays, busyPeriods, countableIds }
export function rabbitScheduleTableHTML(r, ctx) {
  const { holidays, busyPeriods, countableIds } = ctx;
  const today = todayISO();
  const dates = r.checkInDate && r.checkOutDate ? eachDate(r.checkInDate, r.checkOutDate) : [];

  let html = "<table class='overview compact single'><thead><tr><th class='kind'></th>";
  for (const d of dates) {
    const hol = isHoliday(d, holidays) ? " col-holiday" : "";
    html += `<th class="dcol${hol}${d === today ? " today" : ""}">${shortDate(d)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const type of ["care", "run", "photo"]) {
    html += `<tr><td class="kind">${{ care: "ケア", run: "ラン", photo: "写真" }[type]}</td>`;
    for (const d of dates) {
      const cls =
        "dcol in-stay" +
        (isHoliday(d, holidays) ? " col-holiday" : "") +
        (d === today ? " today" : "");
      html += `<td class="${cls}">${getCellStatus(r, d, type, holidays, busyPeriods, countableIds)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

// rabbits × dates のグリッド表HTML（thead + tbody）。全体一覧と過去の記録で共用する。
// ctx  = { holidays, busyPeriods, countableIds }
// opts = { today?, nameLink? }  nameLink:true でうさぎ名を <a data-rabbit> にする
export function scheduleGridHTML(rabbits, dates, ctx, opts = {}) {
  const { holidays, busyPeriods, countableIds } = ctx;
  const today = opts.today ?? todayISO();
  const meta = dates.map((d) => ({
    d,
    hol: isHoliday(d, holidays) ? " col-holiday" : "",
    today: d === today ? " today" : "",
  }));
  const sorted = [...rabbits].sort((a, b) =>
    (a.ownerLastName || "").localeCompare(b.ownerLastName || "", "ja"),
  );

  let html = "<thead><tr><th class='rabbit-name'>うさぎ</th><th class='kind'></th>";
  for (const m of meta) html += `<th class="dcol${m.hol}${m.today}">${shortDate(m.d)}</th>`;
  html += "</tr></thead><tbody>";

  sorted.forEach((r, i) => {
    const name = esc(`${r.ownerLastName || ""} ${r.rabbitName || ""}`);
    const staff = r.staffName ? `<span class="ov-staff">担当 ${esc(r.staffName)}</span>` : "";
    // 次のうさぎが別の飼い主なら、このうさぎの下を2重線で区切る
    const nextSame =
      sorted[i + 1] && (sorted[i + 1].ownerLastName || "") === (r.ownerLastName || "");
    const grpEnd = i < sorted.length - 1 && !nextSame;

    ["care", "run", "photo"].forEach((type, ri) => {
      html += ri === 2 && grpEnd ? '<tr class="grp-end">' : "<tr>";
      if (ri === 0) {
        const inner = opts.nameLink ? `<a href="#" data-rabbit="${esc(r.id)}">${name}</a>` : name;
        html += `<td class='rabbit-name${grpEnd ? " grp-end" : ""}' rowspan='3'>${inner}${staff}</td>`;
      }
      html += `<td class="kind">${{ care: "ケア", run: "ラン", photo: "写真" }[type]}</td>`;
      for (const m of meta) {
        const inStay = r.checkInDate <= m.d && m.d <= r.checkOutDate;
        const cls = "dcol" + m.hol + (inStay ? " in-stay" : "") + m.today;
        html += `<td class="${cls}">${getCellStatus(r, m.d, type, holidays, busyPeriods, countableIds)}</td>`;
      }
      html += "</tr>";
    });
  });
  html += "</tbody>";
  return html;
}

// elements: { table, rangeLabel, prev, next }
// うさぎ名クリックで register.html?id=... へ飛べるようにする（onRabbitClick 省略時は編集画面へ）
export function initOverview(elements, onRabbitClick) {
  const { table, rangeLabel, prev, next } = elements;
  const goRabbit =
    onRabbitClick ||
    ((id) => {
      location.href = `register.html?id=${encodeURIComponent(id)}`;
    });

  let startDate = todayISO(); // 本日から
  let rabbits = [];
  let holidays = { weekdays: [], dates: [] };
  let busyPeriods = [];
  let countableIds = new Set();

  function dateRange() {
    const out = [];
    for (let i = 0; i < SPAN; i++) out.push(addDays(startDate, i));
    return out;
  }

  function render() {
    const dates = dateRange();
    const last = dates[dates.length - 1];
    if (rangeLabel) {
      const fmt = (iso) => {
        const [, m, d] = iso.split("-");
        return `${+m}/${+d}(${dayWd(iso).wd})`;
      };
      rangeLabel.textContent = `${fmt(dates[0])}〜${fmt(last)}`;
    }

    const visible = rabbits.filter((r) => r.checkInDate <= last && r.checkOutDate >= dates[0]);

    if (visible.length === 0) {
      table.innerHTML =
        "<tbody><tr><td class='muted' style='padding:12px'>この期間の宿泊はありません</td></tr></tbody>";
      return;
    }

    table.innerHTML = scheduleGridHTML(
      visible,
      dates,
      { holidays, busyPeriods, countableIds },
      { nameLink: true },
    );

    table.querySelectorAll("a[data-rabbit]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        goRabbit(a.dataset.rabbit);
      });
    });
  }

  if (prev)
    prev.addEventListener("click", () => {
      startDate = addDays(startDate, -SPAN);
      render();
    });
  if (next)
    next.addEventListener("click", () => {
      startDate = addDays(startDate, SPAN);
      render();
    });

  let rabbitsUnsub = null;
  const storeUnsub = db.subscribeStoreConfig(STORE_ID, (cfg) => {
    holidays = cfg.holidays;
    busyPeriods = cfg.busyPeriods;
    countableIds = countableIdSet(cfg.careItemsMaster);
    if (rabbitsUnsub) {
      render(); // 設定変更（定休日・ケア項目）を反映
    } else {
      rabbitsUnsub = db.subscribeActiveRabbits(STORE_ID, (list) => {
        rabbits = list;
        render();
      });
    }
  });
  return () => {
    storeUnsub();
    if (rabbitsUnsub) rabbitsUnsub();
  };
}
