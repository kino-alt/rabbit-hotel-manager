// ケア担当画面

import { requireAuth } from "./auth.js";
import * as db from "./db.js";
import * as dr from "./dailyRecord.js";
import { STORE_ID, currentStoreName } from "./firebase-config.js";
import {
  todayISO,
  addDays,
  formatJP,
  countableIdSet,
  careOnDate,
  isStayEnded,
} from "./schedule.js";
import { rabbitScheduleTableHTML } from "./overviewView.js";
import { notifyWriteError } from "./toast.js";
import { enableSwipeComplete } from "./swipe.js";
import { esc } from "./esc.js";
import { icon } from "./icons.js";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const dayLabel = document.getElementById("day-label");

let currentDate = todayISO();
let rabbits = [];
let careMaster = [];
let careIndex = new Map(); // itemId -> { name, order位置 }（find/findIndex の線形探索を避ける）
let countableIds = new Set();
let holidays = { weekdays: [], dates: [] };
let busyPeriods = [];
const expanded = new Set();
const editing = new Set();
let showDone = false; // ケア完了ぶんも一覧に出すか

// 「ケア完了」を押したうさぎ（＝一覧から隠す対象）
function isCareDone(r) {
  return careOnDate(r, currentDate, countableIds).done;
}
const ensured = new Set(); // getOrCreateDailyRecord 済みの rabbitId|date

function itemName(id) {
  const m = careIndex.get(id);
  return m ? m.name : id;
}
// マスタ内の並び順（未登録項目は末尾）
function itemOrder(id) {
  const m = careIndex.get(id);
  return m ? m.pos : Number.MAX_SAFE_INTEGER;
}

function activeOnDate(r, date) {
  return r.checkInDate <= date && date <= r.checkOutDate;
}

// この日にケアが関係するうさぎか（予定あり or 記録あり）
function hasCare(r, date) {
  return careOnDate(r, date, countableIds).exists;
}

// その日のケア予定（記録が無い未来日向け）を {plain:[id], count:[{id,need}]} で返す
function scheduledCare(r, date) {
  const c = careOnDate(r, date, countableIds);
  return { plain: c.plannedPlain, count: c.plannedCount };
}

async function ensureRecords() {
  // 未来日でも先取りでケアできるよう、予定のあるうさぎには記録を用意する
  for (const r of rabbits) {
    if (isStayEnded(r)) continue; // 宿泊終了ぶんは閲覧のみ。新しい記録は作らない
    if (!activeOnDate(r, currentDate) || !hasCare(r, currentDate)) continue;
    // 予定（careSchedule/careCounts/runSchedule）が変わったら取り込み直す
    const key =
      r.id +
      "|" +
      currentDate +
      "|" +
      JSON.stringify([
        (r.careSchedule && r.careSchedule[currentDate]) || [],
        (r.careCounts && r.careCounts[currentDate]) || {},
        (r.runSchedule && r.runSchedule[currentDate]) || 0,
      ]);
    if (ensured.has(key)) continue;
    ensured.add(key);
    try {
      await dr.getOrCreateDailyRecord(
        STORE_ID,
        r,
        currentDate,
        holidays,
        busyPeriods,
        countableIds,
      );
    } catch (err) {
      console.error("getOrCreateDailyRecord", err);
      ensured.delete(key);
    }
  }
}

function render() {
  dayLabel.textContent = formatJP(currentDate) + (currentDate === todayISO() ? "（今日）" : "");
  listEl.innerHTML = "";

  const all = rabbits
    .filter((r) => activeOnDate(r, currentDate) && hasCare(r, currentDate))
    .sort((a, b) => (a.ownerLastName || "").localeCompare(b.ownerLastName || "", "ja"));

  // 「ケア完了」したうさぎは既定で一覧から隠す
  const notDone = all.filter((r) => !isCareDone(r));
  const done = all.filter(isCareDone);

  emptyEl.hidden = notDone.length > 0 || (showDone && done.length > 0);

  notDone.forEach((r) => listEl.appendChild(renderCard(r)));

  if (done.length > 0) {
    const t = document.createElement("button");
    t.className = "ghost small list-toggle";
    t.textContent = showDone ? "実施済み分を隠す" : `実施済み分を表示（${done.length}）`;
    t.addEventListener("click", () => {
      showDone = !showDone;
      render();
    });
    listEl.appendChild(t);

    if (showDone) {
      const sep = document.createElement("div");
      sep.className = "list-sep";
      sep.textContent = "実施済み";
      listEl.appendChild(sep);
      done.forEach((r) => listEl.appendChild(renderCard(r)));
    }
  }
}

function renderCard(r) {
  const rec = (r.dailyRecords && r.dailyRecords[currentDate]) || null;

  // 通常項目（plainIds）と回数式項目（countRows: {id,need,done}）
  let plainIds, countRows;
  if (rec && rec.care) {
    plainIds = Object.keys(rec.care.items || {});
    countRows = Object.entries(rec.care.counts || {}).map(([id, c]) => ({
      id,
      need: c.need || 0,
      done: c.done || 0,
    }));
  } else {
    const s = scheduledCare(r, currentDate);
    plainIds = s.plain;
    countRows = s.count.map((c) => ({ id: c.id, need: c.need, done: 0 }));
  }
  // マスタの並び順で固定する（チェックしても行の位置が変わらないように）
  plainIds.sort((a, b) => itemOrder(a) - itemOrder(b) || String(a).localeCompare(b));
  countRows.sort((a, b) => itemOrder(a.id) - itemOrder(b.id) || String(a.id).localeCompare(b.id));

  const allIds = [...plainIds, ...countRows.map((c) => c.id)];

  const total = plainIds.length + countRows.reduce((n, c) => n + c.need, 0);
  const doneCount =
    (rec ? plainIds.filter((id) => rec.care.items[id] === true).length : 0) +
    countRows.reduce((n, c) => n + Math.min(c.done, c.need), 0);
  const allChecked = total > 0 && doneCount >= total;
  const careDone = !!(rec && rec.care && rec.care.done);

  // 全項目チェック済み＆未完了＆非編集なら、左スワイプで「ケア完了」にできる
  const swipeable = allChecked && !careDone && !editing.has(r.id);

  const card = document.createElement("div");
  card.className = "rabbit" + (swipeable ? " swipeable" : "");
  let host = card;
  if (swipeable) {
    const bg = document.createElement("div");
    bg.className = "swipe-bg";
    bg.textContent = "✓ スワイプで完了";
    host = document.createElement("div");
    host.className = "swipe-fg";
    // 地色・左の緑ラインは style.css の .swipe-fg 側
    card.append(bg, host);
    enableSwipeComplete(card, host, () =>
      dr.setCareDone(STORE_ID, r, currentDate, true).catch(alertErr),
    );
  }

  const head = document.createElement("div");
  head.className = "head";

  // 展開トグル（名前・状況・キャレット）。独立した <button> にして、
  // その隣に「予定を見る」ボタンを置く（ボタンの入れ子を避ける）。
  const main = document.createElement("button");
  main.type = "button";
  main.className = "head-main";
  main.innerHTML = `
    <span class="name grow">${esc(r.ownerLastName || "")} ${esc(r.rabbitName || "")}</span>
    <span class="count">${careDone ? "実施済み" : `ケア ${doneCount}/${total}`}</span>`;
  const tri = document.createElement("span");
  tri.className = "tri" + (expanded.has(r.id) ? " open" : "");
  tri.innerHTML = icon("caret");
  main.appendChild(tri);
  main.addEventListener("click", () => {
    if (expanded.has(r.id)) expanded.delete(r.id);
    else expanded.add(r.id);
    render();
  });
  head.appendChild(main);

  // 「?」＝この子の予定をオーバーレイで見る（ラン担当と同じ）
  const help = document.createElement("button");
  help.type = "button";
  help.className = "help";
  help.setAttribute("aria-label", "この子の予定を見る");
  help.innerHTML = icon("help");
  help.addEventListener("click", (e) => {
    e.stopPropagation();
    openSchedule(r);
  });
  head.appendChild(help);

  host.appendChild(head);

  if (r.note) {
    const n = document.createElement("div");
    n.className = "note";
    n.textContent = "備考：" + r.note;
    host.appendChild(n);
  }

  if (!expanded.has(r.id)) return card;

  const body = document.createElement("div");
  body.className = "body";

  const isEditing = editing.has(r.id);

  if (!isEditing) {
    // === 通常：チェックだけ（「なにをやる／なにが終わった」を把握） ===
    plainIds.forEach((id) => {
      const row = document.createElement("div");
      row.className = "item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!(rec && rec.care.items[id] === true);
      cb.addEventListener("change", () => onCheckboxClick(r, id, cb.checked));
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = itemName(id);
      row.append(cb, label);
      body.appendChild(row);
    });
    countRows.forEach((c) => {
      const row = document.createElement("div");
      row.className = "item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = c.need > 0 && c.done >= c.need;
      cb.addEventListener("change", () => onSetCareCount(r, c.id, cb.checked ? c.need : 0));
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = itemName(c.id) + (c.need > 1 ? ` ×${c.need}` : "");
      row.append(cb, label);
      body.appendChild(row);
    });

    // 目立たない編集リンク
    const er = document.createElement("div");
    er.className = "row row-end";
    const link = document.createElement("button");
    link.className = "link-btn";
    link.textContent = "項目を編集";
    link.addEventListener("click", () => {
      editing.add(r.id);
      render();
    });
    er.appendChild(link);
    body.appendChild(er);
  } else {
    // === 編集モード：計画（この子・この日）の項目を足す／消す／回数を変える ===
    const box = document.createElement("div");
    box.className = "care-edit";

    const h = document.createElement("div");
    h.className = "row spread care-edit-head";
    const ht = document.createElement("span");
    ht.className = "care-edit-title";
    ht.textContent = "ケア項目の編集";
    h.appendChild(ht);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "care-edit-close";
    closeBtn.setAttribute("aria-label", "編集を終える");
    closeBtn.innerHTML = icon("close");
    closeBtn.addEventListener("click", () => {
      editing.delete(r.id);
      render();
    });
    h.appendChild(closeBtn);
    box.appendChild(h);

    const rows = [
      ...plainIds.map((id) => ({ id, countable: false })),
      ...countRows.map((c) => ({ id: c.id, countable: true, need: c.need })),
    ];
    rows.forEach((it) => {
      const row = document.createElement("div");
      row.className = "row edit-row";
      const nm = document.createElement("span");
      nm.className = "grow";
      nm.textContent = itemName(it.id);
      row.appendChild(nm);
      if (it.countable) {
        const sel = document.createElement("select");
        sel.className = "mini-sel";
        for (let i = 1; i <= 9; i++) {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = "×" + i;
          sel.appendChild(o);
        }
        sel.value = String(it.need || 1);
        sel.addEventListener("change", () =>
          dr.setCareNeedToday(STORE_ID, r, currentDate, it.id, +sel.value).catch(alertErr),
        );
        row.appendChild(sel);
      }
      const del = document.createElement("button");
      del.className = "x-btn";
      del.textContent = "×";
      del.addEventListener("click", () =>
        dr.removeCareToday(STORE_ID, r, currentDate, it.id, it.countable).catch(alertErr),
      );
      row.appendChild(del);
      box.appendChild(row);
    });

    const remaining = careMaster.filter((m) => !allIds.includes(m.id));
    if (remaining.length > 0) {
      const sel = document.createElement("select");
      sel.className = "add-sel";
      sel.setAttribute("aria-label", "項目を追加");
      sel.innerHTML =
        `<option value="">＋</option>` +
        remaining.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
      sel.addEventListener("change", () => {
        if (sel.value)
          dr.addCareToday(STORE_ID, r, currentDate, sel.value, countableIds.has(sel.value)).catch(
            alertErr,
          );
      });
      const addRow = document.createElement("div");
      addRow.className = "care-edit-add";
      addRow.appendChild(sel);
      const at = document.createElement("span");
      at.className = "care-edit-add-label";
      at.textContent = "項目を追加";
      addRow.appendChild(at);
      box.appendChild(addRow);
    }
    body.appendChild(box);
  }

  // 全チェック済みなら「左スワイプで完了」の案内
  if (swipeable) {
    const hint = document.createElement("div");
    hint.className = "swipe-note";
    hint.innerHTML = '<span class="sn-txt">スワイプで完了</span>';
    body.appendChild(hint);
  }

  // 実施済み（＝ケア完了）の取消だけ。LINE送信の管理はラン担当。
  if (careDone) {
    const u = document.createElement("button");
    u.type = "button";
    u.className = "undo-btn";
    u.textContent = "実施済みを取消";
    u.addEventListener("click", () =>
      dr.setCareDone(STORE_ID, r, currentDate, false).catch(alertErr),
    );
    const uRow = document.createElement("div");
    uRow.className = "row row-end";
    uRow.appendChild(u);
    body.appendChild(uRow);
  }

  host.appendChild(body);
  return card;
}

// ---- 操作ハンドラ ----

function onCheckboxClick(r, itemId, done) {
  dr.updateCareItem(STORE_ID, r, currentDate, itemId, done).catch(alertErr);
}
function onSetCareCount(r, itemId, done) {
  dr.setCareCount(STORE_ID, r, currentDate, itemId, done).catch(alertErr);
}

// 書き込み失敗をスタッフに見せる（共通トースト）。従来は console のみで握りつぶしていた。
const alertErr = notifyWriteError;

// ---- 予定オーバーレイ（全体一覧と同じ様式で、その子だけ。ラン担当と共通） ----
function openSchedule(r) {
  const ov = document.getElementById("sched-overlay");
  ov.querySelector("#sched-title").textContent =
    `${r.ownerLastName || ""} ${r.rabbitName || ""} の予定`;
  ov.querySelector("#sched-body").innerHTML =
    `<div class="scroll-x">${rabbitScheduleTableHTML(r, { holidays, busyPeriods, countableIds })}</div>`;
  ov.hidden = false;
}
function closeSchedule() {
  document.getElementById("sched-overlay").hidden = true;
}
document.getElementById("sched-overlay").addEventListener("click", (e) => {
  if (e.target.id === "sched-overlay") closeSchedule();
});
document.getElementById("sched-close").addEventListener("click", closeSchedule);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSchedule();
});

// ---- 起動 ----

document.getElementById("prev-day").addEventListener("click", () => {
  currentDate = addDays(currentDate, -1);
  render();
  ensureRecords();
});
document.getElementById("next-day").addEventListener("click", () => {
  currentDate = addDays(currentDate, 1);
  render();
  ensureRecords();
});

requireAuth(() => {
  document.getElementById("store-name").textContent = currentStoreName();
  let rabbitsStarted = false;
  db.subscribeStoreConfig(STORE_ID, (cfg) => {
    careMaster = cfg.careItemsMaster;
    careIndex = new Map(careMaster.map((m, i) => [m.id, { name: m.name, pos: i }]));
    countableIds = countableIdSet(careMaster);
    holidays = cfg.holidays;
    busyPeriods = cfg.busyPeriods;
    if (rabbitsStarted) {
      render(); // 設定変更（ケア項目・定休日）を反映
      return;
    }
    rabbitsStarted = true;
    // 宿泊終了ぶんも購読し、過去の日付を開けばその記録が見られるようにする
    db.subscribeAllRabbits(STORE_ID, (list) => {
      rabbits = list;
      render(); // まず現状を描画
      ensureRecords(); // 予定の取り込みは裏で（書き込み後に再描画される）
    });
  });
});
