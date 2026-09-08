# うさぎホテル業務管理アプリ

`documents/` の設計資料に基づく実装です。Firebase(Sparkプラン)+ Hosting + Firestore + メール/パスワード認証で動きます。

## ファイル構成

```
public/                 … Hosting で配信するファイル
  index.html            … login.html へリダイレクト
  login.html / login.js … ログイン(パスワード入力。内部はスタッフ共有アカウントでメール/パスワード認証)
  main.html / main.js    … 全体一覧をメイン表示。左上「☰」でメニュー(ケア/ラン/過去の記録/設定)。
                            一覧の右上「＋」でうさぎ登録へ。店舗切替つき
  care.html / care.js    … ケア担当画面
  run.html / run.js      … ラン担当画面
  overviewView.js             … 全体一覧(日付×うさぎ)の描画本体。本日から1週間・コンパクト表示。
                                種別列(ケア/ラン/写真)、宿泊期間/定休日をセル色で表示、予定〇/一部◐/完了●
  register.html / register.js … うさぎ登録・編集(2段階・複数可)。
                                STEP1=飼い主/日程/送迎(共通)+うさぎカード(名前/初回/ケア項目/備考。プチブラシは回数カウンター)
                                STEP2=滞在期間グリッド。ケアは既定日に全部セット済み→「＋」で日を足し、内訳表で
                                      通常項目はラジオで日を移動(元の日は自動で外れる)、プチブラシは日ごとに回数。ランはセルで増減
  history.html / history.js   … 過去の記録参照(宿泊終了したうさぎだけを月ごとに全体一覧と同じグリッドで。閲覧専用)
  admin.html / admin.js       … 設定(ケア項目・定休日・繁忙期。変更は自動保存。開くとき設定パスワードを要求。店舗名バッジを表示)
  setup.html / setup.js       … 初期セットアップ(初回のみ・パスワード等)
  seed-stores.html / seed-stores.js … 店舗(store_1 本店 / store_2 豊中店)の初期登録(初回のみ)

  firebase-config.js … Firebase接続設定 + STAFF_EMAIL + App Check(★要編集)
  auth.js            … 共通ロジック層:スタッフ共有アカウントのログイン + 設定パスワード照合
  schedule.js        … 共通ロジック層:日付計算
  dailyRecord.js     … 共通ロジック層:当日記録の生成・更新
  db.js              … データアクセス層:Firestoreの読み書き
  style.css          … 全画面共通デザイン

firebase.json / firestore.rules / firestore.indexes.json / .firebaserc
```

層の方針は設計資料どおり:画面層は Firestore を直接触らず、必ず `auth.js` / `dailyRecord.js` / `db.js` を経由します。

## セットアップ手順

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成(Sparkプランのまま)。
2. **Authentication** →「ログイン方法」→ **メール/パスワード** を有効化（匿名は使わない）。
   続いて **Users** →「ユーザーを追加」で**スタッフ共有アカウントを1つ**作成する
   （例：`staff@あなたのドメイン`。パスワードがスタッフ全員のログインパスワードになる）。
3. **Firestore Database** を作成(本番モード)。
4. ウェブアプリを追加し、表示された設定値を `public/firebase-config.js` の `firebaseConfig` に貼り付け。
   同ファイルの **`STAFF_EMAIL`** を手順2で作ったアドレスに変更。
   `.firebaserc` の `TODO_PROJECT_ID` も実際のプロジェクトIDに変更。
5. Firebase CLI を導入して初回デプロイ:
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,hosting
   ```
6. デプロイした URL の `/login.html` を手順2のパスワードでログイン → そのまま `/setup.html` を開き、
   設定パスワード（設定画面用）・ケア項目・定休日を登録。
   (ケア項目・定休日は次の手順で店舗ごとに上書きされます)
7. ログインしたまま `/seed-stores.html` を開いて「店舗を登録する」を実行。
   `stores/store_1`(本店・定休日 火木)と `stores/store_2`(豊中店・定休日 水木)が作成されます。
   ケア項目マスタは実行時点の `stores/main` と同じ内容がコピーされます(無ければ既定の4項目)。
   同時に TTL 設定用の仮うさぎ(`expireAt` 付き)が各店舗へ1件ずつ入ります。
8. **Firestore TTL** を設定:コンソール → Firestore →「TTL」→ コレクション `rabbits`、フィールド `expireAt` でポリシーを有効化。
   (手順7の仮うさぎがあるのでフィールドを選択できます。ポリシー有効化後、仮うさぎは削除して構いません)
   (宿泊終了[非表示]から6ヶ月後にうさぎ文書ごと自動削除されます。追加のプログラムは不要)
   - `expireAt` は `Timestamp` 型で保存されます(`db.js` の `hideRabbit()`)。文字列だとTTLが機能しないため変更しないこと。
   - TTLは期限到達後すぐには削除されず、**最大72時間程度のタイムラグ**があります(Firestoreの仕様。即座に消えなくても異常ではありません)。
9. `/login.html` からログイン。`main.html`(担当選択)の上部で本店／豊中店を切り替えられます
   (選択は端末ごとに `localStorage` に保存され、切替時にページが再読み込みされて全画面へ反映されます)。

以降の変更方法:
- **スタッフのログインパスワード** … 設定画面（`admin.html`）の「ログインパスワード」で、
  今のパスワードを入れて変更できる（店長が自分で変えられる）。
  うまくいかないとき / 今のパスワードが分からないときの予備手段：
  Firebase コンソール → Authentication → Users → 該当アカウント → パスワードを再設定（メールが届く）。
- **設定パスワード（managerPassword）** … Firestore コンソールで `config/common` を直接編集
  (セキュリティルールでクライアントからの更新を禁止しているため)。

### 引き継ぎ（共有アカウントのメールアドレスを変える）

開発時は開発者自身のメールで共有アカウントを作り、運用に渡すときに店が管理できる
アドレス（店長のメール、または店専用に作った Gmail）へ切り替える。データには一切影響しない
（アプリはログインユーザーのUIDを使っていない）。

1. Firebase コンソール → Authentication → Users で**新しいメールアドレスのユーザーを作成**
   （パスワードは運用で使う本番パスワード）。
2. `public/firebase-config.js` の `STAFF_EMAIL` を新しいアドレスに書き換える。
3. `firebase deploy --only hosting` でデプロイ。
4. 動作確認できたら、古いメールのユーザーを Authentication から削除。

※ `STAFF_EMAIL` はログインの最初に必要なため、設定画面（ログイン後にしか開けない）からは
変えられない。この1行の書き換え＋デプロイが引き継ぎ時の作業。

## セキュリティ

- **認証**：スタッフは Firebase Authentication の**共有アカウント1つ**（メール/パスワード）でログインする。
  `login.html` はパスワードだけを入力し、内部で `STAFF_EMAIL` 固定でサインインする。
  Firestore ルールは「メール/パスワードでログイン済みか」(`sign_in_provider == 'password'`) だけを見る。
  → デプロイURLを知っているだけでは読み書きできない（以前の匿名認証では誰でも通っていた）。
- **設定パスワード**：`config/common.managerPassword`。ログイン済みスタッフのみ読める。
  設定画面(`admin.html`)を開くときの2段階目の確認に使う（クライアント側で照合）。
- **App Check（推奨・任意）**：正規のWebアプリからのアクセスかを **reCAPTCHA Enterprise** で検証し、
  盗まれた設定値やスクリプトからの直接アクセスを弾く。
  （classic reCAPTCHA v3 は Google が Enterprise へ移行中のため、最初から Enterprise を使う。
  Enterprise は月1万アセスメントまで無料。このプロジェクトは TTL 利用で Blaze なので追加の課金設定は不要）
  設定手順：
  1. Firebase コンソール → **App Check** → アプリを登録 → **reCAPTCHA Enterprise** を選択。
     案内に沿って **スコアベース（website / score-based）のサイトキー**を作成し、
     そのキーの許可ドメインに Hosting のドメイン（`*.web.app` / 独自ドメイン）を追加。
     キーIDを `public/firebase-config.js` の `RECAPTCHA_SITE_KEY` に貼る。
  2. デプロイして `login.html` を開き、コンソールの App Check 画面で**リクエストが検証済みとして届く**ことを確認。
     ローカル(`firebase serve`)で試す場合は、DevTools で `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`
     を実行 → コンソールに出るトークンを App Check → アプリ → **デバッグトークン**に登録。
  3. 検証済みリクエストが十分に届いていることを確認してから、
     App Check → **Cloud Firestore** の「適用」を**有効化**する（有効化前は未検証でも通る）。
  - `RECAPTCHA_SITE_KEY` が空文字の間は App Check は初期化されない（未設定でもアプリは動く）。
- **残るリスク**：スタッフ共有アカウントのパスワードを知る人は全データを読み書きできる。
  「誰がいつ変えたか」の監査ログはない。個人ごとの権限分離が必要になったら
  スタッフ個別アカウント＋manager カスタムクレームへ移行する（評価メモ #3 の案2）。

## Firestore データ構造

設計資料 `documents/firestore_data_structure_final.md` に準拠。

```
config/common
  { managerPassword }          (設定画面の入口。スタッフのログインは Firebase Auth 側)

stores/{storeId}                     (storeId は firebase-config.js の STORES。store_1=本店 / store_2=豊中店)
  name: "本店" | "豊中店"              (表示用の店舗名)
  holidays: { weekdays: [0..6], dates: ["YYYY-MM-DD", ...] }
  careItemsMaster: [ { id, name, order, countable? }, ... ]   (countable=true の項目は回数式。設定画面の「回数」で指定)
  busyPeriods: [ { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }, ... ]
                                     (繁忙期。期間中は全うさぎで写真「不要」。
                                      終了日が過ぎたものは設定画面を開いたとき自動削除)

  rabbits/{rabbitId}
    ownerLastName, rabbitName, groupId,
    checkInDate, checkOutDate,          ("YYYY-MM-DD")
    transportDropoff, transportPickup, isFirstTime, note,
    createdAt, hiddenAt, expireAt,
    careSchedule:  { "YYYY-MM-DD": [itemId, ...] }
    careCounts:    { "YYYY-MM-DD": { itemId: 回数 } }   (careItemsMaster.countable の項目のみ。通常項目は持たない)
    runSchedule:   { "YYYY-MM-DD": 回数 }
    photoSchedule: { "YYYY-MM-DD": "needed" | "not_needed" }   (無い日は自動判定。繁忙期は常に不要)
    dailyRecords:  { "YYYY-MM-DD": {
        care:  { items: { itemId: bool },              (通常項目)
                 counts: { itemId: { need, done } },   (回数式項目)
                 allDone: bool, lineSent: bool },
        run:   { needed: n, doneCount: n, sentCount: n },
        photo: { needed: bool, taken: bool, sent: bool }
    } }
```

`dailyRecords` は設計資料の指示どおり**サブコレクションではなくうさぎ文書内のフィールド**です
(6ヶ月後のTTL自動削除で消し残りが起きないように)。

## 設計資料からの差分(実装上の判断)

| 箇所 | 資料 | 実装 | 理由 |
|---|---|---|---|
| ケア項目 | `careItemsMaster` サブコレクション | 店舗文書内の**配列フィールド** | 設定画面で「まとめて編集」するため、配列の方が読み書きが1回で済み無料枠に優しい |
| 定休日 | 「定休日リスト」 | `{ weekdays, dates }` | 毎週の定休曜日と臨時休業日の両方を扱えるように |
| うさぎ一覧の取得 | 資料は `subscribeRabbit`(単体)のみ記載 | 全体一覧=`subscribeActiveRabbits`(hiddenAt==null)／ケア・ラン=`subscribeAllRabbits`(終了ぶんも)／過去の記録=`getAllRabbits`→`isStayEnded`で絞る | 宿泊終了しても、その滞在期間の日付にはケア/ラン担当で記録が残って見えるように |
| 「宿泊終了」の判定 | 資料は明記なし | `schedule.isStayEnded(r)`＝`hiddenAt`あり **or** お迎え日<今日（当日は除く） | 「宿泊終了」ボタンの押し忘れを日付で自動カバー。`hiddenAt` は別途 TTL(6ヶ月後削除)の起点なのでボタン運用は残す |
| LINE送信・項目削除の操作 | スワイプ | ボタン(＋タッチ環境向けにスワイプは今後追加可) | まず確実に動く操作で機能を満たすことを優先。呼ぶ関数(`markCareLineSent` 等)は資料どおり |
| `getOrCreateDailyRecord` の引数 | `(rabbitId, date)` | `(storeId, rabbit, date, holidays, busyPeriods, countableIds)` | 購読中の文書と店舗設定を渡して読み取り回数を減らすため |
| `overview` での記録生成 | 資料では一覧でも `getOrCreateDailyRecord` | 一覧では**生成せず参照のみ** | 未来日の記録を先に作らないため。生成はケア/ラン画面で当日ぶんのみ |
| セットアップ | (コンソール前提) | `setup.html` を追加 | コンソールを触らずに初期値を投入できるように |
| `careTotals` / `runTotal` | 宿泊全体の累計を文書に持つ | **廃止**（2026-09） | どの画面も読んでおらず、チェック操作ごとに余計な書き込みが増える＋当日記録と非アトミックにズレる原因になっていた。累計が要るときは `dailyRecords` から集計する |

## データ層と同時アクセス対策

- **店舗設定**：`getStoreConfig()`(1回)／`subscribeStoreConfig()`(購読)で `careItemsMaster` / `holidays` / `busyPeriods` をまとめて扱う。ケア/ラン/全体一覧は購読なので設定画面の変更が即反映。
- **ケア/ラン状態の判定**：`schedule.js` の `careOnDate()` / `runOnDate()` に集約。全画面がこれだけを見る。
- **当日記録の更新**：すべて `db.writeDailyRecord()`(`setDoc` merge)。`getOrCreateDailyRecord()` は「無いときだけ初期値を merge」なので同時に開いても重複作成されない。予定を後から足したぶんも取り込む。
- **予定の書き込み**：
  - ケア担当「項目を編集」→ `db.patchScheduleDay()`（`arrayUnion`/`arrayRemove` で1項目単位）
  - 登録画面の保存 → `db.writeSchedulesMerge()`（`runTransaction` 内で base/server/next の3-wayマージ。利用者が変えた日だけを field path で書く）
- **登録画面**：`subscribeRabbit()` で最新を保持。保存後は影響した日の既存 `dailyRecords` を `reconcileDailyRecord()` で予定に合わせる。
- **残る割り切り**：同じうさぎ・同じ日を2人が同時に別内容へ編集した場合は最後の書き込みが勝つ（セマンティックな衝突のためトランザクションでも解決しない）。

詳細は `documents/function_relationships.md` の「改訂4」と「同時編集の扱い」。

## 開発（テスト）

ビルドは不要。純粋ロジック（日付計算・予定の3-wayマージ・当日記録の整合）に
Node 標準のテストランナーでテストを用意している。依存パッケージはなし。

```
npm test          # tests/ 以下を実行（Node 20+ が必要）
```

テスト対象（いずれも Firestore に依存しない純粋関数）:

| ファイル | 内容 |
|---|---|
| `public/schedule.js` | 日付ユーティリティ、定休日・繁忙期判定、`careOnDate` / `runOnDate` / `calculatePhotoNeeded` |
| `public/scheduleGrid.js` | 登録STEP2の作業データ ↔ Firestore形式の変換、`buildEntry` |
| `public/scheduleMerge.js` | `db.writeSchedulesMerge` の3-wayマージ判定（本体から切り出し） |
| `public/careReconcile.js` | `dailyRecord.js` の `reconcileCare` / `computeAllDone`（本体から切り出し） |

`main` への push と Pull Request で GitHub Actions（`.github/workflows/ci.yml`）が `npm test` を実行する。
