// Firebaseへの接続設定（共通ファイル）
//
// ↓ Firebaseコンソール →「プロジェクトの設定」→「マイアプリ（ウェブ）」で取得した値に置き換えてください。
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
  apiKey: "AIzaSyBx0Du1FI_K6g9Hkbu98qQJmf5I1hCwVdg",
  authDomain: "rabbit-hotel-manager.firebaseapp.com",
  projectId: "rabbit-hotel-manager",
  storageBucket: "rabbit-hotel-manager.firebasestorage.app",
  messagingSenderId: "44112581380",
  appId: "1:44112581380:web:9e49fe5eb42496a37a7651",
  measurementId: "G-FGMER1CDGG",
};

// スタッフ共有アカウント。Firebase Authentication（メール/パスワード）に
// 1つだけ作成したアカウントのメールアドレスをここに書く。
// スタッフは login 画面ではパスワードだけを入力し、内部でこのアドレス固定でログインする。
// ★ 実際に作成したアドレスに置き換えてください（詳細は README「セキュリティ」節）。
export const STAFF_EMAIL = "kh2005haru@icloud.com";

// App Check（reCAPTCHA Enterprise・スコアベースのサイトキー）。
// 空文字なら App Check は初期化しない（未設定でも動く）。
// 設定手順は README「セキュリティ」節を参照。
const RECAPTCHA_SITE_KEY = "6LckYq8tAAAAAKNFXpIRsAqtyWK96xLaIaO8LKfz";

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

// App Check：初期化は initializeApp の直後、他のサービス利用より前に行う。
// サイトキー未設定なら何もしない（enforcement をコンソールで有効にする前でも動く）。
if (RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn("App Check を初期化できませんでした", e);
  }
}

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
