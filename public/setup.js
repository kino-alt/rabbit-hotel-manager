// 初期セットアップ：config/common（設定パスワード）の初期値を書き込む。
// 先に Firebase コンソールでスタッフ共有アカウントを作り、login.html でログインしてから開く。
// 店舗（定休日・ケア項目マスタ）は次の手順 seed-stores.html が作成する。

import { requireLogin } from "./auth.js";
import * as db from "./db.js";
import { getConfig } from "./db.js";

const form = document.getElementById("setup-form");
const message = document.getElementById("message");

function run() {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    message.textContent = "";
    try {
      const managerPassword = document.getElementById("manager-pw").value.trim();

      // 設定パスワードは初回のみ書き込む（既にあれば触らない）
      const existing = await getConfig();
      if (!existing) {
        await db.initConfig(managerPassword);
      }

      message.className = "msg info";
      message.textContent = existing
        ? "設定パスワードは既に登録済みです（変更していません）。"
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
  message.innerHTML =
    'このページを使うには先に <a href="login.html">login.html</a> でログインしてください。';
  form.querySelector("button[type=submit]").disabled = true;
});
