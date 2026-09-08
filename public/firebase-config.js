// Firebaseへの接続設定（共通ファイル）
//
// ↓ Firebaseコンソール →「プロジェクトの設定」→「マイアプリ（ウェブ）」で取得した値に置き換えてください。
// この情報はブラウザに公開されても問題ありません（不正アクセスはセキュリティルールと匿名認証で防ぎます）。

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBx0Du1FI_K6g9Hkbu98qQJmf5I1hCwVdg",
  authDomain: "rabbit-hotel-manager.firebaseapp.com",
  projectId: "rabbit-hotel-manager",
  storageBucket: "rabbit-hotel-manager.firebasestorage.app",
  messagingSenderId: "44112581380",
  appId: "1:44112581380:web:9e49fe5eb42496a37a7651",
  measurementId: "G-FGMER1CDGG"
};

// 店舗一覧（Firestore の stores/{id} と対応）。
// 店舗を増やすときはこの配列に追加し、seed-stores.html で初期値を書き込む。
export const STORES = [
  { id: "store_1", name: "本店" },
  { id: "store_2", name: "豊中店" },
];

// 現在選択中の店舗ID。main.html で切り替え、localStorage に保存する。
// 各画面はモジュール読み込み時にこの値を1回だけ参照する（店舗切替はページ再読み込みで反映）。
function resolveStoreId() {
  const saved = localStorage.getItem("storeId");
  if (saved && STORES.some((s) => s.id === saved)) return saved;
  return STORES[0].id;
}

export const STORE_ID = resolveStoreId();

// main.html の店舗切替から呼ぶ。保存後にページを再読み込みすると全画面に反映される。
export function setStoreId(id) {
  if (!STORES.some((s) => s.id === id)) return false;
  localStorage.setItem("storeId", id);
  return true;
}

// 現在の店舗名（表示用）
export function currentStoreName() {
  const s = STORES.find((x) => x.id === STORE_ID);
  return s ? s.name : STORE_ID;
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
