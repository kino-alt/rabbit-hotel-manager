// 初期セットアップ：config / stores/{STORE_ID} の初期値を書き込む

import { signInAnonymously } from "./auth.js";
import * as db from "./db.js";
import { STORE_ID } from "./firebase-config.js";
import { getConfig } from "./db.js";

const form = document.getElementById("setup-form");
const message = document.getElementById("message");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";
  try {
    await signInAnonymously();

    const commonPassword = document.getElementById("common-pw").value.trim();
    const managerPassword = document.getElementById("manager-pw").value.trim();

    const weekdays = [...document.querySelectorAll(".wd:checked")].map((c) => Number(c.value));

    const careItemsMaster = document.getElementById("care-items").value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({ id: "c" + (i + 1) + "_" + Date.now().toString(36), name, order: i }));

    // パスワードは初回のみ書き込む（既にあれば触らない）
    const existing = await getConfig();
    if (!existing) {
      await db.initConfig(commonPassword, managerPassword);
    }

    await db.initStore(STORE_ID, {
      holidays: { weekdays, dates: [] },
      careItemsMaster,
    });

    message.className = "msg info";
    message.textContent = existing
      ? "店舗設定を更新しました（パスワードは既存のまま）。login.html からログインできます。"
      : "セットアップ完了。login.html からログインしてください。";
  } catch (err) {
    console.error(err);
    message.className = "msg error";
    message.textContent = err.message || "セットアップに失敗しました";
  }
});
