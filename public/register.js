// うさぎ登録・編集画面（2段階・複数うさぎ対応）
//  STEP1: 飼い主・日程・送迎（共通） + うさぎカード（「＋ うさぎを追加」で下に増える）
//         各カードで うさぎ名・初回利用・ケア項目・備考 を入力
//  STEP2: 予定表（ケア/ラン/写真 × 滞在日）がメイン。ケア日・ラン回数はセルで調整。
//         ケア日が2日以上なら「項目ごとにどの日にやるか」を項目カードで表の下に出す。

import { requireAuth } from "./auth.js";
import * as db from "./db.js";
import * as dr from "./dailyRecord.js";
import { STORE_ID } from "./firebase-config.js";
import {
  eachDate,
  dayWd,
  isHoliday,
  calculatePhotoNeeded,
  todayISO,
  countableIdSet,
} from "./schedule.js";
import { buildEntry, entryToSchedules, careScheduleShape, careUnitsOnDay } from "./scheduleGrid.js";
import { esc } from "./esc.js";

const F = (id) => document.getElementById(id);
const form = F("rabbit-form");
const message = F("message");
const schedMsg = F("schedule-message");
const editId = new URLSearchParams(location.search).get("id");

let careMaster = [];
let countableIds = new Set();
let holidays = { weekdays: [], dates: [] };
let busyPeriods = [];
let groupId = null;
let loadedRabbit = null; // 常に最新のサーバ状態（購読で更新）
let loaded = false; // 店舗設定（ケア項目など）の読み込み完了フラグ
let baseSchedules = null; // STEP2 に入った時点の予定（保存時の差分マージの基準）
let justSavedUntil = 0; // 自分の保存のエコーで「他端末で更新」通知を出さない猶予
let gridDirty = false; // STEP2 グリッドを利用者が触ったか（他端末の更新の扱いを変える）

// STEP2 の作業状態
let stayDates = [];
// entries[i] = { name, card, normalIds:[], brushIds:[], careDays:[day],
//                itemDay:{normalId:day}, brushByDay:{day:{brushId:n}}, runByDay:{day:n} }
let entries = [];

// ---- helpers ----
function showError(el, t) {
  el.className = "msg error";
  el.textContent = t;
}
function showInfo(el, t) {
  el.className = "msg info";
  el.textContent = t;
}
function newGroupId() {
  return "g_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

// 新規登録の既定ケア項目：「爪切り」だけ（無ければ全項目）
function defaultCareIds() {
  const nail = careMaster.filter((m) => m.name === "爪切り").map((m) => m.id);
  return nail.length ? nail : careMaster.map((m) => m.id);
}

// ---- STEP1：共通項目 ----
function readShared() {
  return {
    ownerLastName: F("ownerLastName").value.trim(),
    checkInDate: F("checkInDate").value,
    checkOutDate: F("checkOutDate").value,
    transportDropoff: F("transportDropoff").checked,
    transportPickup: F("transportPickup").checked,
  };
}

// ---- STEP1：うさぎカード ----
// counts: 回数式項目の初期回数 { itemId: n }（編集時に使用）
function renderCareChecks(container, checkedIds, counts) {
  container.innerHTML = "";
  if (!loaded) {
    container.innerHTML = "<span class='muted' style='font-size:13px'>読み込み中…</span>";
    return;
  }
  if (careMaster.length === 0) {
    container.innerHTML =
      "<span class='muted' style='font-size:13px'>ケア項目が未登録です（設定画面で追加してください）</span>";
    return;
  }
  careMaster.forEach((m) => {
    const pick = document.createElement("div");
    pick.className = "care-pick";

    const l = document.createElement("label");
    l.className = "inline";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = m.id;
    cb.checked = checkedIds.includes(m.id);
    l.append(cb, " " + m.name);
    pick.appendChild(l);

    if (countableIds.has(m.id)) {
      // 回数式（プチブラシ等）：チェックしたときだけ、小さな回数プルダウンを表示
      const sel = document.createElement("select");
      sel.className = "mini-sel brush-n";
      sel.dataset.id = m.id;
      for (let i = 1; i <= 9; i++) {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = "×" + i;
        sel.appendChild(o);
      }
      sel.value = String((counts && counts[m.id]) || 1);
      const sync = () => {
        sel.hidden = !cb.checked;
      };
      cb.addEventListener("change", sync);
      pick.appendChild(sel);
      sync();
    }
    container.appendChild(pick);
  });
}

function refreshCardChrome() {
  // 削除は「＋ うさぎを追加」で増やした2匹め以降だけ。
  // カード見出しは「入力済みの名前」or「うさぎ①②…」。何匹めを入力中か分かるように。
  const cards = [...F("rabbit-cards").querySelectorAll("[data-card]")];
  const many = cards.length > 1;
  cards.forEach((c, i) => {
    c.querySelector("[data-remove]").hidden = i === 0;
    const name = c.querySelector(".r-name").value.trim();
    const num = ["①", "②", "③", "④", "⑤", "⑥"][i] || `${i + 1}`;
    c.querySelector("[data-title]").textContent = name || (many ? `うさぎ ${num}` : "うさぎ");
  });
}

function addCard(data) {
  const card = document.createElement("div");
  card.className = "card-block";
  card.dataset.card = "1";
  card.innerHTML = `
    <div class="card-block-head">
      <span class="card-block-title" data-title>うさぎ</span>
      <button type="button" class="small danger" data-remove hidden>このうさぎを削除</button>
    </div>
    <div class="stack">
      <label class="field"><span>名前 <b class="req">必須</b></span>
        <input type="text" class="r-name" required placeholder="例：モカ" /></label>
      <div class="field">
        <span>初回利用</span>
        <label class="inline"><input type="checkbox" class="r-first" /> 今回が初めての利用</label>
      </div>
      <div class="field"><span>ケア項目<span class="hint">日程はあとで調整可</span></span>
        <div class="r-care care-box"></div>
      </div>
      <label class="field"><span>備考（任意）</span>
        <textarea class="r-note" rows="2" placeholder="連絡事項・注意点があれば"></textarea></label>
    </div>`;
  F("rabbit-cards").appendChild(card);

  card.querySelector(".r-name").value = (data && data.rabbitName) || "";
  card.querySelector(".r-first").checked = !!(data && data.isFirstTime);
  card.querySelector(".r-note").value = (data && data.note) || "";
  renderCareChecks(
    card.querySelector(".r-care"),
    (data && data.careIds) || defaultCareIds(),
    data && data.brushCounts,
  );

  card.querySelector(".r-name").addEventListener("input", refreshCardChrome);
  card.querySelector("[data-remove]").addEventListener("click", () => {
    card.remove();
    refreshCardChrome();
  });
  refreshCardChrome();
  return card;
}

function readCards() {
  return [...F("rabbit-cards").querySelectorAll("[data-card]")].map((c) => {
    const careIds = [...c.querySelectorAll(".r-care input[type=checkbox]:checked")].map(
      (x) => x.value,
    );
    const brushCounts = {};
    c.querySelectorAll(".r-care .brush-n").forEach((sel) => {
      if (careIds.includes(sel.dataset.id))
        brushCounts[sel.dataset.id] = Math.max(1, +sel.value || 1);
    });
    return {
      rabbitName: c.querySelector(".r-name").value.trim(),
      isFirstTime: c.querySelector(".r-first").checked,
      note: c.querySelector(".r-note").value.trim(),
      careIds,
      brushCounts,
    };
  });
}

// ---- STEP 遷移 ----
// STEP2 の作業データ（entry）の組み立て・直列化は scheduleGrid.js に分離。

// 未入力の必須項目を1つ返す（無ければ null）
function firstMissing() {
  if (!F("checkInDate").value) return { el: F("checkInDate"), label: "お預かり日" };
  if (!F("checkOutDate").value) return { el: F("checkOutDate"), label: "お迎え日" };
  if (!F("ownerLastName").value.trim()) return { el: F("ownerLastName"), label: "飼い主の苗字" };
  const cardEls = [...F("rabbit-cards").querySelectorAll("[data-card]")];
  for (let i = 0; i < cardEls.length; i++) {
    const nm = cardEls[i].querySelector(".r-name");
    if (!nm.value.trim()) {
      return { el: nm, label: cardEls.length > 1 ? `うさぎ ${i + 1} の名前` : "うさぎの名前" };
    }
  }
  return null;
}

function goStep2() {
  message.textContent = "";

  const miss = firstMissing();
  if (miss) {
    showError(message, `「${miss.label}」が未入力です`);
    miss.el.focus();
    miss.el.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  const shared = readShared();
  const cards = readCards();

  if (shared.checkOutDate < shared.checkInDate) {
    return showError(message, "お迎え日がお預かり日より前です");
  }

  const newDates = eachDate(shared.checkInDate, shared.checkOutDate);
  const keepGrid = newDates.join(",") === stayDates.join(",") && entries.length === cards.length;
  stayDates = newDates;

  rebuildGridEntries(keepGrid);
  gridDirty = false;

  form.hidden = true;
  F("schedule-step").hidden = false;
  F("edit-only").hidden = !editId;
  F("schedule-step").scrollIntoView({ block: "start", behavior: "smooth" });
}

// STEP2 の entries を（現在の STEP1 入力 ＋ 最新の loadedRabbit から）組み立て直し、再描画する。
//   usePrev=true … 直前の作業 entries を引き継ぐ（同じ日程で STEP2 を出し直したとき）
// 保存時の差分マージ基準（baseSchedules）も、いまサーバにある予定に合わせ直す。
function rebuildGridEntries(usePrev) {
  const shared = readShared();
  const cards = readCards();
  const gridCtx = { countableIds, holidays, prevRabbit: editId ? loadedRabbit : null };
  const prevEntries = entries;
  entries = cards.map((c, i) => buildEntry(shared, c, usePrev ? prevEntries[i] : null, gridCtx));

  if (editId && loadedRabbit) {
    baseSchedules = {
      careSchedule: loadedRabbit.careSchedule || {},
      careCounts: loadedRabbit.careCounts || {},
      runSchedule: loadedRabbit.runSchedule || {},
    };
  }
  F("remote-change").hidden = true;
  renderStep2();
}

function backToStep1() {
  F("schedule-step").hidden = true;
  form.hidden = false;
}

// ---- STEP2：グリッド ----
// entry の集計・直列化ヘルパー（careUnitsOnDay / careScheduleShape /
// entryToSchedules など）は scheduleGrid.js を参照。

function careItemName(id) {
  const m = careMaster.find((x) => x.id === id);
  return m ? m.name : id;
}

// グリッド操作。利用者が実際に触ったら touchGrid()（gridDirty を立てて再描画）。
function touchGrid() {
  gridDirty = true;
  renderStep2();
}
function addCareDay(ei, d) {
  const e = entries[ei];
  if (!e.careDays.includes(d)) {
    e.careDays.push(d);
    e.careDays.sort();
  }
  touchGrid();
}
function removeCareDay(ei, d) {
  const e = entries[ei];
  if (careUnitsOnDay(e, d) > 0) return; // 中身があれば消さない
  e.careDays = e.careDays.filter((x) => x !== d);
  delete e.brushByDay[d];
  touchGrid();
}
function moveItem(ei, id, day) {
  entries[ei].itemDay[id] = day;
  touchGrid();
}
// 回数式項目の回数を「日ごと」に移す。全体数は維持（片方 +1 なら別の日が −1）。
function bumpBrush(ei, day, id, dir) {
  const e = entries[ei];
  const cols = e.careDays.filter((d) => !isHoliday(d, holidays));
  const get = (d) => (e.brushByDay[d] || {})[id] || 0;
  const set = (d, n) => {
    const bd = { ...(e.brushByDay[d] || {}) };
    if (n <= 0) delete bd[id];
    else bd[id] = n;
    if (Object.keys(bd).length) e.brushByDay[d] = bd;
    else delete e.brushByDay[d];
  };

  if (dir > 0) {
    // day を +1、他の日から 1 もらう（一番多い日から）
    const donor = cols.filter((d) => d !== day && get(d) > 0).sort((a, b) => get(b) - get(a))[0];
    if (!donor) return;
    set(day, get(day) + 1);
    set(donor, get(donor) - 1);
  } else {
    if (get(day) <= 0) return;
    // day を −1、他の日へ 1 渡す（一番少ない日へ）
    const receiver = cols.filter((d) => d !== day).sort((a, b) => get(a) - get(b))[0];
    if (!receiver) return;
    set(day, get(day) - 1);
    set(receiver, get(receiver) + 1);
  }
  touchGrid();
}
function setRun(ei, day, n) {
  const e = entries[ei];
  if (n <= 0) delete e.runByDay[day];
  else e.runByDay[day] = n;
  touchGrid();
}
function runOptions(sel) {
  let o = "";
  for (let i = 0; i <= 9; i++)
    o += `<option value="${i}"${i === sel ? " selected" : ""}>${i === 0 ? "−" : i}</option>`;
  return o;
}

// ---- STEP2 メイン：予定表（ケア/ラン/写真 × 滞在日） ----
function renderStep2() {
  const wrap = F("schedule-table");
  const today = todayISO();
  const cols = stayDates.map((d) => {
    const { day, wd } = dayWd(d);
    return { d, day, wd, hol: isHoliday(d, holidays), today: d === today };
  });
  const headRow =
    "<tr><th class='kind'></th>" +
    cols
      .map(
        (c) =>
          `<th class="dcol${c.hol ? " col-holiday" : ""}${c.today ? " today" : ""}">${c.day}<span class="wd">${c.wd}</span></th>`,
      )
      .join("") +
    "</tr>";

  let html = "";
  entries.forEach((e, ei) => {
    const shape = careScheduleShape(e);

    html += `<div class="sched-name">${esc(e.name)}</div>`;
    html += `<div class="scroll-x"><table class="overview compact sched"><thead>${headRow}</thead><tbody>`;

    // ケア行
    html += `<tr><td class="kind">ケア</td>`;
    html += cols
      .map((c) => {
        const inCare = e.careDays.includes(c.d);
        const units = inCare ? careUnitsOnDay(e, c.d) : 0;
        if (c.hol) return `<td class="dcol cell-off">${units || ""}</td>`;
        if (!inCare)
          return `<td class="dcol cell-care" data-addday data-e="${ei}" data-d="${c.d}">＋</td>`;
        if (units === 0)
          return `<td class="dcol cell-care cell-empty" data-rmday data-e="${ei}" data-d="${c.d}" title="タップで取り消し">–</td>`;
        return `<td class="dcol cell-care on">✓${units > 1 ? units : ""}</td>`;
      })
      .join("");
    html += "</tr>";

    // ラン行
    html += `<tr><td class="kind">ラン</td>`;
    html += cols
      .map((c) => {
        const n = e.runByDay[c.d] || 0;
        if (c.hol) return `<td class="dcol cell-off">${n || ""}</td>`;
        return `<td class="dcol${n > 0 ? " cell-run on" : ""}"><select class="run-sel" data-e="${ei}" data-d="${c.d}">${runOptions(n)}</select></td>`;
      })
      .join("");
    html += "</tr>";

    // 写真行（自動判定・読み取り専用）
    html += `<tr><td class="kind">写真</td>`;
    html += cols
      .map((c) => {
        const need = calculatePhotoNeeded(c.d, shape, e.runByDay, holidays, busyPeriods);
        return `<td class="dcol cell-photo">${need ? "〇" : ""}</td>`;
      })
      .join("");
    html += "</tr>";

    html += "</tbody></table></div>";
  });
  wrap.innerHTML = html;

  wrap
    .querySelectorAll("[data-addday]")
    .forEach((el) => el.addEventListener("click", () => addCareDay(+el.dataset.e, el.dataset.d)));
  wrap
    .querySelectorAll("[data-rmday]")
    .forEach((el) =>
      el.addEventListener("click", () => removeCareDay(+el.dataset.e, el.dataset.d)),
    );
  wrap
    .querySelectorAll("select.run-sel")
    .forEach((el) =>
      el.addEventListener("change", () => setRun(+el.dataset.e, el.dataset.d, +el.value)),
    );

  renderCareBreakdown();
}

// ケア予定日が2日以上のときだけ、本体の表の“補足”として #care-breakdown に出す。
//  通常項目 … 日付チップを1つ選ぶ
//  回数式項目 … 日付ごとに1行の「− n +」。合計は固定で、片方を増やすと別の日が減る
function renderCareBreakdown() {
  const wrap = F("care-breakdown");
  const blocks = [];

  entries.forEach((e, ei) => {
    const days = e.careDays.filter((d) => !isHoliday(d, holidays)).sort();
    if (days.length < 2) return;

    let h = "";
    if (entries.length > 1) h += `<div class="bd-rabbit">${esc(e.name)}</div>`;

    e.normalIds.forEach((id) => {
      const chips = days
        .map((d) => {
          const { day, wd } = dayWd(d);
          const on = e.itemDay[id] === d;
          return (
            `<label class="daychip${on ? " on" : ""}">` +
            `<input type="radio" name="bd-${ei}-${esc(id)}" data-move data-e="${ei}" data-id="${esc(id)}" data-d="${d}"${on ? " checked" : ""}>` +
            `${day}(${wd})</label>`
          );
        })
        .join("");
      h += `<div class="bd-item"><div class="bd-name">${esc(careItemName(id))}</div><div class="bd-days">${chips}</div></div>`;
    });

    e.brushIds.forEach((id) => {
      const totalN = days.reduce((n, d) => n + ((e.brushByDay[d] || {})[id] || 0), 0);
      const pairs = days
        .map((d) => {
          const { day, wd } = dayWd(d);
          const n = (e.brushByDay[d] || {})[id] || 0;
          return (
            `<span class="bd-cpair"><span class="bd-cd">${day}(${wd})</span>` +
            `<span class="runctl sm">` +
            `<button type="button" data-bdec data-e="${ei}" data-d="${d}" data-id="${esc(id)}">−</button>` +
            `<b>${n}</b>` +
            `<button type="button" data-binc data-e="${ei}" data-d="${d}" data-id="${esc(id)}">＋</button>` +
            `</span></span>`
          );
        })
        .join("");
      h += `<div class="bd-item"><div class="bd-name">${esc(careItemName(id))}<span class="muted"> 全${totalN}回</span></div><div class="bd-cline">${pairs}</div></div>`;
    });

    blocks.push(h);
  });

  if (blocks.length === 0) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML =
    '<div class="bd-head">補足：ケアが複数日にあるとき、どの日にやるか</div>' + blocks.join("");

  wrap.querySelectorAll("input[data-move]").forEach((r) =>
    r.addEventListener("change", () => {
      if (r.checked) moveItem(+r.dataset.e, r.dataset.id, r.dataset.d);
    }),
  );
  wrap
    .querySelectorAll("button[data-binc]")
    .forEach((b) =>
      b.addEventListener("click", () => bumpBrush(+b.dataset.e, b.dataset.d, b.dataset.id, +1)),
    );
  wrap
    .querySelectorAll("button[data-bdec]")
    .forEach((b) =>
      b.addEventListener("click", () => bumpBrush(+b.dataset.e, b.dataset.d, b.dataset.id, -1)),
    );
}

// ---- 保存 ----
async function onSave() {
  schedMsg.textContent = "";
  F("save-btn").disabled = true;
  try {
    const shared = readShared();

    if (editId) {
      const e = entries[0];
      const data = {
        ...shared,
        rabbitName: e.card.rabbitName,
        isFirstTime: e.card.isFirstTime,
        note: e.card.note,
      };
      const next = entryToSchedules(e);
      justSavedUntil = Date.now() + 8000; // これから来る自分の書き込み群のエコーを無視
      await db.saveRabbit(STORE_ID, { id: editId, ...data });
      const changedPaths = await db.writeSchedulesMerge(
        STORE_ID,
        editId,
        baseSchedules || {},
        next,
      );
      // 楽観更新（購読でもすぐ上書きされる）。次の保存の基準もここに合わせる
      loadedRabbit = { ...loadedRabbit, ...data, ...next };
      baseSchedules = {
        careSchedule: next.careSchedule,
        careCounts: next.careCounts,
        runSchedule: next.runSchedule,
      };
      gridDirty = false; // 保存済み ＝ グリッドは基準と一致
      F("remote-change").hidden = true;

      // 予定を変えた日に既存の当日記録があれば、新しい予定に合わせる
      // （ケア/ラン画面を開かなくても整合。過去記録画面のズレも消える）
      const affectedDates = new Set(changedPaths.map((p) => p.split(".")[1]));
      for (const d of affectedDates) {
        try {
          await dr.reconcileDailyRecord(STORE_ID, loadedRabbit, d, countableIds);
        } catch (err) {
          console.error("reconcileDailyRecord", err);
        }
      }

      showInfo(schedMsg, "保存しました");
      return;
    }

    if (!groupId) groupId = newGroupId();
    for (const e of entries) {
      await db.saveRabbit(STORE_ID, {
        ...shared,
        rabbitName: e.card.rabbitName,
        isFirstTime: e.card.isFirstTime,
        note: e.card.note,
        groupId,
        ...entryToSchedules(e),
      });
    }
    showDone(shared, entries);
  } catch (err) {
    console.error(err);
    showError(schedMsg, err.message || "保存に失敗しました");
  } finally {
    F("save-btn").disabled = false;
  }
}

function showDone(shared, list) {
  F("schedule-step").hidden = true;
  F("done-actions").hidden = false;
  const names = list.map((e) => e.card.rabbitName).join("、");
  F("done-message").textContent =
    `${shared.ownerLastName} さんの ${list.length}匹（${names}）を登録しました。`;
}

function onAddAnother() {
  // 飼い主・日程・グループIDは引き継ぎ、うさぎカードを1枚だけの空状態に戻す
  F("rabbit-cards").innerHTML = "";
  addCard();
  stayDates = [];
  entries = [];
  F("done-actions").hidden = true;
  form.hidden = false;
  message.textContent = "";
  F("rabbit-cards").querySelector(".r-name").focus();
}

async function onHideRabbit() {
  try {
    await db.hideRabbit(STORE_ID, editId);
    location.replace("main.html");
  } catch (err) {
    console.error(err);
    showError(schedMsg, err.message || "失敗しました");
  }
}

// 編集中に他端末でこのうさぎが更新されたとき（購読コールバックから）
function onRemoteRabbitChange() {
  if (Date.now() <= justSavedUntil) return; // 自分の保存のエコー
  if (F("schedule-step").hidden) return; // STEP1 表示中：goStep2 で最新から作り直される
  if (!gridDirty) {
    rebuildGridEntries(false); // 未編集：静かに最新へ（作業ロスなし）
    return;
  }
  F("remote-change").hidden = false; // 編集中：通知＋「作り直す」ボタン
}

// ---- 起動 ----
form.addEventListener("submit", (e) => {
  e.preventDefault();
  goStep2();
});
F("add-rabbit-card").addEventListener("click", () => addCard());
F("back-btn").addEventListener("click", backToStep1);
F("save-btn").addEventListener("click", onSave);
F("add-another").addEventListener("click", onAddAnother);
F("hide-btn").addEventListener("click", onHideRabbit);
F("remote-reload").addEventListener("click", () => {
  rebuildGridEntries(false);
  gridDirty = false;
});

// 新規登録は1羽めのカードを最初から表示し、お預かり日を今日にしておく
if (!editId) {
  F("checkInDate").value = todayISO();
  addCard();
}

requireAuth(async () => {
  ({ careItemsMaster: careMaster, holidays, busyPeriods } = await db.getStoreConfig(STORE_ID));
  countableIds = countableIdSet(careMaster);
  loaded = true;

  if (editId) {
    F("title").textContent = "うさぎ編集";
    F("next-btn").textContent = "次へ（予定の編集）";
    F("save-btn").textContent = "保存";
    F("add-rabbit-card").hidden = true;

    // 1回きりの getDoc ではなく購読。編集中に他端末で変わっても
    // loadedRabbit は最新に保たれ、保存は writeSchedulesMerge で差分マージされる。
    let firstLoad = true;
    db.subscribeRabbit(STORE_ID, editId, (rabbit) => {
      if (!rabbit) {
        if (firstLoad) showError(message, "うさぎが見つかりません");
        return;
      }
      loadedRabbit = rabbit;
      if (!firstLoad) {
        onRemoteRabbitChange();
        return;
      }
      firstLoad = false;
      groupId = rabbit.groupId || null;

      F("ownerLastName").value = rabbit.ownerLastName || "";
      F("checkInDate").value = rabbit.checkInDate || "";
      F("checkOutDate").value = rabbit.checkOutDate || "";
      F("transportDropoff").checked = !!rabbit.transportDropoff;
      F("transportPickup").checked = !!rabbit.transportPickup;

      const used = new Set();
      Object.values(rabbit.careSchedule || {}).forEach((arr) =>
        (arr || []).forEach((id) => used.add(id)),
      );
      // 回数式項目の初期回数：careCounts の各日を合計
      const brushCounts = {};
      Object.values(rabbit.careCounts || {}).forEach((day) => {
        Object.entries(day || {}).forEach(([id, n]) => {
          brushCounts[id] = (brushCounts[id] || 0) + n;
        });
      });
      addCard({
        rabbitName: rabbit.rabbitName,
        isFirstTime: rabbit.isFirstTime,
        note: rabbit.note,
        careIds: used.size ? [...used] : careMaster.map((m) => m.id),
        brushCounts,
      });
    });
  } else {
    // すでに表示済みの1羽めカードのケア項目を、読み込んだ内容で埋め直す
    F("rabbit-cards")
      .querySelectorAll("[data-card]")
      .forEach((c) => renderCareChecks(c.querySelector(".r-care"), defaultCareIds()));
  }
});
