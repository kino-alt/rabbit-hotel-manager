// ログイン画面：共通パスワード入力 → auth.js を呼ぶ

import { login } from "./auth.js";

const form = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submit-btn");
const message = document.getElementById("message");

function showError(text) {
  message.className = "msg error";
  message.textContent = text;
}

// パスワード入力フォームの送信を受け取る
async function onLoginSubmit(inputPassword) {
  message.textContent = "";
  submitBtn.disabled = true;
  try {
    const result = await login(inputPassword);
    if (result.ok) {
      location.replace("main.html");
    } else {
      showError("パスワードが違います");
      submitBtn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    showError(err.message || "ログインに失敗しました");
    submitBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  onLoginSubmit(passwordInput.value);
});
