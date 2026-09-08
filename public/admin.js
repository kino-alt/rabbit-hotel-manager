// 設定画面（ケア項目・定休日・繁忙期）
// ログインは全員共通。この画面を開くときだけ「設定パスワード」を別途要求する。
// 保存ボタンはなし。追加・削除・並べ替え・編集はすべて自動保存する。

import { requireAuth, verifyManagerPassword, changeStaffPassword } from "./auth.js";
import * as db from "./db.js";
import { STORE_ID, currentStoreName } from "./firebase-config.js";
import { todayISO } from "./schedule.js";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const F = (id) => document.getElementById(id);

let items = []; // [{id, name, order}]
let holidays = { weekdays: [], dates: [] };
let busyPeriods = []; // [{ start, end }]

// ---- ケア項目 ----

function renderItems() {
  const ul = F("care-items");
  ul.innerHTML = "";
  items.forEach((it) => {
    const li = document.createElement("li");
    li._item = it; // ドロップ時に DOM 順から items を組み直すため

    const handle = document.createElement("span");
    handle.className = "ci-handle";
    handle.textContent = "⠿";
    handle.setAttribute("aria-label", "ドラッグして並べ替え");
    handle.title = "ドラッグして並べ替え";
    enableItemDrag(li, handle);

    const input = document.createElement("input");
    input.type = "text";
    input.value = it.name;
    input.className = "grow";
    input.addEventListener("input", () => {
      it.name = input.value;
    });
    input.addEventListener("change", () => saveItems()); // フォーカスを外したら保存

    const cnt = document.createElement("label");
    cnt.className = "ci-count";
    cnt.title = "件数を数える項目（プチブラシなど）にする";
    const ccb = document.createElement("input");
    ccb.type = "checkbox";
    ccb.checked = !!it.countable;
    ccb.addEventListener("change", () => {
      it.countable = ccb.checked;
      saveItems();
    });
    cnt.append(ccb, "回数");

    const del = iconBtn(
      "×",
      "削除",
      () => {
        items.splice(items.indexOf(it), 1);
        renderItems();
        saveItems();
      },
      "del",
    );

    li.append(handle, input, cnt, del);
    ul.appendChild(li);
  });
}

// ハンドルを掴んでいる間だけドラッグして並べ替え（アプリのスワイプ完了と同じ pointer 方式）
function enableItemDrag(li, handle) {
  let dragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    li.classList.add("dragging");
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    const ul = F("care-items");
    const y = e.clientY;
    // ポインタの高さより下にある最初の兄弟の前に差し込む（なければ末尾へ）
    const before = [...ul.children].find((c) => {
      if (c === li) return false;
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (before) {
      if (before !== li.nextElementSibling) ul.insertBefore(li, before);
    } else if (li !== ul.lastElementChild) {
      ul.appendChild(li);
    }
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    li.classList.remove("dragging");
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* 解放済みでも無視 */
    }

    const ul = F("care-items");
    const next = [...ul.children].map((c) => c._item).filter(Boolean);
    if (next.length === items.length) {
      const changed = next.some((it, idx) => it !== items[idx]);
      items = next;
      if (changed) saveItems();
    }
    renderItems();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function onAddItem() {
  const name = F("new-item").value.trim();
  if (!name) return;
  items.push({
    id: "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    order: items.length,
    countable: false,
  });
  F("new-item").value = "";
  renderItems();
  saveItems();
}

async function saveItems() {
  const cleaned = items
    .map((it, i) => ({ id: it.id, name: it.name.trim(), order: i, countable: !!it.countable }))
    .filter((it) => it.name);
  const dropped = cleaned.length !== items.length;
  try {
    await db.updateCareItemsMaster(STORE_ID, cleaned);
    items = cleaned;
    if (dropped) renderItems(); // 空欄の行が消えた場合は表示を合わせる
    info("items-message", "保存しました");
  } catch (e) {
    err("items-message", e);
  }
}

// ---- 定休日 ----

function renderHolidays() {
  const wrap = F("weekdays");
  wrap.innerHTML = "";
  WD.forEach((label, n) => {
    const on = holidays.weekdays.includes(n);
    const l = document.createElement("label");
    l.className = "daychip" + (on ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = on;
    cb.addEventListener("change", () => {
      if (cb.checked) holidays.weekdays.push(n);
      else holidays.weekdays = holidays.weekdays.filter((x) => x !== n);
      l.classList.toggle("on", cb.checked);
      saveHolidays();
    });
    l.append(cb, label);
    wrap.appendChild(l);
  });

  const ul = F("holiday-dates");
  ul.innerHTML = "";
  if (holidays.dates.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "個別の休業日はありません";
    ul.appendChild(li);
  }
  [...holidays.dates].sort().forEach((d) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "grow";
    span.textContent = d;
    li.append(
      span,
      mkBtn(
        "削除",
        () => {
          holidays.dates = holidays.dates.filter((x) => x !== d);
          renderHolidays();
          saveHolidays();
        },
        "danger",
      ),
    );
    ul.appendChild(li);
  });
}

function onAddHoliday() {
  const d = F("new-holiday").value;
  if (d && !holidays.dates.includes(d)) holidays.dates.push(d);
  F("new-holiday").value = "";
  renderHolidays();
  saveHolidays();
}

async function saveHolidays() {
  try {
    await db.updateHolidays(STORE_ID, {
      weekdays: [...new Set(holidays.weekdays)].sort(),
      dates: [...new Set(holidays.dates)].sort(),
    });
    info("holidays-message", "保存しました");
  } catch (e) {
    err("holidays-message", e);
  }
}

// ---- 繁忙期設定 ----
// busyPeriods: [{ start, end }]。期間中は全うさぎで写真「不要」。
// 終了日が過ぎたものは読み込み時に取り除く（下の pruneExpiredBusy）。

function pruneExpiredBusy(list) {
  const today = todayISO();
  return (list || []).filter((p) => p && p.end >= today);
}

function renderBusy() {
  const ul = F("busy-list");
  ul.innerHTML = "";
  if (busyPeriods.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "登録されている繁忙期はありません";
    ul.appendChild(li);
    return;
  }
  [...busyPeriods]
    .sort((a, b) => a.start.localeCompare(b.start))
    .forEach((p) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "grow";
      span.textContent = `${p.start} 〜 ${p.end}`;
      li.append(span);
      li.append(
        mkBtn(
          "削除",
          () => {
            busyPeriods = busyPeriods.filter((x) => !(x.start === p.start && x.end === p.end));
            renderBusy();
            saveBusy();
          },
          "danger",
        ),
      );
      ul.appendChild(li);
    });
}

function onAddBusy() {
  const start = F("busy-start").value;
  const end = F("busy-end").value;
  if (!start || !end) return err("busy-message", new Error("開始日と終了日を入力してください"));
  if (end < start) return err("busy-message", new Error("終了日が開始日より前です"));
  if (busyPeriods.some((p) => p.start === start && p.end === end)) {
    return err("busy-message", new Error("同じ期間がすでにあります"));
  }
  busyPeriods.push({ start, end });
  F("busy-start").value = "";
  F("busy-end").value = "";
  renderBusy();
  saveBusy();
}

async function saveBusy() {
  const cleaned = pruneExpiredBusy(busyPeriods)
    .map((p) => ({ start: p.start, end: p.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
  try {
    await db.updateBusyPeriods(STORE_ID, cleaned);
    busyPeriods = cleaned;
    info("busy-message", "保存しました");
  } catch (e) {
    err("busy-message", e);
  }
}

// ---- helpers ----
function mkBtn(text, fn, cls) {
  const b = document.createElement("button");
  b.className = "small" + (cls ? " " + cls : "");
  b.textContent = text;
  b.addEventListener("click", fn);
  return b;
}
// ケア項目の行内で使う枠なしの小ボタン（× 削除）
function iconBtn(text, label, fn, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ci-btn" + (cls ? " " + cls : "");
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.addEventListener("click", fn);
  return b;
}
function info(id, t) {
  const e = F(id);
  e.className = "msg info";
  e.textContent = t;
}
function err(id, e) {
  console.error(e);
  const el = F(id);
  el.className = "msg error";
  el.textContent = e.message || "失敗しました";
}

// ---- ログインパスワードの変更 ----
async function onChangePassword(e) {
  e.preventDefault();
  const cur = F("pw-current").value;
  const nw = F("pw-new").value;
  F("pw-message").textContent = "";
  try {
    await changeStaffPassword(cur, nw);
    F("pw-current").value = "";
    F("pw-new").value = "";
    info("pw-message", "変更しました。次回のログインから新しいパスワードを使ってください。");
  } catch (e2) {
    const code = e2 && e2.code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      err("pw-message", new Error("今のパスワードが違います"));
    } else if (code === "auth/weak-password") {
      err("pw-message", new Error("新しいパスワードが弱すぎます（6文字以上）"));
    } else if (code === "auth/too-many-requests") {
      err("pw-message", new Error("試行が多すぎます。しばらく待ってからやり直してください"));
    } else {
      err("pw-message", e2);
    }
  }
}

// ---- 起動 ----
F("add-item").addEventListener("click", onAddItem);
F("add-holiday").addEventListener("click", onAddHoliday);
F("busy-add").addEventListener("click", onAddBusy);
F("pw-form").addEventListener("submit", onChangePassword);

// 設定パスワードのゲート。1回通ればこのタブを閉じるまで再入力不要（sessionStorage）。
const GATE_KEY = "settingsUnlocked";

async function startSettings() {
  F("gate").hidden = true;
  F("settings").hidden = false;

  let loadedBusy;
  ({
    careItemsMaster: items,
    holidays,
    busyPeriods: loadedBusy,
  } = await db.getStoreConfig(STORE_ID));
  holidays.weekdays = holidays.weekdays || [];
  holidays.dates = holidays.dates || [];

  // 期間が過ぎた繁忙期はここで取り除いて保存する
  busyPeriods = pruneExpiredBusy(loadedBusy);
  if (busyPeriods.length !== loadedBusy.length) {
    try {
      await db.updateBusyPeriods(STORE_ID, busyPeriods);
    } catch (e) {
      console.error(e);
    }
  }

  renderItems();
  renderHolidays();
  renderBusy();
}

F("gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = F("gate-pw").value;
  F("gate-message").textContent = "";
  try {
    if (await verifyManagerPassword(pw)) {
      sessionStorage.setItem(GATE_KEY, "1");
      startSettings();
    } else {
      err("gate-message", new Error("パスワードが違います"));
    }
  } catch (e2) {
    err("gate-message", e2);
  }
});

requireAuth(() => {
  F("store-name").textContent = currentStoreName(); // どの店舗の設定かを表示
  if (sessionStorage.getItem(GATE_KEY) === "1") {
    startSettings();
  } else {
    F("gate-pw").focus();
  }
});
