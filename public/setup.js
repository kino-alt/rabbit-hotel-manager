// 初期セットアップ：config/common（設定パスワード）と stores/{STORE_ID} の初期値を書き込む。
// 先に Firebase コンソールでスタッフ共有アカウントを作り、login.html でログインしてから開く。

import { requireLogin } from "./auth.js";
import * as db from "./db.js";
import { STORE_ID } from "./firebase-config.js";
import { getConfig } from "./db.js";

const form = document.getElementById("setup-form");
const message = document.getElementById("message");

function run() {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    message.textContent = "";
    try {
      const managerPassword = document.getElementById("manager-pw").value.trim();

      const weekdays = [...document.querySelectorAll(".wd:checked")].map((c) => Number(c.value));

      const careItemsMaster = document.getElementById("care-items").value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name, i) => ({ id: "c" + (i + 1) + "_" + Date.now().toString(36), name, order: i }));

      // 設定パスワードは初回のみ書き込む（既にあれば触らない）
      const existing = await getConfig();
      if (!existing) {
        await db.initConfig(managerPassword);
      }

      await db.initStore(STORE_ID, {
        holidays: { weekdays, dates: [] },
        careItemsMaster,
      });

      message.className = "msg info";
      message.textContent = existing
        ? "店舗設定を更新しました（設定パスワードは既存のまま）。"
        : "セットアップ完了。次に seed-stores.html を実行してください。";
    } catch (err) {
      console.error(err);
      message.className = "msg error";
      message.textContent = err.message || "セットアップに失敗しました";
    }
  });
}

requireLogin(run, () => {
  message.className = "msg error";
  message.innerHTML = 'このページを使うには先に <a href="login.html">login.html</a> でログインしてください。';
  form.querySelector("button[type=submit]").disabled = true;
});
