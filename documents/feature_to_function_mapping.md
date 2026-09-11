# 機能別:関数の役割と処理の流れ

このドキュメントは、「この機能はどう実現されているか」を、実際に動く関数の順番で追えるようにまとめたものです。
関数の引数・`db.js`の関数一覧・同時編集の扱いなど、より詳しい仕様は `function_relationships.md` を参照してください。

---

## 0. ログインする

**実現したいこと**:パスワードを1つ入力するだけで各画面にアクセスできる。裏側ではFirestoreへの不正アクセスを防ぐ認証を行う。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `login.js` の `onLoginSubmit(inputPassword)` | パスワード入力フォームの送信を受け取る |
| 2 | `auth.js` の `login(inputPassword)` | `signInWithEmailAndPassword(STAFF_EMAIL, inputPassword)`。成功なら `{ ok: true }`、`auth/*` エラー(パスワード違いなど)なら `{ ok: false }` |
| 3 | (成功) `main.html` へ遷移 / (失敗) 「パスワードが違います」と表示 |

→ 以後、各画面の`requireAuth()`が「メール/パスワードでログイン済みか」を見て、未ログインなら`login.html`へ戻す。Firestoreのセキュリティルールも同じく認証状態でアクセス可否を判定する。

## 1. ケア担当:項目をチェックする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` の `onCheckboxClick(rabbit, itemId, done)` / `onSetCareCount(rabbit, itemId, done)` | チェックボックスの操作を受け取る(通常項目/回数式項目) |
| 2 | `dailyRecord.js` の `updateCareItem(storeId, rabbit, date, itemId, done)` / `setCareCount(...)` | 該当項目の実施状況を書き換え、全項目完了かを自動判定 |
| 3 | `db.js` の `writeDailyRecord(storeId, rabbitId, date, data)` | うさぎ文書内の`dailyRecords.{date}.care`部分だけを部分更新 |

## 2. ケア担当:その日だけ項目を追加・削除する(「項目を編集」)

**実現したいこと**:マスタ(ケア項目一覧)には影響を与えず、その日1日だけ内容を調整する。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` の`renderCard()`内、追加セレクト／削除ボタン(×)のイベント | 追加・削除・回数変更の操作を受け取る |
| 2 | `dailyRecord.js` の `addCareToday()` / `removeCareToday()` / `setCareNeedToday(storeId, rabbit, date, itemId, need)` | その日の**予定**(`db.patchScheduleDay()` = `arrayUnion`/`arrayRemove`)と**当日記録**の両方を、その日だけ更新する(他の日には影響しない) |
| 3 | `db.js` の `patchScheduleDay(...)` / `writeDailyRecord(...)` | Firestoreに書き込む |

## 3. ケア:全完了したら「ケア完了」にする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` のカード左スワイプ(全項目チェック済み・未完了のときだけ出現) | 操作を受け取る |
| 2 | `dailyRecord.js` の `setCareDone(storeId, rabbit, date, true)` | ケア完了フラグ(`dailyRecords.{date}.care.done`)を立てる |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む |

## 4. LINE送信済みにする(ケア・ランどちらもラン担当画面で管理)

**実現したいこと**:飼い主へのLINE送信が済んだかを記録する。ケア分・ラン分どちらも `run.js` に集約されている。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `run.js` のカードのスワイプ(ケア完了済み行 / ラン実施済み行) | 送信操作を受け取る |
| 2 | `dailyRecord.js` の `markCareLineSent()` / `onRunSend()`→`markRunLineSent(storeId, rabbit, date, index)` | 送信済みフラグ・送信済み回数を更新。取消は `unmarkCareLineSent()` / `onRunUndo()`→`unmarkRunLineSent()` |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む(購読中の他画面へ自動反映) |

## 5. ラン担当:回数分チェックする

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `run.js` の `onRunCheckToggle(rabbit, index, done)` | 何回目のチェックが押されたかを受け取る |
| 2 | `dailyRecord.js` の `updateRunCheck(storeId, rabbit, date, index, done)` | 実施済み回数(`doneCount`)を更新 |
| 3 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込み(購読中の他画面へ自動反映) |

## 6. ケアの完了状況が、ラン担当画面に自動で反映される(このアプリの核心)

**実現したいこと**:誰かが操作しなくても、他の画面が自動で最新状態になる。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `care.js` / `run.js` の起動時 | `db.js` の `subscribeAllRabbits(storeId, callback)` を呼び、宿泊終了ぶんも含むうさぎ一覧(各うさぎの`dailyRecords`を含む)を購読開始 |
| 2 | (どちらかの画面で1〜5の操作が起きる) | Firestoreのうさぎ文書内の`dailyRecords`が更新される |
| 3 | `subscribeAllRabbits()`のcallback | 購読している**すべての画面**で自動的に呼ばれ、`render()`で表示を更新する |

→ 新しい関数は不要。「同じ文書を両方の画面が見続けている」だけで実現している。

## 7. 写真の管理(撮影・送信チェック)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `dailyRecord.js` の `getOrCreateDailyRecord(...)`(記録作成時) | `schedule.js` の `calculatePhotoNeeded(...)` を呼び、写真が必要な日かを自動判定して初期値をセット(繁忙期は不要) |
| 2 | `run.js` の `onPhotoCheck(rabbit, field, value)` | 「必要」「撮影済み」「送信済み」チェックを受け取る |
| 3 | `dailyRecord.js` の `updatePhotoStatus(storeId, rabbit, date, field, value)` | 該当フラグ(`needed`/`taken`/`sent`)を更新(自動判定後も手動で上書き可能) |
| 4 | `db.js` の `writeDailyRecord(...)` | Firestoreに書き込む |

## 8. うさぎの新規登録(ケア日の自動割り当て)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` の `goStep2()` | STEP1入力を受け取りSTEP2(滞在期間グリッド)へ |
| 2 | `db.js` の `getStoreConfig(storeId)` | 定休日・繁忙期・ケア項目を1回で取得(起動時に取得済み) |
| 3 | `scheduleGrid.js` の `buildEntry()` → `schedule.js` の `calculateDefaultCareDate(checkOutDate, holidays)` | お迎え日の1日前(定休日なら直近営業日)を既定ケア日に |
| 4 | `register.js` の `onSave()` → `scheduleGrid.js` の `entryToSchedules(entry)` → `db.js` の `saveRabbit(storeId, { ...data, groupId, ...schedules })` | `rabbits`に新規保存 |

**関連機能:+ボタンでもう一匹登録**

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` の `onAddAnother()` | 飼い主情報などを残したままうさぎ名・備考だけ空にし、同じ`groupId`で続けて登録できるようにする |

**関連機能:宿泊全体の予定編集(編集モード)**

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `register.js` 起動時 | `db.js` の `subscribeRabbit(storeId, editId, cb)` で最新を保持しつつSTEP1・STEP2を組み立てる |
| 2 | `register.js` の `renderStep2()` / `renderCareBreakdown()` | STEP2:予定表(ケア/ラン × 滞在日)。ケア日2日以上なら項目ごとの内訳(日付チップ／±)も表示 |
| 3 | `register.js` の `onSave()` → `scheduleGrid.js` の `entryToSchedules()` → `db.js` の `writeSchedulesMerge(storeId, rabbitId, base, next)` | `runTransaction`内で「利用者が変えた日だけ」をfield pathで保存(3-wayマージ) |
| 4 | 保存後、変えた日ごとに `dailyRecord.js` の `reconcileDailyRecord()` | 既存の当日記録を新しい予定に合わせる |
| - | `register.js` の `onHideRabbit()` → `db.js` の `hideRabbit(...)` | 宿泊終了(非表示)。`hiddenAt`と`expireAt`を書き込む |

## 9. 全体一覧画面(日付×うさぎの表)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `overviewView.js` の `initOverview()`(main.jsから呼ばれる) | `db.subscribeStoreConfig()` → `db.subscribeActiveRabbits()` で購読、本日から7日ぶんを`scheduleGridHTML()`で描画 |
| 2 | `overviewView.js` の `getCellStatus(rabbit, date, type, ...)` | `schedule.js` の `careOnDate()` / `runOnDate()` で「予定」と「当日記録」を統合判定。未来日は予定だけを見る |

※一覧画面では`getOrCreateDailyRecord()`は**呼ばない**(未来日の記録を先に作らないため。記録生成はケア/ラン画面で当日ぶんのみ)。

## 10. 店長設定(ケア項目マスタ・定休日・繁忙期)

`admin.js`は`requireAuth()`(ログイン確認)の後、**設定パスワード**(`verifyManagerPassword()`)を別途要求する。「店長ロール」による制限はなく、パスワードを知っていれば誰でも開ける(1回通ればそのタブでは`sessionStorage`により再入力不要)。

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `admin.js` の `saveItems()`(項目の入力・チェックを変更/並べ替え時に自動保存) | `db.js` の `updateCareItemsMaster(storeId, items)` | ケア項目マスタ(配列)を上書き |
| 2 | `admin.js` の `saveHolidays()` → `db.js` の `updateHolidays(storeId, { weekdays, dates })` | 定休日を更新 |
| 3 | `admin.js` の `saveBusy()` → `db.js` の `updateBusyPeriods(storeId, periods)` | 繁忙期を更新(期間中は全うさぎ写真「不要」)。過去に終わった期間は読み込み時に自動で取り除く |

これらは共通ロジック層(`schedule.js`/`dailyRecord.js`)を経由せず、`db.js`に直接繋がる(複雑な計算が不要なため)。

## 11. 過去の記録を参照する(宿泊終了ぶん・月ごと)

| 順番 | ファイル.関数 | 役割 |
|---|---|---|
| 1 | `history.js` 起動時 | `db.getStoreConfig()` ＋ `db.getAllRabbits(storeId)`(購読はしない) |
| 2 | `history.js` の `‹ / ›` ボタン | 表示する月(`YYYY-MM`)を前後に切り替え。既定は今月、未来の月へは進めない |
| 3 | `history.js` の `render()` | `schedule.isStayEnded(r)`(`hiddenAt`あり or お迎え日 < 今日)かつその月に滞在期間が重なるうさぎだけを絞り、`overviewView.scheduleGridHTML(rabbits, その月の日付, ctx, { nameLink:false })`で全体一覧と同じ表を描く。**閲覧専用**(うさぎ名はリンクなし) |

※「宿泊終了」= `schedule.isStayEnded(r)`:`hiddenAt`(ボタン)あり、**または**お迎え日が今日より前(当日はまだ終了でない)。ボタンの押し忘れを日付でカバーする。
※ケア担当/ラン担当は`subscribeAllRabbits`(終了ぶんも含む)。宿泊終了したうさぎも滞在期間の過去日を開けば記録が残って見える(`ensureRecords`は`isStayEnded`をスキップ＝新しい記録は作らない)。全体一覧は`subscribeActiveRabbits`のまま。
※`hiddenAt`はTTL(6ヶ月後の自動削除)の起点も兼ねるので、「宿泊終了」ボタンを押す運用は残す。

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
| ケアのチェック・追加削除 | care.js → dailyRecord.js → db.js |
| ランのチェック | run.js → dailyRecord.js → db.js |
| LINE送信(ケア・ラン) | run.js → dailyRecord.js(markCareLineSent / markRunLineSent) → db.js |
| 他画面へのリアルタイム反映 | 全体一覧=subscribeActiveRabbits／ケア・ラン=subscribeAllRabbits／設定=subscribeStoreConfig／編集=subscribeRabbit |
| 写真管理 | run.js → dailyRecord.js → db.js(判定はschedule.js) |
| 新規登録・自動計算 | register.js → scheduleGrid.js / schedule.js → db.js |
| 宿泊全体の予定編集 | register.js → scheduleGrid.js → db.js(writeSchedulesMerge / runTransaction) → dailyRecord.reconcileDailyRecord |
| 全体一覧 | overviewView.js → db.js / 判定は schedule.careOnDate・runOnDate |
| 店長設定(設定パスワードで保護) | admin.js → db.js(直結) |
| 過去記録参照 | history.js → db.js(getAllRabbits) → hiddenAtありだけをoverviewView.scheduleGridHTMLで月ごとに表示(閲覧専用) |
| 自動削除 | db.js(hideRabbitの書き込みのみ)+ Firestore TTL(削除は自動) |
| 初期セットアップ(`config/common` / `stores/{storeId}`の作成) | アプリの画面は無し。Firestoreコンソールから手動で作成(README参照) |
