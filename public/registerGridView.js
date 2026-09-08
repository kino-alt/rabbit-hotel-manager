// うさぎ登録 STEP2 のグリッドHTML生成（DOM非依存・純粋）。
// register.js が生成された文字列を innerHTML に入れ、data-* 属性にハンドラを配線する。
// entry の形は scheduleGrid.js のコメント参照。

import { esc } from "./esc.js";
import { dayWd, isHoliday, todayISO, calculatePhotoNeeded } from "./schedule.js";
import { careScheduleShape, careUnitsOnDay } from "./scheduleGrid.js";

function runOptions(sel) {
  let o = "";
  for (let i = 0; i <= 9; i++) {
    o += `<option value="${i}"${i === sel ? " selected" : ""}>${i === 0 ? "−" : i}</option>`;
  }
  return o;
}

// STEP2 メインの予定表（ケア/ラン/写真 × 滞在日）。ctx = { holidays, busyPeriods }
export function scheduleTableHTML(entries, stayDates, ctx) {
  const { holidays, busyPeriods } = ctx;
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
          `<th class="dcol${c.hol ? " col-holiday" : ""}${c.today ? " today" : ""}">` +
          `${c.day}<span class="wd">${c.wd}</span></th>`,
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
        if (!inCare) {
          return `<td class="dcol cell-care" data-addday data-e="${ei}" data-d="${c.d}">＋</td>`;
        }
        if (units === 0) {
          return (
            `<td class="dcol cell-care cell-empty" data-rmday data-e="${ei}" data-d="${c.d}" ` +
            `title="タップで取り消し">–</td>`
          );
        }
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
        return (
          `<td class="dcol${n > 0 ? " cell-run on" : ""}">` +
          `<select class="run-sel" data-e="${ei}" data-d="${c.d}">${runOptions(n)}</select></td>`
        );
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
  return html;
}

// ケア予定日が2日以上のときだけ出す「どの日にやるか」の補足。
// ctx = { holidays, careItemName }。中身が無ければ空文字（＝呼び出し側で hidden にする）。
export function careBreakdownHTML(entries, ctx) {
  const { holidays, careItemName } = ctx;
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
            `<input type="radio" name="bd-${ei}-${esc(id)}" data-move data-e="${ei}" ` +
            `data-id="${esc(id)}" data-d="${d}"${on ? " checked" : ""}>` +
            `${day}(${wd})</label>`
          );
        })
        .join("");
      h +=
        `<div class="bd-item"><div class="bd-name">${esc(careItemName(id))}</div>` +
        `<div class="bd-days">${chips}</div></div>`;
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
      h +=
        `<div class="bd-item"><div class="bd-name">${esc(careItemName(id))}` +
        `<span class="muted"> 全${totalN}回</span></div><div class="bd-cline">${pairs}</div></div>`;
    });

    blocks.push(h);
  });

  if (blocks.length === 0) return "";
  return (
    '<div class="bd-head">補足：ケアが複数日にあるとき、どの日にやるか</div>' + blocks.join("")
  );
}
