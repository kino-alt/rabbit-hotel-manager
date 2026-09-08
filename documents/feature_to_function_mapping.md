# 機能別:関数の役割と処理の流れ(改訂4)

このドキュメントは、「この機能はどう実現されているか」を、実際に動く関数の順番で追えるようにまとめたものです。

> **改訂4（2026-09）の要点**（本文の該当箇所も反映済み）：
> ログインは匿名認証 → メール/パスワードの共有アカウント（`signInWithEmailAndPassword`）。
> `db.bumpTotals()` と `careTotals` / `runTotal` は廃止。
> 登録時に `registeredBy`（担当スタッフ名）を入力。最新は `README.md`。

**改訂内容**

- 改訂2:ログイン機能を追加。`dailyRecords`のフィールド化に伴い機能6・7・11の説明を更新。
- 改訂3(実装に合わせて反映):
  - `dailyRecord.js`の各関数の引数を`(storeId, rabbit, date, ...)`に修正
  - ケア/ラン/一覧画面の購読を`subscribeActiveRabbits()`(一覧購読)に変更
  - LINE送信・項目の追加/削除の操作は「スワイプ」ではなく**ボタン／セレクト**で実装
  - `getOrCreateDailyRecord()`は care.js / run.js のみが呼ぶ(overview.js は参照のみ)
  - 各画面は先頭で`auth.js`の`requireAuth()`を通す

> **注意（2025 データ層改修後）**：このドキュメントの一部の関数名・流れは設計時の呼称のままです。
> データアクセス層（`db.js`）と「ケア/ラン状態の判定」「予定の書き込み」「同時編集の扱い」の
> 現状は **`function_relationships.md` の「改訂4」「同時編集の扱い」** を参照してください。
> 主な変更：`writeSchedules()`→`patchScheduleDay()` / `writeSchedulesMerge()`、
> `getHolidays()`/`getStore()`→`getStoreConfig()` / `subscribeStoreConfig()`、
> `overview.js`→`overviewView.js`、判定は `schedule.careOnDate()` / `runOnDate()`、
> 登録編集は `subscribeRabbit()`＋保存後 `reconcileDailyRecord()`。

---

## 0. ログインする

**実現したいこと**:パスワードを1つ入力するだけで各画面にアクセスできる。裏側ではFirestoreへの不正アクセスを防ぐ認証を行う。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `login.js` の `onLoginSubmit(inputPassword)` | パスワード入力フォームの送信を受け取る |
| 2 | `auth.js` の `login(inputPassword)` | `signInWithEmailAndPassword(STAFF_EMAIL, inputPassword)`。成功なら `{ ok: true }`、`auth/*` エラーなら `{ ok: false }` |
| 3 | (一致) `localStorage`に role を保存し `main.html` へ / (不一致) `signOut`して「パスワードが違います」 |

→ 以後、各画面の`requireAuth()`が「ログイン済みか」を見て、未ログインなら`login.html`へ戻す。Firestoreのセキュリティルールも同じく認証状態でアクセス可否を判定する。

## 1. ケア担当:項目をチェックする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` の `onCheckboxClick(rabbit, itemId, done)` | チェックボックスのクリックを受け取る |
| 2 | `dailyRecord.js` の `updateCareItem(storeId, rabbit, date, itemId, done)` | 該当項目の実施状況を書き換え、全項目完了かを自動判定 |
| 3 | `db.js` の `writeDailyRecord(storeId, rabbitId, date, data)` | うさぎ文書内の`dailyRecords.{date}.care`部分だけを部分更新 |

## 2. ケア担当:その日だけ項目を追加・削除する

**実現したいこと**:マスタには影響を与えず、今日の表示だけ調整する。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` の `onAddItemForToday(rabbit, itemId)`(セレクトで選択) / `onDeleteItemForToday(rabbit, itemId)`(「項目を編集」→「削除」ボタン) | 追加・削除操作を受け取る |
| 2 | `dailyRecord.js` の `addCareItemForToday(...)` / `removeCareItemForToday(...)` | その日の`dailyRecords`だけを書き換える(`careSchedule`本体は変更しない)。削除は即時 |
| 3 | `db.js` の `writeDailyRecord(...)` / `deleteCareItemForDate(...)` | Firestoreに書き込む |

## 3. ケア担当:全完了したらLINE送信済みにする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` の `onSwipeComplete(rabbit)`(全項目完了時に出る「LINE送信済みにする」ボタン) | 操作を受け取る |
| 2 | `dailyRecord.js` の `markCareLineSent(storeId, rabbit, date)` | ケアのLINE送信済みフラグを立てる |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む |

## 4. ラン担当:回数分チェックする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `run.js` の `onRunCheckToggle(rabbit, index, done)` | 何回目のチェックが押されたかを受け取る |
| 2 | `dailyRecord.js` の `updateRunCheck(storeId, rabbit, date, index, done)` | 実施済み回数(`doneCount`)を更新 |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込み（購読中の他画面へ自動反映） |

## 5. ラン担当:1回ごとにLINE送信済みにする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `run.js` の `onRunSwipeSent(rabbit, index)`(実施済みの行に出る「LINE送信」ボタン) | 何回目かを受け取る |
| 2 | `dailyRecord.js` の `markRunLineSent(storeId, rabbit, date, index)` | 送信済み回数(`sentCount`)を進める |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む |

## 6. ケアの完了状況が、ラン担当画面に自動で反映される(このアプリの核心)

**実現したいこと**:誰かが操作しなくても、他の画面が自動で最新状態になる。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` / `run.js` の起動時 | `db.js` の `subscribeActiveRabbits(storeId, callback)` を呼び、非表示でないうさぎ一覧(各うさぎの`dailyRecords`を含む)を購読開始 |
| 2 | (どちらかの画面で1〜5の操作が起きる) | Firestoreのうさぎ文書内の`dailyRecords`が更新される |
| 3 | `subscribeActiveRabbits()`のcallback | 購読している**すべての画面**で自動的に呼ばれ、`render()`で表示を更新する |

→ 新しい関数は不要。「同じコレクションを両方の画面が見続けている」だけで実現している。

## 7. 写真の管理(撮影・送信チェック)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `dailyRecord.js` の `getOrCreateDailyRecord(storeId, rabbit, date, holidays)`(記録作成時) | `photoSchedule`の指定があればそれを、無ければ `schedule.js` の `calculatePhotoNeeded(...)` を呼び、写真が必要な日かを自動判定して初期値をセット |
| 2 | `care.js` または `run.js` の `onPhotoCheck(rabbit, field, value)` | 「写真が必要」「撮影済み」「送信済み」チェックを受け取る |
| 3 | `dailyRecord.js` の `updatePhotoStatus(storeId, rabbit, date, field, value)` | 該当フラグ(`needed`/`taken`/`sent`)を更新(自動判定後も手動で上書き可能) |
| 4 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む |

## 8. うさぎの新規登録(ケア日の自動割り当て)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` の `goStep2()` | STEP1 入力を受け取り STEP2「予定を確認して登録」へ（予定表＋計列） |
| 2 | `db.js` の `getStoreConfig(storeId)` | 定休日・繁忙期・ケア項目を1回で取得(起動時に取得済み) |
| 3 | `scheduleGrid.js` の `buildEntry()` → `calculateDefaultCareDate(checkOutDate, holidays)` | お迎え日の1日前(定休日なら直近営業日)を既定ケア日に |
| 4 | `db.js` の `saveRabbit(storeId, { ...data, groupId, ...entryToSchedules(e) })` | `rabbits`に新規保存 |

**関連機能:+ボタンでもう一匹登録**

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` の `onAddAnotherRabbit()` | 飼い主情報などを残したままうさぎ名・備考だけ空にし、同じ`groupId`で続けて登録できるようにする |

**関連機能:宿泊全体の予定編集(編集モード)**

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` の `goStep2()` → `scheduleGrid.buildEntry()` / `renderStep2()` | STEP2：予定表（ケア/ラン/写真 × 滞在日）がメイン。ケア日2日以上なら `renderCareBreakdown()` が「項目ごとにどの日にやるか」を項目カード（日付チップ／±）で表示 |
| 2 | `register.js` の `onSave()` → `scheduleGrid.entryToSchedules()` → `db.writeSchedulesMerge(storeId, rabbitId, base, next)` | `runTransaction` 内で「利用者が変えた日だけ」を field path で保存（3-wayマージ） |
| 3 | 保存後、変えた日ごとに `dailyRecord.reconcileDailyRecord()` | 既存の当日記録を新しい予定に合わせる |
| - | `register.js` の `onHideRabbit()` → `db.js` の `hideRabbit(...)` | 宿泊終了(非表示)。`hiddenAt` と `expireAt` を書き込む |

## 9. 全体一覧画面(日付×うさぎの表)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `overviewView.js` 起動時 | `db.subscribeStoreConfig()` → `db.subscribeActiveRabbits()` で購読、`render()` で本日から7日ぶんループ |
| 2 | `overviewView.js` の `getCellStatus(rabbit, date, type)` | `schedule.careOnDate()` / `runOnDate()` で「予定」と「当日記録」を統合判定。未来日は予定だけを見る |

※一覧画面では`getOrCreateDailyRecord()`は**呼ばない**(未来日の記録を先に作らないため。記録生成はケア/ラン画面で当日ぶんのみ)。

## 10. 店長設定(マスタ・定休日・写真の一括編集)

`admin.js`は`requireAuth()`の後に`isManager()`を確認し、店長でなければ`main.html`へ戻す。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `admin.js` の `onUpdateCareItemsMaster()` | ケア項目マスタ(配列)の編集を受け取る |
| 2 | `db.js` の `updateCareItemsMaster(storeId, items)` | 店舗文書の`careItemsMaster`配列を上書き |
| - | `admin.js` の `onUpdateHolidays()` → `db.js` の `updateHolidays(storeId, { weekdays, dates })` | 定休日を更新 |
| - | `admin.js` の `onUpdatePhotoScheduleRange(needed)` → `db.js` の `updatePhotoScheduleRange(storeId, rabbitId, start, end, needed)` | 複数日まとめて写真要否を編集 |

これらは共通ロジック層(`schedule.js`/`dailyRecord.js`)を経由せず、`db.js`に直接繋がる(複雑な計算が不要なため)。

## 11. 過去の記録を参照する（宿泊終了ぶん・月ごと）

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `history.js` 起動時 | `db.getStoreConfig()` ＋ `db.getAllRabbits(storeId)`（購読はしない） |
| 2 | `history.js` の `‹ / ›` ボタン | 表示する月（`YYYY-MM`）を前後に切り替え。既定は今月、未来の月へは進めない |
| 3 | `history.js` の `render()` | **`schedule.isStayEnded(r)`**（`hiddenAt` あり or お迎え日 < 今日）かつその月に滞在期間が重なるうさぎだけを絞り、`overviewView.scheduleGridHTML(rabbits, その月の日付, ctx, { nameLink:false })` で全体一覧と同じ表を描く。**閲覧専用**（うさぎ名はリンクなし） |

※「宿泊終了」= `schedule.isStayEnded(r)`：`hiddenAt`（ボタン）あり、**または** お迎え日が今日より前（当日はまだ終了でない）。ボタンの押し忘れを日付でカバーする。
※ ケア担当／ラン担当は `subscribeAllRabbits`（終了ぶんも含む）。宿泊終了したうさぎも滞在期間の過去日を開けば記録が残って見える（`ensureRecords` は `isStayEnded` をスキップ＝新しい記録は作らない）。全体一覧は `subscribeActiveRabbits` のまま。
※ `hiddenAt` は TTL（6ヶ月後の自動削除）の起点も兼ねるので、「宿泊終了」ボタンを押す運用は残す。

## 12. 宿泊終了→自動削除(6ヶ月後)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js`(編集モード)の `onHideRabbit()` | 宿泊終了時、非表示にする操作を受け取る |
| 2 | `db.js` の `hideRabbit(storeId, rabbitId)` | `hiddenAt`(serverTimestamp)と、その約6ヶ月後の`expireAt`(Timestamp)を書き込む |
| 3 | (実行するプログラムは不要) | Firestoreが`expireAt`を過ぎた**うさぎの文書ごと**自動的に削除する(TTL)。`dailyRecords`がフィールド化されているため、消し残りが起きない |

※復旧用に`db.unhideRabbit()`があるが、現状UIには接続していない(コンソールから呼ぶ想定)。

---

## 全体像:機能とファイルの対応表

| 機能 | 主に使うファイル |
|---|---|
| ログイン | login.js → auth.js → db.js(getConfig) |
| 認証ガード | 全画面 → auth.js(requireAuth) |
| ケアのチェック・追加削除・LINE送信 | care.js → dailyRecord.js → db.js |
| ランのチェック・LINE送信 | run.js → dailyRecord.js → db.js |
| 他画面へのリアルタイム反映 | 全体一覧=subscribeActiveRabbits／ケア・ラン=subscribeAllRabbits／設定=subscribeStoreConfig／編集=subscribeRabbit |
| 写真管理 | run.js → dailyRecord.js → db.js(判定はschedule.js) |
| 新規登録・自動計算 | register.js → scheduleGrid.js / schedule.js → db.js |
| 宿泊全体の予定編集 | register.js → scheduleGrid.js → db.js(writeSchedulesMerge / runTransaction) → dailyRecord.reconcileDailyRecord |
| 全体一覧 | overviewView.js → db.js / 判定は schedule.careOnDate・runOnDate |
| 店長設定 | admin.js → db.js(直結) |
| 過去記録参照 | history.js → db.js(getAllRabbits) → hiddenAt ありだけを overviewView.scheduleGridHTML で月ごとに表示（閲覧専用）|
| 自動削除 | db.js(hideRabbit の書き込みのみ)+ Firestore TTL(削除は自動) |
| 初期セットアップ | (先に login.html でログイン) → setup.js → auth.js(requireLogin) → db.js(initConfig / initStore) |
