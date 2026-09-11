// 共通ロジック層：スタッフ共有アカウントでのログイン + 設定パスワードの照合
//
// スタッフから見える操作は「パスワードを1つ入力するだけ」。
// 内部では Firebase Authentication のメール/パスワードで、STAFF_EMAIL 固定＋入力パスワードで
// ログインする（匿名認証は使わない）。以後は Firestore のセキュリティルールが
// 「メール/パスワードでログイン済みか」を見てアクセス可否を判定する。

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "./vendor.js";

import { auth, STAFF_EMAIL } from "./firebase-config.js";
import { getConfig } from "./db.js";

// 入力パスワードで共有アカウントにログインする。
// パスワード違い等（auth/*）は { ok:false }、それ以外の障害は例外を投げる。
export async function login(inputPassword) {
  try {
    await signInWithEmailAndPassword(auth, STAFF_EMAIL, inputPassword);
  } catch (err) {
    if (typeof err?.code === "string" && err.code.startsWith("auth/")) {
      return { ok: false };
    }
    throw err;
  }
  localStorage.setItem("role", "staff");
  return { ok: true, role: "staff" };
}

// 設定画面を開くための「設定パスワード」を照合する（ログインとは別）。
// config/common はログイン済みスタッフだけが読めるルールになっている。
export async function verifyManagerPassword(inputPassword) {
  const cfg = await getConfig();
  if (!cfg || !cfg.managerPassword) return false;
  return inputPassword === cfg.managerPassword;
}

// スタッフ共有アカウントのログインパスワードを変更する（設定画面から。要・今のパスワード）。
// 変更後、他の端末は次回のトークン更新以降 新しいパスワードでのログインが必要になる。
export async function changeStaffPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("ログインしていません");
  if (!newPassword || newPassword.length < 6) {
    throw new Error("新しいパスワードは6文字以上にしてください");
  }
  // 今のパスワードで再認証してから変更（Firebase が最近のログインを要求するため）
  await reauthenticateWithCredential(
    user,
    EmailAuthProvider.credential(STAFF_EMAIL, currentPassword),
  );
  await updatePassword(user, newPassword);
}

export function getRole() {
  return localStorage.getItem("role") || "staff";
}

export function isManager() {
  return getRole() === "manager";
}

// 各画面の先頭で呼ぶ。メール/パスワードでログイン済みでなければ login.html へ飛ばす。
export function requireAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
      location.replace("login.html");
      return;
    }
    if (onReady) onReady(user);
  });
}

export async function logout() {
  localStorage.removeItem("role");
  await signOut(auth);
  location.replace("login.html");
}
