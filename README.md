# うさぎホテル業務管理アプリ

`documents/` の設計資料に基づく実装です。Firebase(Sparkプラン)+ Hosting + Firestore + 匿名認証で動きます。

## ファイル構成

```
public/                 … Hosting で配信するファイル
  index.html            … login.html へリダイレクト
  login.html / login.js … ログイン(共通パスワード入力)
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

  firebase-config.js … Firebase接続設定(★要編集)
  auth.js            … 共通ロジック層:パスワード照合 + 匿名ログイン
  schedule.js        … 共通ロジック層:日付計算
  dailyRecord.js     … 共通ロジック層:当日記録の生成・更新
  db.js              … データアクセス層:Firestoreの読み書き
  style.css          … 全画面共通デザイン

firebase.json / firestore.rules / firestore.indexes.json / .firebaserc
```

層の方針は設計資料どおり:画面層は Firestore を直接触らず、必ず `auth.js` / `dailyRecord.js` / `db.js` を経由します。

## セットアップ手順

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成(Sparkプランのまま)。
2. **Authentication** →「ログイン方法」→ **匿名** を有効化。
3. **Firestore Database** を作成(本番モード)。
4. ウェブアプリを追加し、表示された設定値を `public/firebase-config.js` の `firebaseConfig` に貼り付け。
   `.firebaserc` の `TODO_PROJECT_ID` も実際のプロジェクトIDに変更。
5. Firebase CLI を導入して初回デプロイ:
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,hosting
   ```
6. デプロイした URL の `/setup.html` を開き、共通パスワード・設定パスワード・ケア項目・定休日を登録。
   (パスワードは全店舗共通。共通パスワードは全員のログイン用、設定パスワードは設定画面を開くとき用。
    ケア項目・定休日は次の手順で店舗ごとに上書きされます)
7. `/seed-stores.html` を開いて「店舗を登録する」を実行。
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

以降のパスワード変更は Firestore コンソールで `config/common` を直接編集してください
(セキュリティルールでクライアントからの更新を禁止しているため)。

## Firestore データ構造

設計資料 `documents/firestore_data_structure_final.md` に準拠。

```
config/common
  { commonPassword, managerPassword }

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
    careTotals:    { itemId: 累計回数 }
    runTotal:      累計回数
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
