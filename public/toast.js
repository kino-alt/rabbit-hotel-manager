// 画面共通のトースト通知。
// 主目的は「書き込みが静かに失敗してスタッフが気づかない」を防ぐこと。

let host;
let hideTimer;

function ensureHost() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

// message を数秒表示する。type: "info" | "error"
export function toast(message, type = "info") {
  const el = ensureHost();
  el.textContent = message;
  el.className = `toast-host show ${type}`;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(
    () => {
      el.className = `toast-host ${type}`;
    },
    type === "error" ? 6000 : 3000,
  );
}

// 書き込み失敗の共通ハンドラ。DB 書き込みの .catch(notifyWriteError) で使う。
// （元は .catch(console.error) で握りつぶしていたもの）
export function notifyWriteError(err) {
  console.error(err);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  toast(
    offline
      ? "オフラインです。変更は接続が戻ったとき自動で保存されます。"
      : "保存できませんでした。通信状況を確認してもう一度お試しください。",
    "error",
  );
}
