// ラン担当画面

import { requireAuth } from "./auth.js";
import * as db from "./db.js";
import * as dr from "./dailyRecord.js";
import { STORE_ID, currentStoreName } from "./firebase-config.js";
import {
  todayISO,
  addDays,
  formatJP,
  countableIdSet,
  calculateDefaultCareDate,
  calculatePhotoNeeded,
  careOnDate,
  runOnDate,
  isStayEnded,
} from "./schedule.js";
import { rabbitScheduleTableHTML } from "./overviewView.js";
import { notifyWriteError } from "./toast.js";
import { enableSwipeComplete } from "./swipe.js";
import { esc } from "./esc.js";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const dayLabel = document.getElementById("day-label");

let currentDate = todayISO();
let rabbits = [];
let careMaster = [];
let careNames = new Map(); // itemId -> name（find の線形探索を避ける）
let holidays = { weekdays: [], dates: [] };
let busyPeriods = [];
let countableIds = new Set();

function itemName(id) {
  return careNames.get(id) || id;
}

// その日にケアがあるか＆状況（ケア完了ボタンが押されたか / LINE送信済みか / 実施した項目名）
function careForDay(r, date) {
  const c = careOnDate(r, date, countableIds);
  if (!c.exists) return null;

  const doneNames = [];
  if (c.record) {
    for (const id of c.recPlain) if (c.record.items[id] === true) doneNames.push(itemName(id));
    for (const row of c.recCount) {
      const dd = Math.min(row.done, row.need);
      if (dd > 0) doneNames.push(`${itemName(row.id)}×${dd}`);
    }
  }
  return { doneNames, careDone: c.done, lineSent: c.lineSent };
}
const expanded = new Set();
const ensured = new Set();
let showSent = false; // すべて送信済みのうさぎも一覧に出すか

function activeOnDate(r, date) {
  return r.checkInDate <= date && date <= r.checkOutDate;
}

// その日に写真が必要か（記録が無ければ予定・自動判定から）
function photoNeededToday(r, date) {
  const rec = r.dailyRecords && r.dailyRecords[date];
  if (rec && rec.photo) return !!rec.photo.needed;
  const ps = r.photoSchedule && r.photoSchedule[date];
  if (ps === "needed") return true;
  if (ps === "not_needed") return false;
  return calculatePhotoNeeded(date, r.careSchedule, r.runSchedule, holidays, busyPeriods);
}

// その日にラン担当が触る用事があるか
function hasTask(r, date) {
  return hasRun(r, date) || !!careForDay(r, date) || photoNeededToday(r, date);
}

// ラン・ケア・写真の LINE送信がすべて終わっているか（＝一覧から隠す対象）
function isAllSent(r) {
  const rec = r.dailyRecords && r.dailyRecords[currentDate];
  const { need: needed, sent } = runOnDate(r, currentDate);
  if (needed > 0 && sent < needed) return false;
  const ci = careForDay(r, currentDate);
  if (ci && !ci.lineSent) return false;
  // ラン・ケアがある日は写真は対象外
  if (
    needed === 0 &&
    !ci &&
    photoNeededToday(r, currentDate) &&
    !(rec && rec.photo && rec.photo.sent)
  )
    return false;
  return true;
}

// 予定（runSchedule）を正とし、登録画面でラン回数を増減しても反映されるようにする。
// ただし当日すでに実施／送信した回数は下回らせない（判定は schedule.runOnDate）。
function hasRun(r, date) {
  return runOnDate(r, date).exists;
}

async function ensureRecords() {
  for (const r of rabbits) {
    if (isStayEnded(r)) continue; // 宿泊終了ぶんは閲覧のみ。新しい記録は作らない
    if (!activeOnDate(r, currentDate) || !hasTask(r, currentDate)) continue;
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
      console.error(err);
      ensured.delete(key);
    }
  }
}

function sep(text) {
  const d = document.createElement("div");
  d.className = "list-sep";
  d.textContent = text;
  return d;
}

// 用事の種類：0=ラン(ラン有り。ケア/写真を兼ねることもある) / 1=ケアのみ / 2=写真のみ
function taskRank(r) {
  if (hasRun(r, currentDate)) return 0;
  if (careForDay(r, currentDate)) return 1;
  return 2;
}
const TASK_LABELS = ["ラン", "ケアのみ", "写真のみ"];

// list を「ラン」「ケアのみ」「写真のみ」の順に分け、各かたまりを飼い主ごとに描画する。
// 見出し（list-sep）は、その分類にうさぎがいて、かつ複数の分類にまたがるときだけ出す。
function renderByTaskType(list, sentView) {
  const buckets = [[], [], []];
  for (const r of list) buckets[taskRank(r)].push(r);

  const shown = buckets.filter((b) => b.length > 0);
  const withHeaders = shown.length > 1;

  buckets.forEach((members, rank) => {
    if (members.length === 0) return;
    if (withHeaders) listEl.appendChild(sep(TASK_LABELS[rank]));
    renderOwnerGroups(members, sentView);
  });
}

function render() {
  dayLabel.textContent = formatJP(currentDate) + (currentDate === todayISO() ? "（今日）" : "");
  listEl.innerHTML = "";

  // まず「ラン／ケアのみ／写真のみ」で分け、その中を飼い主ごとにまとめる（LINEはまとめて1通のため）。
  // ここでは飼い主名で並べておき、分類・飼い主まとめは renderByTaskType / renderOwnerGroups で行う。
  const active = rabbits
    .filter((r) => activeOnDate(r, currentDate) && hasTask(r, currentDate))
    .sort(
      (a, b) =>
        (a.ownerLastName || "").localeCompare(b.ownerLastName || "", "ja") ||
        taskRank(a) - taskRank(b) ||
        (a.rabbitName || "").localeCompare(b.rabbitName || "", "ja"),
    );

  const pending = active.filter((r) => !isAllSent(r));
  const sentList = active.filter(isAllSent);

  emptyEl.hidden = pending.length > 0 || (showSent && sentList.length > 0);

  renderByTaskType(pending, false);

  if (sentList.length > 0) {
    const t = document.createElement("button");
    t.className = "ghost small list-toggle";
    t.textContent = showSent ? "送信済み分を隠す" : `送信済み分を表示（${sentList.length}）`;
    t.addEventListener("click", () => {
      showSent = !showSent;
      render();
    });
    listEl.appendChild(t);

    if (showSent) {
      listEl.appendChild(sep("送信済み"));
      renderByTaskType(sentList, true);
    }
  }
}

// list を飼い主ごとに区切って描画。2匹以上の飼い主には見出し帯を付け、
// その飼い主の「今日ぶん」の送信進捗（x/N）を出して送り漏れを防ぐ。
function renderOwnerGroups(list, sentView) {
  for (let i = 0; i < list.length;) {
    const owner = list[i].ownerLastName || "";
    let j = i;
    while (j < list.length && (list[j].ownerLastName || "") === owner) j++;
    const members = list.slice(i, j);
    i = j;

    if (members.length < 2) {
      listEl.appendChild(renderCard(members[0], sentView));
      continue;
    }

    const box = document.createElement("div");
    box.className = "owner-grp";

    const h = document.createElement("div");
    h.className = "owner-grp-head";
    h.textContent = `${owner} さん`;
    box.appendChild(h);

    members.forEach((r) => box.appendChild(renderCard(r, sentView)));
    listEl.appendChild(box);
  }
}

// 「初 / 明日送迎 / 備考」の注記行。無ければ null。
function buildNote(r) {
  const parts = [];
  if (r.isFirstTime) parts.push("初");
  if (
    r.transportPickup &&
    r.checkOutDate &&
    currentDate === calculateDefaultCareDate(r.checkOutDate, holidays)
  ) {
    parts.push("明日送迎");
  }
  if (r.note) parts.push("備考：" + r.note);
  if (!parts.length) return null;
  const n = document.createElement("div");
  n.className = "note";
  n.textContent = parts.join(" / ");
  return n;
}

// ラン担当・全カード共通のヘッダー。並びは常に
//   [うさぎ名] [状況] [?] [▼/▲（展開カードのみ）]
// 「状況」は種別＋状態を必ず同じ位置・同じ体裁で示す（見る場所を固定するため）。
// 追加のコントロール（撮影チェック・取り消しボタン）は呼び出し側で末尾に append する。
function cardHead(r, status, opts = {}) {
  const { sent = false, expandable = false, open = false } = opts;
  const head = document.createElement(expandable ? "button" : "div");
  if (expandable) head.type = "button";
  head.className = "head";

  const name = spanEl("name grow", `${r.ownerLastName || ""} ${r.rabbitName || ""}`);
  // status は文字列でも DOM ノードでもよい（写真カードは撮影チェックをここに入れる）
  const st =
    status instanceof Node ? status : spanEl("count" + (sent ? " count-sent" : ""), status || "");

  const help = document.createElement("span");
  help.className = "help";
  help.setAttribute("role", "button");
  help.setAttribute("aria-label", "この子の予定を見る");
  help.textContent = "?";
  help.addEventListener("click", (e) => {
    e.stopPropagation();
    openSchedule(r);
  });

  head.append(name, st, help);
  if (expandable) head.append(spanEl("tri", open ? "▲" : "▼"));
  return head;
}

// スワイプできる範囲の共通スキン。地色・左の緑ラインは style.css の .swipe-fg 側。
// whole=false（行単位）のときだけ角丸＋内側余白を足す。
function swipeSkin(fg, whole) {
  if (!whole) fg.classList.add("swipe-fg-row");
}

// カード全体を左スワイプで onSwipe（ケア画面のカードスワイプと同じ）。extra はヘッダー下に入れる要素。
function swipeWholeCard(card, head, extra, onSwipe) {
  card.className = "rabbit swipeable";
  const bg = document.createElement("div");
  bg.className = "swipe-bg";
  bg.textContent = "✓ LINE送信済み";
  const fg = document.createElement("div");
  fg.className = "swipe-fg";
  swipeSkin(fg, true);
  fg.appendChild(head);
  for (const el of extra) if (el) fg.appendChild(el);
  const hint = swipeNote("スワイプで完了");
  hint.classList.add("swipe-note-pad");
  fg.appendChild(hint);
  card.append(bg, fg);
  enableSwipeComplete(card, fg, onSwipe);
}

function detailLine(text) {
  const d = document.createElement("div");
  d.className = "muted detail-line";
  d.textContent = text;
  return d;
}

function spanEl(cls, text) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

// inner を左スワイプで onComplete。左の緑ライン＋薄い下地で「動く範囲」を示す（全スワイプ共通）。
function wrapSwipe(inner, onComplete) {
  const wrap = document.createElement("div");
  wrap.className = "swipeable swipe-wrap";
  const bg = document.createElement("div");
  bg.className = "swipe-bg";
  bg.textContent = "✓ LINE送信済み";
  const fg = document.createElement("div");
  fg.className = "swipe-fg";
  swipeSkin(fg, false);
  fg.appendChild(inner);
  wrap.append(bg, fg);
  enableSwipeComplete(wrap, fg, onComplete);
  return wrap;
}

// 写真のみの子：展開せず、他カードの「状況」と同じ位置に撮影チェックを置く。
// 撮影済みならパネルごと左スワイプで送信。
function renderPhotoOnlyCard(r, sentView) {
  const rec = (r.dailyRecords && r.dailyRecords[currentDate]) || null;
  const p = (rec && rec.photo) || {};

  const card = document.createElement("div");
  card.className = "rabbit";
  const note = buildNote(r);

  if (sentView || p.sent) {
    const head = cardHead(r, "写真 送信済み", { sent: true });
    card.appendChild(head);
    if (note) card.appendChild(note);
    card.appendChild(rowEnd(undoButton(() => onPhotoCheck(r, "sent", false))));
    return card;
  }

  // 撮影チェックを「状況」スロット（名前の右・? の左）に入れる＝見る位置を他と揃える
  const box = document.createElement("label");
  box.className = "count photo-check";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!p.taken;
  cb.addEventListener("click", (e) => e.stopPropagation());
  cb.addEventListener("change", () => onPhotoCheck(r, "taken", cb.checked));
  box.append(cb, document.createTextNode("撮影済み"));
  const head = cardHead(r, box);

  if (p.taken) {
    swipeWholeCard(card, head, [note], () => onPhotoCheck(r, "sent", true));
  } else {
    card.appendChild(head);
    if (note) card.appendChild(note);
  }
  return card;
}

// ケアのみの子（ラン担当画面）：展開せず、ケア担当画面と同じくパネルごと左スワイプで送信。
function renderCareOnlyCard(r, sentView, ci) {
  const card = document.createElement("div");
  card.className = "rabbit";
  const note = buildNote(r);

  if (sentView || ci.lineSent) {
    const head = cardHead(r, "ケア 送信済み", { sent: true });
    card.appendChild(head);
    if (note) card.appendChild(note);
    card.appendChild(
      rowEnd(
        undoButton(() => dr.unmarkCareLineSent(STORE_ID, r, currentDate).catch(notifyWriteError)),
      ),
    );
    return card;
  }

  // careDone（＝スワイプで送信できる状態）は「送信待ち」を出さない。未完了だけ明示。
  const head = cardHead(r, ci.careDone ? "ケア" : "ケア 未完了");

  if (ci.careDone) {
    // 実施済みになったらケア項目を出す＋パネルごとスワイプ
    const detail = detailLine("実施：" + (ci.doneNames.join(" / ") || "―"));
    swipeWholeCard(card, head, [note, detail], () =>
      dr.markCareLineSent(STORE_ID, r, currentDate).catch(notifyWriteError),
    );
  } else {
    // 未完了：ヘッダーのみ（「ケア担当が未完了です」は出さない）
    card.appendChild(head);
    if (note) card.appendChild(note);
  }
  return card;
}

function renderCard(r, sentView) {
  const { need: needed, done, sent } = runOnDate(r, currentDate);
  const ci = careForDay(r, currentDate);
  const isRun = needed > 0;

  // ラン・ケアがある日は写真は扱わない
  const photoApplies = !isRun && !ci && photoNeededToday(r, currentDate);
  if (photoApplies) return renderPhotoOnlyCard(r, sentView);
  // ケアのみの子は展開せずパネルごとスワイプ
  if (!isRun && ci) return renderCareOnlyCard(r, sentView, ci);

  const card = document.createElement("div");
  card.className = "rabbit";
  const host = card;

  // 状況は「種別＋数字」だけ。送信待ち・未実施ありはスワイプ／チェックで分かるので出さない。
  let summary;
  if (isRun) {
    summary = `ラン ${done}/${needed}`;
  } else {
    summary = (
      "ケア " + (ci && ci.lineSent ? "送信済み" : ci && !ci.careDone ? "未完了" : "")
    ).trim();
  }

  const head = cardHead(r, summary, {
    sent: isAllSent(r),
    expandable: true,
    open: expanded.has(r.id),
  });
  head.addEventListener("click", () => {
    expanded.has(r.id) ? expanded.delete(r.id) : expanded.add(r.id);
    render();
  });
  host.appendChild(head);

  const note = buildNote(r);
  if (note) host.appendChild(note);

  if (!expanded.has(r.id)) return card;

  const body = document.createElement("div");
  body.className = "body";

  if (sentView) {
    // === 送信済み分の表示（内容の確認＋取り消し） ===
    if (sent > 0) {
      const runSec = taskSection("ラン", `送信済み ${sent}/${needed}`);
      for (let i = 0; i < sent; i++) {
        const row = document.createElement("div");
        row.className = "item";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = `ラン ${i + 1}回目`;
        const b = document.createElement("span");
        b.className = "badge ok";
        b.textContent = "LINE送信済み";
        row.append(label, b);
        // 直近の送信だけ取り消せる（送信済み回数は積み上げ式のため）
        if (i === sent - 1) row.append(undoButton(() => onRunUndo(r, i)));
        runSec.appendChild(row);
      }
      body.appendChild(runSec);
    }
    if (ci && ci.lineSent) {
      const careSec = taskSection("ケア", "LINE送信済み");
      const info = mutedLine("実施：" + (ci.doneNames.join(" / ") || "―"));
      info.classList.add("info-pad");
      careSec.appendChild(info);
      careSec.appendChild(
        rowEnd(
          undoButton(() => dr.unmarkCareLineSent(STORE_ID, r, currentDate).catch(notifyWriteError)),
        ),
      );
      body.appendChild(careSec);
    }
  } else {
    // === ラン ===（ランのある子だけ）
    // 全回を並べ、送る回だけ薄い下地の行を左スワイプで送信（順番どおり）。
    if (isRun) {
      const runSec = taskSection("ラン", `実施 ${done}/${needed}・送信 ${sent}/${needed}`);
      for (let i = 0; i < needed; i++) {
        const runIsDone = i < done;
        const runIsSent = i < sent;
        const isNextToSend = runIsDone && !runIsSent && i === sent;

        const row = document.createElement("div");
        row.className = "item";

        // チェックボックスは常に表示。実施済みは ON、送信済みは取り消し不可（無効）
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = runIsDone;
        cb.disabled = runIsSent;
        cb.addEventListener("change", () => onRunCheckToggle(r, i, cb.checked));
        row.appendChild(cb);

        row.appendChild(spanEl("label", `ラン ${i + 1}回目`));

        if (runIsSent) {
          row.appendChild(spanEl("run-state sent", "送信済み"));
          row.classList.add("is-dim");
          runSec.appendChild(row);
        } else if (isNextToSend) {
          // 「ラン N回目」の行に、右下寄せでスワイプ案内を入れる
          row.appendChild(swipeNote("スワイプで完了", true));
          runSec.appendChild(wrapSwipe(row, () => onRunSend(r, i)));
        } else if (runIsDone) {
          row.appendChild(spanEl("run-state", "送信待ち"));
          runSec.appendChild(row);
        } else {
          runSec.appendChild(row); // 未実施：チェックのみ
        }
      }
      body.appendChild(runSec);
    }

    // === ケア ===（見出し「ケア」ごと左スワイプで送信。以前と同じ挙動）
    if (ci && !ci.lineSent) {
      const careSec = taskSection("ケア", ci.careDone ? "送信待ち" : "未完了");
      if (ci.careDone) {
        const info = mutedLine("実施：" + (ci.doneNames.join(" / ") || "―"));
        info.classList.add("info-pad");
        careSec.appendChild(info);
        careSec.appendChild(swipeNote("スワイプで完了"));
        body.appendChild(
          wrapSwipe(careSec, () =>
            dr.markCareLineSent(STORE_ID, r, currentDate).catch(notifyWriteError),
          ),
        );
      } else {
        careSec.appendChild(mutedLine("ケア担当が未完了です"));
        body.appendChild(careSec);
      }
    }
  }

  if (!body.hasChildNodes()) {
    body.appendChild(mutedLine("すべてLINE送信済み"));
  }

  host.appendChild(body);
  return card;
}

// ラベル（種別名＋状況）付きのセクション箱を作る
function taskSection(title, status) {
  const sec = document.createElement("section");
  sec.className = "task-sec";
  const h = document.createElement("div");
  h.className = "sec-head";
  h.innerHTML = `<span>${esc(title)}</span><span class="sec-status">${esc(status || "")}</span>`;
  sec.appendChild(h);
  return sec;
}
function mutedLine(text) {
  const d = document.createElement("div");
  d.className = "muted card-line";
  d.textContent = text;
  return d;
}

function onRunCheckToggle(r, index, done) {
  dr.updateRunCheck(STORE_ID, r, currentDate, index, done).catch(notifyWriteError);
}
function onRunSend(r, index) {
  dr.markRunLineSent(STORE_ID, r, currentDate, index).catch(notifyWriteError);
}
function onRunUndo(r, index) {
  dr.unmarkRunLineSent(STORE_ID, r, currentDate, index).catch(notifyWriteError);
}

// 送信取り消しボタン（全カード共通。ラベル・体裁をそろえ、CSS で頭に ↩ が付く）
function undoButton(onClick, label = "取り消す") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "undo-btn";
  b.textContent = label;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
// 要素を右寄せの1行にくるむ（取り消しボタンを「送信済み」表示の側にそろえる）
function rowEnd(el) {
  const d = document.createElement("div");
  d.className = "row row-end";
  d.appendChild(el);
  return d;
}

function swipeNote(text, inline) {
  const d = document.createElement("div");
  d.className = inline ? "swipe-note swipe-note-inline" : "swipe-note";
  const t = document.createElement("span");
  t.className = "sn-txt";
  t.textContent = text;
  d.appendChild(t);
  return d;
}

function onPhotoCheck(r, field, value) {
  dr.updatePhotoStatus(STORE_ID, r, currentDate, field, value).catch(notifyWriteError);
}

// ---- 予定オーバーレイ（全体一覧と同じ様式で、その子だけ） ----
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
    careNames = new Map(careMaster.map((m) => [m.id, m.name]));
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
