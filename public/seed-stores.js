// 店舗の初期登録：stores/store_1（本店）・stores/store_2（豊中店）を作る。
// ・careItemsMaster は現在の stores/main と同じ内容をコピー（無ければ既定値）
// ・定休日  本店=毎週 火(2)・木(4) ／ 豊中店=毎週 水(3)・木(4)
// ・TTLポリシー設定用に、各店舗へ expireAt 付きの仮うさぎを1件ずつ作成
//
// setup.html と同じく Firebase プロジェクト構築後に手動で1回開くページ。

import { signInAnonymously } from "./auth.js";
import * as db from "./db.js";

const form = document.getElementById("seed-form");
const message = document.getElementById("message");

// stores/main にケア項目が無かった場合のフォールバック（setup.html の既定と同じ）
const CARE_FALLBACK = ["爪切り", "ブラッシング", "お耳ケア", "お尻ケア"];

const TARGETS = [
  { id: "store_1", name: "本店", weekdays: [2, 4] },   // 火・木
  { id: "store_2", name: "豊中店", weekdays: [3, 4] },  // 水・木
];

function info(t) { message.className = "msg info"; message.style.whiteSpace = "pre-line"; message.textContent = t; }
function fail(t) { message.className = "msg error"; message.style.whiteSpace = "pre-line"; message.textContent = t; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";
  const btn = form.querySelector("button");
  btn.disabled = true;
  try {
    await signInAnonymously();

    // 現在の main のケア項目マスタをそのまま流用する
    let careItemsMaster = await db.getCareItemsMaster("main");
    if (!careItemsMaster || careItemsMaster.length === 0) {
      careItemsMaster = CARE_FALLBACK.map((name, i) => ({ id: "c" + (i + 1), name, order: i }));
    }

    const makePlaceholder = document.getElementById("make-placeholder").checked;
    const done = [];

    for (const t of TARGETS) {
      await db.initStore(t.id, {
        name: t.name,
        holidays: { weekdays: t.weekdays, dates: [] },
        careItemsMaster,
      });
      let extra = "";
      if (makePlaceholder) {
        const rid = await db.createPlaceholderRabbit(t.id);
        extra = `（仮うさぎ ${rid} を作成）`;
      }
      done.push(`${t.id}＝${t.name}${extra}`);
    }

    info(
      "登録しました：\n" + done.join("\n") +
      "\nケア項目：" + careItemsMaster.map((c) => c.name).join("、") +
      "\n次に Firestore コンソールの TTL で rabbits / expireAt のポリシーを有効化してください。"
    );
  } catch (err) {
    console.error(err);
    fail(err.message || "登録に失敗しました");
  } finally {
    btn.disabled = false;
  }
});
