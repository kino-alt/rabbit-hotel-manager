// 共通ロジック層：パスワード照合 + 匿名ログイン
//
// スタッフから見える操作は「共通パスワードを1つ入力するだけ」。
// 正しければ裏側で匿名認証にログインし、以後はFirestoreのセキュリティルールが
// 「ログイン済みか」を見てアクセス可否を判定する。

import {
  signInAnonymously as fbSignInAnonymously,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { auth } from "./firebase-config.js";
import { getConfig } from "./db.js";

// 入力パスワードを config と照合し、一致すれば匿名ログイン状態を維持する。
// Firestoreのセキュリティルールが「ログイン済みのみ読み取り可」なので、
// まず匿名ログインしてから config を読み、パスワードが違えばログアウトする。
//
// ログインは全員同じ（共通パスワード）。設定画面だけは admin.js 側で
// 「設定パスワード（managerPassword）」を別途要求する。
export async function login(inputPassword) {
  await fbSignInAnonymously(auth);

  let cfg;
  try {
    cfg = await getConfig();
  } catch (err) {
    await signOut(auth);
    throw err;
  }
  if (!cfg) {
    await signOut(auth);
    throw new Error("初期設定が未完了です（setup.html を先に実行してください）");
  }

  // 共通パスワードのみでログイン可否を判定する
  const ok = !!cfg.commonPassword && inputPassword === cfg.commonPassword;
  if (!ok) {
    await signOut(auth);
    return { ok: false };
  }

  localStorage.setItem("role", "staff");
  return { ok: true, role: "staff" };
}

// 設定画面を開くための「設定パスワード」を照合する（ログインとは別）。
export async function verifyManagerPassword(inputPassword) {
  const cfg = await getConfig();
  if (!cfg || !cfg.managerPassword) return false;
  return inputPassword === cfg.managerPassword;
}

export function signInAnonymously() {
  return fbSignInAnonymously(auth);
}

export function getRole() {
  return localStorage.getItem("role") || "staff";
}

export function isManager() {
  return getRole() === "manager";
}

// 各画面の先頭で呼ぶ。未ログインなら login.html へ飛ばす。
export function requireAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
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
