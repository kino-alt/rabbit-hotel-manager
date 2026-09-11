// Firebaseへの接続設定（テンプレート）
//
// 使い方：このファイルを firebase-config.js としてコピーし、下記の値を
// Firebaseコンソール →「プロジェクトの設定」→「マイアプリ（ウェブ）」で取得した値に置き換える。
//   cp public/firebase-config.example.js public/firebase-config.js
// firebase-config.js は .gitignore 済みなので、書き換えてもgit管理には入らない。
//
// firebaseConfig 自体はブラウザに公開されても問題ありません。実際のアクセス制御は
// セキュリティルール（本物のメール/パスワードでログイン済みか）と App Check で行います。

import {
  initializeApp,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getAuth,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "./vendor.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID",
};

// スタッフ共有アカウント。Firebase Authentication（メール/パスワード）に
// 1つだけ作成したアカウントのメールアドレスをここに書く。
// スタッフは login 画面ではパスワードだけを入力し、内部でこのアドレス固定でログインする。
// ★ 実際に作成したアドレスに置き換えてください（詳細は README「セキュリティ」節）。
export const STAFF_EMAIL = "staff@example.com";

// App Check（reCAPTCHA Enterprise・スコアベースのサイトキー）。
// 空文字なら App Check は初期化しない（未設定でも動く）。
// 設定手順は README「セキュリティ」節を参照。
const RECAPTCHA_SITE_KEY = "";

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

// オフライン永続化つきで Firestore を初期化する。
// ホテルの電波が弱くても、直前に読んだデータは表示でき、
// スワイプ等の書き込みは復帰時に自動再送される（複数タブ対応）。
// 端末がIndexedDBを使えない場合（プライベートブラウズ等）はメモリのみにフォールバック。
export const firestore = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("オフライン永続化を有効にできませんでした（メモリキャッシュで継続）", e);
    return initializeFirestore(app, {});
  }
})();

// App Check（reCAPTCHA Enterprise）はスクリプト読み込みが重く、ページ移動のたびに走ると
// もたつきの原因になる。描画をブロックしないよう、初回ペイント後（アイドル時）に初期化する。
// enforcement 有効化前はトークン無しでも通る。有効化後も、最初の読み取りはローカルキャッシュから
// 即返るため、サーバ同期がトークンを少し待つだけで済む。
if (RECAPTCHA_SITE_KEY) {
  const startAppCheck = () => {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("App Check を初期化できませんでした", e);
    }
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(startAppCheck, { timeout: 3000 });
  } else {
    setTimeout(startAppCheck, 800);
  }
}
