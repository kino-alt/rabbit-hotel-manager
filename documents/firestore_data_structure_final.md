# Firestoreデータ構造(最終版・改訂4)

> この文書は初期実装時点のもの。以降の変更（改訂4）を本文にも反映済み。
> セットアップ・セキュリティ・引き継ぎ手順の最新はリポジトリ直下の `README.md` を参照。

## 改訂内容

### 改訂4(2026-09・運用開始後の見直し)

- 認証を**匿名認証 → メール/パスワードの共有アカウント**に変更（`STAFF_EMAIL` 固定）。
  ルールは `request.auth.token.firebase.sign_in_provider == 'password'` を要求。
- `config/common` から **`commonPassword` を削除**（ログインは Firebase Auth 側）。`managerPassword` のみ残す。
- **`careTotals` / `runTotal` と `db.bumpTotals()` を廃止**（どの画面も読んでおらず、当日記録と非アトミックにズレる原因だった）。累計が要れば `dailyRecords` から集計する。
- うさぎ文書に **`staffName`**（登録した担当スタッフ名。登録時のみ入力）を追加。
- App Check（reCAPTCHA Enterprise）と Firestore オフライン永続化を導入。


### 改訂2まで

- `dailyRecords`を**サブコレクションから、うさぎ1件の文書の中のフィールド**に変更(6ヶ月後のTTL自動削除で、サブコレクションだけ消し残る問題を解消するため)
- **匿名認証+セキュリティルール**を追加(パスワード画面だけでは技術的にデータを完全に守れないため)

### 改訂3(実装に合わせて反映)

- `careItemsMaster`を**サブコレクションではなく店舗文書内の配列フィールド**に変更(店長設定で「まとめて編集」するため。読み書きが1回で済み無料枠に優しい)
- 定休日を`holidays: { weekdays: [0..6], dates: ["YYYY-MM-DD", ...] }`という形に確定(毎週の定休曜日と臨時休業日の両方を扱う)
- `config`のドキュメントIDを`config/common`に確定。フィールドは`commonPassword` / `managerPassword`
- `dailyRecords`の具体的なキー名(`care` / `run` / `photo`)を明記
- `photoSchedule`の値は文字列`"needed"` / `"not_needed"`。記載がない日は自動判定
- うさぎ文書に`groupId`(+ボタン登録の紐づけ)を追加。`非表示にした日時`のフィールド名は`hiddenAt`、TTLの対象は`expireAt`(`Timestamp`型)

## 全体構造

```
config/common(全店舗共通・ドキュメントIDは "common" 固定)
    managerPassword  … 設定パスワード。設定画面(admin.html)を開くときだけ要求する
                       （ログインとは別。通れば sessionStorage でそのタブ内は再入力不要）
    ※ログインパスワードはここではなく Firebase Authentication の共有アカウント側。
    ※クライアントからの更新・削除はセキュリティルールで禁止。
      設定パスワードの変更は設定画面の「ログインパスワード」欄、または Firebase コンソール。

stores/{storeId}(店舗ごと。storeId は firebase-config.js の STORES。
                 store_1=本店(定休日 火木) / store_2=豊中店(定休日 水木)。
                 現在の店舗は main.html で切り替え、localStorage "storeId" に保存)

    name(表示用の店舗名。例:"本店" / "豊中店")

    holidays(定休日)
        weekdays: [0..6]              … 毎週の定休曜日(0=日 … 6=土)
        dates:    ["YYYY-MM-DD", ...] … 臨時休業などの個別日

    careItemsMaster(ケア項目。店舗文書内の配列フィールド)
        [ { id, name, order, countable? }, ... ]
        ※設定画面で配列ごと一括編集する
        ※countable=true の項目は「チェック」ではなく「回数（0/n）」で扱う（プチブラシ等）。設定画面の「回数」で指定

    busyPeriods(繁忙期。店舗文書内の配列フィールド)
        [ { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }, ... ]
        ※期間中は全うさぎで写真が「不要」になる（isBusyPeriod で判定）
        ※終了日が過ぎた期間は、設定画面を開いたときに自動で取り除いて保存する

    rabbits(うさぎの宿泊記録。1件=1羽の1回の宿泊。1文書に全情報を集約)
        ownerLastName      … 飼い主苗字
        rabbitName         … うさぎ名前
        groupId            … 同じ来店の紐づけ用。+ボタン登録時に自動付与
        checkInDate        … お預かり日("YYYY-MM-DD")
        checkOutDate       … 宿泊終了日("YYYY-MM-DD")
        transportDropoff   … 送迎:預かり時(true/false)
        transportPickup    … 送迎:お迎え時(true/false)
        isFirstTime        … 初めてか(true/false)
        note               … 備考
        staffName          … 担当スタッフ名(登録時のみ入力・必須)
        createdAt          … 作成日時(serverTimestamp)
        hiddenAt           … 非表示にした日時(通常は null。宿泊終了操作で serverTimestamp)
        expireAt           … hiddenAt の約6ヶ月後(Timestamp型。Firestore TTL の対象。通常は null)

        careSchedule(日付ごとのケア項目の割り振り)
            {日付}: [項目ID, 項目ID, ...]
            ※デフォルトは「お迎え日の1日前(定休日なら直近の営業日)」に全項目を自動割り振り
            ※宿泊全体の編集画面で、日をまたいで手動調整も可能

        runSchedule(日付ごとのラン予定回数)
            {日付}: 予定回数
            ※自動計算はせず、飼い主の要望をもとにスタッフが手動入力
            ※記載がない日=ランの予定なし

        photoSchedule(日付ごとの写真要否)
            {日付}: "needed" | "not_needed"
            ※記載がある日はその値を優先
            ※記載がない日は自動計算(定休日でなく、ケア・ラン予定がともにない日は「必要」)
            ※宿泊全体の編集画面で、複数日まとめて編集可能

        ※（廃止）careTotals / runTotal … 宿泊全体の累計を別フィールドで持っていたが、
          どの画面も参照しておらず、当日記録の書き込みと非アトミックにズレるため改訂4で削除。
          累計が要るときは dailyRecords から集計する。

        dailyRecords(日付ごとの実績記録。マップ形式のフィールドとして同じ文書内に持つ)
            {日付}
                care
                    items: { 項目ID: true/false }   実施済み/未実施
                        ※初期値はcareScheduleのその日の内容。当日その場で追加・削除も可能
                          (この日の記録だけに反映)
                    allDone: true/false              すべて完了か(自動計算)
                    lineSent: true/false             ケアのLINE送信済みか
                run
                    needed:    必要回数(runScheduleのその日の内容が初期値)
                    doneCount: 実施済み回数
                    sentCount: 送信済み回数
                photo
                    needed: true/false  必要か(記録作成時に自動計算。以後は手動でオン/オフ可)
                    taken:  true/false  撮影済みか
                    sent:   true/false  送信済みか
```

## サブコレクションからフィールドに変えたことによる効果

| 項目 | 変更前(サブコレクション) | 変更後(フィールド) |
|---|---|---|
| 6ヶ月後の自動削除 | 親文書は消えるが、サブコレクションは消し残る | 親文書ごと消えるので、記録も一緒に消える |
| 今日の記録を見る時 | うさぎ情報とdailyRecordsを別々に読みに行く必要がある | うさぎの文書1回読むだけで両方揃う(読み込み回数が減り効率化) |
| 過去の記録参照 | 専用の関数(getDailyRecordsRange)が必要 | 同じ文書内を見るだけで済み、専用関数が不要になる |

`careItemsMaster` も同じ理由(1回の読み書きで済む・TTLの消し残りがない)で、サブコレクションではなく店舗文書内の配列フィールドにしている。

## セキュリティについて(メール/パスワード認証 + セキュリティルール + App Check)

> 改訂4で匿名認証を廃止。最新は `README.md` の「セキュリティ」節。

**課題**:Webアプリの接続情報はブラウザから誰でも見えるため、パスワード画面だけでは「入り口を塞いでいる」だけで、詳しい人が直接Firestoreにアクセスすることを技術的には防げない。

**対策**:

1. スタッフは Firebase Authentication の**共有アカウント1つ**（メール/パスワード）でログインする。
   `login.html` はパスワードだけを入力し、内部で `STAFF_EMAIL` 固定でサインインする。
2. Firestore のセキュリティルールで「**メール/パスワードで**ログイン済みの人にしか読み書きさせない」
   （`request.auth.token.firebase.sign_in_provider == 'password'`）。匿名認証では通らない。
3. App Check（reCAPTCHA Enterprise）で「正規のWebアプリからのアクセスか」を検証する。

**セキュリティルールの要点**(`firestore.rules`):

- `staff()` = `request.auth != null && sign_in_provider == 'password'`
- `config/{doc}`:`get` は staff なら可（設定パスワード照合に必要）。`create` は該当ドキュメントが無いときだけ可（setup.html の初回実行）。`update`/`delete`/`list` はクライアントから不可。
- `stores/{storeId}` と `stores/{storeId}/rabbits/{rabbitId}`:staff なら `get`/`list`/`write` 可。
  `rabbits` の `list` を明示的に許可しているのは、ケア/ラン/一覧画面が `subscribeActiveRabbits()` でコレクションをクエリ購読するため。
- （既知の割り切り）スキーマ検証はしていない。共有アカウントなので個人単位の監査ログもない。

## 主な設計の考え方(変更なし)

| 仕組み | 目的 |
|---|---|
| `config`と`stores`を分離 | パスワードのみ全店舗共通、それ以外(ケア項目マスタ・定休日)は店舗ごとに管理するため |
| `careSchedule`/`runSchedule`/`photoSchedule` | 宿泊登録時に「いつ・何を」やるかをあらかじめ割り振り、日ごとに違う内容にできるようにするため |
| `dailyRecords`が予定と別に存在 | 当日の実施状況・LINE送信状況を記録し、かつ予定にない臨機応変な追加・削除にも対応するため |
| `hiddenAt` + Firestore TTL(`expireAt`) | 非表示後6ヶ月で自動的にデータを削除し、手動でのバックアップ作業を不要にするため |

## 画面での使い分け(未来 / 今日以降)

- **まだ来ていない未来の日**:`careSchedule`/`runSchedule`/`photoSchedule`(予定)を参照して表示
- **今日・過去の日**:`dailyRecords[その日]`(実績)を参照して表示

## 今回の検討で不要と判断したもの

- **Firebase Storage(写真ファイルの保存)**:写真自体は保存せず、「必要か/撮影済みか/送信済みか」という状態のみ管理するため不要
- **`careItems`(宿泊専用のケア項目テンプレート)**:`careSchedule`が同じ役割を兼ねるため廃止
- **定期バックアップの仕組み**:6ヶ月間はFirestoreに記録が残るため、別途のバックアップは行わない
- **`db.js`の`getDailyRecordsRange()`**:dailyRecordsがフィールド化されたことで、うさぎの文書を1回読むだけで過去記録も含めて取得できるため不要
- **`careItemsMaster`サブコレクション**:配列フィールドに統合したため不要
