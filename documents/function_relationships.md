# 関数構成・呼び出し関係(最終設計・改訂4)

> 初期実装時点の資料。改訂4（2026-09）の要点を以下に反映済み。詳細な現状は `README.md`。

## 改訂4(2026-09・運用開始後の見直し)

- **認証**：匿名認証を廃止。`auth.login()` は `signInWithEmailAndPassword(STAFF_EMAIL, 入力パスワード)`。
  `signInAnonymously()` は削除。setup/seed は `requireLogin()`（先にログインしてから開く）。
  role の概念は縮小（ログインは常に "staff"。設定画面は `verifyManagerPassword()` が別ゲート）。
  `auth.changeStaffPassword()` を追加（設定画面からログインパスワード変更）。
- **廃止**：`db.bumpTotals()` と `careTotals` / `runTotal`（どの画面も未参照・非アトミック）。
- **切り出し（純粋モジュール、テスト対象）**：`scheduleMerge.js`（3-wayマージ）、`careReconcile.js`
  （`reconcileCare` / `computeAllDone`）、`esc.js`、`swipe.js`、`icons.js`、`toast.js`、`vendor.js`（Firebase SDK の唯一の入口）。
- `register.js`：登録時に `staffName`（担当スタッフ名）を入力・保存。

## 改訂内容

### 改訂2まで

- `dailyRecords`をサブコレクションからフィールドに変更したことに伴い、`db.js`の関数を更新(`getDailyRecordsRange()`を削除、`subscribeDailyRecord()`の説明を修正)
- 匿名認証を追加したことに伴い、新しいファイル`auth.js`を追加

### 改訂3(実装に合わせて反映)

- `dailyRecord.js`の各関数の引数を実装に合わせて修正
  (`(rabbitId, date, ...)` → `(storeId, rabbit, date, ...)`。購読中のうさぎ文書と店舗設定を渡し、Firestoreの読み取り回数を減らすため)
- `db.js`に実装済みの関数を追加
  (`getRabbit` / `subscribeActiveRabbits` / `getAllRabbits` / `bumpTotals` / `deleteCareItemForDate` /
   `writeSchedules` / `unhideRabbit` / `getStore` / `subscribeStore` / `getConfig` / `initConfig` / `initStore`)
- `auth.js`に`getRole` / `isManager` / `requireAuth` / `logout`を追加。`login()`は role(manager / staff)を返す
- ケア/ラン/一覧画面は`subscribeRabbit`(単体)ではなく`subscribeActiveRabbits`(一覧購読)を使う
- `getOrCreateDailyRecord()`の呼び出し元は care.js / run.js のみ(overview.js は記録を生成せず参照のみ)
- `removeCareItemForToday()`は即時削除(「一定時間保持」はしない)
- 初期セットアップ画面`setup.html` / `setup.js`、担当選択の`main.js`を追加

### 改訂4(連携・保守性の改修 ― 詳細は `data_sync.md`)

- **店舗設定の一括取得・購読**:`getStore()`を3回呼んでいた箇所を`getStoreConfig()`(1回)に統一。
  ケア/ラン/全体一覧は`subscribeStoreConfig()`で購読し、設定画面での変更が即反映される。
  `getHolidays()` / `getBusyPeriods()` / `subscribeStore()`は廃止(役割は上記2つへ)。
- **予定の書き込みを日単位・アトミックに**:マップ丸ごと置換の`writeSchedules()`を廃止。
  - `patchScheduleDay()` … ケア担当「項目を編集」用。`arrayUnion`/`arrayRemove`で1項目ずつ
  - `writeSchedulesMerge(base, next)` … 登録画面の保存用。`runTransaction`内で
    「利用者が変えた日 ∧ まだサーバがその値でない日」だけを field path で書く3-wayマージ
- **判定ロジックの一本化**:「その日のケア/ラン状態」の判定を`schedule.js`の
  `careOnDate()` / `runOnDate()`に集約。overview / care / run はこれだけを見る。
- **グリッド描画の共用**:`overviewView.js` に `scheduleGridHTML(rabbits, dates, ctx, opts)` を
  切り出し、全体一覧（本日から7日）と過去の記録（history.js。月ごと・宿泊終了ぶんも表示）で共用。
- **登録画面(register.js)**:`getRabbit()`(1回)→`subscribeRabbit()`(購読)。
  編集中に他端末が更新したら、未編集ならグリッドを静かに作り直し、編集中なら通知＋「作り直す」ボタン。
  保存後は影響した日の既存`dailyRecords`を`reconcileDailyRecord()`で予定に合わせる。
- **STEP2 グリッドの変換ロジック**を`scheduleGrid.js`(DOM非依存)へ分離
  (`buildEntry` / `entryToSchedules` / `careScheduleShape` ほか)。
- `db.getRabbit()`は現在どこからも呼ばれない(単発取得プリミティブとして残置)。

## 層の役割

| 層 | ファイル | 役割 |
|---|---|---|
| 画面層 | login.js / main.js / care.js / run.js / register.js / overviewView.js / admin.js / history.js / setup.js | 画面の表示・ボタンやチェックボックスの操作を受け取る |
| 共通ロジック層 | schedule.js / scheduleGrid.js / dailyRecord.js / auth.js | 日付計算・ケア/ラン状態の判定・当日記録の作成・登録STEP2の変換・認証 |
| データアクセス層 | db.js | Firestoreへの実際の読み書きをまとめる薄い層 |
| データ本体 | Firestore | 実データ(前回まとめたデータ構造) |

**方針**:画面層は直接Firestoreを触らない。必ず共通ロジック層かデータアクセス層を経由する。

---

## auth.js(共通ロジック層)

| 関数名 | 役割 | 呼び出し元 |
|---|---|---|
| `login(inputPassword)` | `signInWithEmailAndPassword(STAFF_EMAIL, inputPassword)`。成功なら `{ ok: true }`、`auth/*` エラー（パスワード違い等）なら `{ ok: false }` | login.js |
| `verifyManagerPassword(pw)` | `db.getConfig()` で `config/common.managerPassword` を読み、設定画面を開くときの2段階目を照合 | admin.js |
| `changeStaffPassword(cur, next)` | 今のパスワードで再認証してから `updatePassword`。設定画面の「ログインパスワード」欄 | admin.js |
| `requireAuth(onReady)` | 各画面の先頭で呼ぶ。`onAuthStateChanged` で未ログイン（または匿名）を検知したら `login.html` へ飛ばし、ログイン済みなら `onReady(user)` を実行 | login.js以外の全画面 |
| `requireLogin(onReady, onMissing)` | setup / seed-stores 用。ログイン済みなら `onReady`、未ログインなら `onMissing`（先に login.html でログインする案内） | setup.js / seed-stores.js |
| `logout()` | `signOut` して `login.html` へ戻す | main.js |

## schedule.js(共通ロジック層)

| 関数名 | 役割 | 呼び出し元 |
|---|---|---|
| `calculateDefaultCareDate(pickupDate, holidays)` | お迎え日の1日前を計算し、定休日なら直近の営業日まで遡る | scheduleGrid.js(`buildEntry`) |
| `calculatePhotoNeeded(date, careSchedule, runSchedule, holidays, busyPeriods)` | 写真が必要な日かを自動判定(繁忙期・定休日でなく、ケア・ラン予定がともにない日) | dailyRecord.js / overview.js / run.js / register.js |
| `careOnDate(rabbit, date, countableIds)` | その日のケア状態を「予定(careSchedule/careCounts)」と「当日記録」から統合して返す(`exists` / `done` / `lineSent` / `plannedPlain` / `recCount` ほか)。**画面はこれだけを見る** | overview / care / run |
| `runOnDate(rabbit, date)` | その日のラン状態(`need` = max(予定, 実施, 送信) / `done` / `sent` / `exists`) | overview / run |
| `isStayEnded(rabbit, today?)` | 宿泊終了か。`hiddenAt` あり **または** お迎え日が今日より前（当日はまだ終了でない）。「宿泊終了」ボタンの押し忘れを日付でカバーする | care.js / run.js / history.js |
| `isBusyPeriod(date, busyPeriods)` / `countableIdSet(careMaster)` | 繁忙期判定 / 回数式ケア項目IDの集合づくり | 各画面 / schedule.js内部 |
| `toISO` / `parseISO` / `addDays` / `todayISO` / `eachDate` / `formatJP` / `dayWd` / `isHoliday` | 日付ユーティリティ | 各画面 / schedule.js内部 |

## scheduleGrid.js(共通ロジック層 ― 登録画面STEP2専用)

DOMに触れない。STEP2グリッドの作業データ(`entry`)と Firestore形式(`careSchedule`/`careCounts`/`runSchedule`)を相互変換する。

| 関数名 | 役割 | 呼び出し元 |
|---|---|---|
| `buildEntry(shared, card, prev, ctx)` | STEP1入力 ＋(直前の作業 or 既存うさぎ)から`entry`を組み立てる。`ctx = { countableIds, holidays, prevRabbit }` | register.js(`rebuildGridEntries`) |
| `entryToSchedules(entry)` | `entry` → `{ careSchedule, careCounts, runSchedule }`(中身の無い日は含めない) | register.js(`onSave`) |
| `careScheduleShape` / `normalItemsOnDay` / `brushUnitsOnDay` / `careUnitsOnDay` | グリッドの集計ヘルパー | register.js / scheduleGrid.js内部 |

## dailyRecord.js(共通ロジック層)

各関数は購読中の`rabbit`文書(最新スナップショット)を受け取り、新しい値を計算して`db.js`経由で
うさぎ文書内の`dailyRecords.{date}`を部分更新する。

| 関数名 | 役割 | 呼び出し元 |
|---|---|---|
| `getOrCreateDailyRecord(storeId, rabbit, date, holidays, busyPeriods, countableIds)` | その日の記録が無ければ予定からコピーして新規作成。既にあれば、ラン回数と「予定に増えたケア項目」を追随させる(実施済みは保持、**削除はしない**)。写真要否は`photoSchedule`優先、無ければ`calculatePhotoNeeded()` | care.js / run.js(`ensureRecords`) |
| `reconcileDailyRecord(storeId, rabbit, date, countableIds)` | **既存の**当日記録を予定へ完全に合わせる(増えた項目は追加、外れた未実施項目は削除、実施済み・done・lineSentは保持)。記録が無い日は何もしない | register.js(保存直後・変えた日だけ) |
| `updateCareItem` / `setCareCount` | ケア項目1つの実施(チェック / 回数)を更新し全完了を自動判定 | care.js |
| `addCareToday` / `removeCareToday` / `setCareNeedToday` | ケア担当「項目を編集」。その日の**予定**(`db.patchScheduleDay()` = `arrayUnion`/`arrayRemove` 等)と**当日記録**の両方を直す | care.js |
| `addCareItemForToday` / `removeCareItemForToday` | その日の**当日記録だけ**にケア項目を足す/消す(予定は変えない) | dailyRecord.js内部(上記から) |
| `setCareDone(storeId, rabbit, date, value)` | ケア:「ケア完了」(◐)の設定/取消 | care.js |
| `markCareLineSent` / `unmarkCareLineSent` | ケア:LINE送信済み(●)の設定/取消 | run.js |
| `updateRunCheck` / `markRunLineSent` / `unmarkRunLineSent` | ランの実施回数・LINE送信済みを更新 | run.js |
| `updatePhotoStatus(storeId, rabbit, date, field, value)` | 写真の`needed`/`taken`/`sent`のいずれかを更新 | run.js |

## db.js(データアクセス層)

| 関数名 | 役割 | 呼び出し元 |
|---|---|---|
| `getConfig()` | `config/common`(共通・店長パスワード)を取得 | auth.js / setup.js |
| `saveRabbit(storeId, data)` | うさぎの新規登録・編集を保存(`data.id`があれば更新、なければ新規) | register.js |
| `getRabbit(storeId, rabbitId)` | うさぎ文書1件を一度だけ取得 | (現在未使用・プリミティブとして残置) |
| `subscribeRabbit(storeId, rabbitId, callback)` | うさぎ文書1件をリアルタイム購読(`onSnapshot`)。1購読で予定・実績の両方が取れる | register.js(編集画面) |
| `subscribeActiveRabbits(storeId, callback)` | `hiddenAt == null`のうさぎ一覧をリアルタイム購読 | overviewView.js（全体一覧） |
| `subscribeAllRabbits(storeId, callback)` | 宿泊終了ぶんも含めた全うさぎをリアルタイム購読（`_placeholder`は除外） | care.js / run.js |
| `getAllRabbits(storeId)` | 非表示分も含めた全うさぎを一度だけ取得 | history.js（`hiddenAt`ありだけに絞って月ごと表示） |
| `writeDailyRecord(storeId, rabbitId, date, data)` | `dailyRecords.{date}`をマージ書き込み | dailyRecord.js |
| `patchRabbit(storeId, rabbitId, fieldPatch)` | うさぎ文書の field path をまとめて`updateDoc`する低レベル関数 | dailyRecord.js(`reconcileDailyRecord`) |
| `deleteCareItemForDate` / `deleteCareCountForDate` | その日の当日記録から1項目を`deleteField()`で削除 | dailyRecord.js |
| `patchScheduleDay(storeId, rabbitId, ops)` | 予定を1項目/1日単位で更新。`addCareItem`/`removeCareItem`は`arrayUnion`/`arrayRemove`、`setCareCount`/`setRunCount`は field path | dailyRecord.js(`addCareToday`ほか) |
| `writeSchedulesMerge(storeId, rabbitId, base, next)` | 登録画面の保存。`runTransaction`内で最新値を読み、「利用者が変えた ∧ サーバがまだその値でない」日だけを書く3-wayマージ。戻り値は書き込んだ field path 配列 | register.js(`onSave`) |
| `hideRabbit` / `unhideRabbit` | `hiddenAt` / `expireAt`(Firestore TTL起点)の設定・解除 | register.js / (復旧用) |
| `getStoreConfig(storeId)` | 店舗設定を**1回の読み取り**で `{ careItemsMaster, holidays, busyPeriods }` にして返す | register.js / admin.js |
| `subscribeStoreConfig(storeId, callback)` | 同じ形をリアルタイム購読。設定画面の変更が即反映 | care.js / run.js / overview.js |
| `getCareItemsMaster(storeId)` | ケア項目マスタを`order`順で取得 | history.js / seed-stores.js |
| `updateCareItemsMaster` / `updateHolidays` / `updateBusyPeriods` | 店舗設定の各フィールドを上書き保存 | admin.js |
| `initConfig` / `initStore` | 初期セットアップ用の初回作成 | setup.js |

**廃止した関数**:
- `getDailyRecordsRange()` ― `dailyRecords`のフィールド化で不要
- `writeSchedules()` ― マップ丸ごと置換をやめ、`patchScheduleDay()` / `writeSchedulesMerge()` に分割
- `getHolidays()` / `getBusyPeriods()` / `subscribeStore()` ― `getStoreConfig()` / `subscribeStoreConfig()` に統合

---

## 呼び出し関係の具体例

**例:ログインする**

```
login.js の onLoginSubmit()
    → auth.js の login(inputPassword)
        → signInWithEmailAndPassword(STAFF_EMAIL, inputPassword)
    → 成功なら main.html へ遷移
```

**例:各画面を開く(認証ガード)**

```
care.js / run.js / overview.js / register.js / admin.js / history.js / main.js
    → auth.js の requireAuth(onReady)
        → 未ログインなら login.html へ
        → ログイン済みなら onReady() で画面の初期化を実行
```

**例:ケア担当がチェックを入れる**

```
care.js の onCheckboxClick()
    → dailyRecord.js の updateCareItem(STORE_ID, rabbit, date, itemId, done)
        → db.js の writeDailyRecord()(dailyRecords.{date}.care を部分更新)
            → (他画面が購読中のため自動的に反映される)
    → 失敗時は toast.js の notifyWriteError() で画面に通知
```

**例:うさぎを新規登録する**

```
register.js
    起動時 → db.js の getStoreConfig()(careItemsMaster / holidays / busyPeriods を1回で)
    STEP2  → scheduleGrid.js の buildEntry()(entry を組み立て)
    保存   → scheduleGrid.js の entryToSchedules(entry)
           → db.js の saveRabbit(STORE_ID, { ...data, groupId, ...schedules })
```

**例:うさぎを編集する(既存)**

```
register.js
    起動時 → db.js の subscribeRabbit(STORE_ID, editId, cb)  ← 1回きりの getRabbit ではない
             初回     : フォーム・STEP1 を埋める
             以降     : loadedRabbit を最新に保つ。STEP2 表示中は
                        未編集ならグリッドを作り直し、編集中なら「作り直す」ボタンを出す
    保存   → db.js の writeSchedulesMerge(STORE_ID, editId, baseSchedules, next)  ← runTransaction
           → 変えた日ごとに dailyRecord.js の reconcileDailyRecord()(既存記録を予定へ)
```

**例:過去の記録を参照する（月ごと・全体一覧と同じグリッド）**

```
history.js
    起動時 → db.js の getStoreConfig() + getAllRabbits()
    月切替 → render()：その月に滞在期間が重なる「宿泊終了（hiddenAt あり）」の
             うさぎだけを絞り、overviewView.js の
             scheduleGridHTML(rabbits, その月の日付, ctx, { nameLink:false }) で
             全体一覧と同じ表を描く。閲覧専用（うさぎ名は編集画面へ飛ばない）
```

**うさぎの表示範囲と「宿泊終了」の判定**

「宿泊終了」= `schedule.isStayEnded(r)` … `hiddenAt` あり **または** お迎え日 < 今日
（お迎え日“当日”はまだ終了ではない）。ボタンを押し忘れても、翌日には自動で終了扱いになる。

| 画面 | 購読 | 宿泊終了の扱い |
|---|---|---|
| 全体一覧 | `subscribeActiveRabbits`（`hiddenAt == null`） | `hiddenAt` ぶんは出ない。お迎え日超過ぶんも表示範囲（本日〜7日）の日付フィルタで自然に消える |
| ケア担当 / ラン担当 | `subscribeAllRabbits`（終了ぶんも取得） | **残る**。滞在期間の過去日を開けばその記録が見える（今日には出ない＝日付フィルタ）。`ensureRecords` は `isStayEnded(r)` をスキップ（新しい記録は作らない） |
| 過去の記録 | `getAllRabbits` → `isStayEnded(r)` だけに絞る | **ここが終了ぶんの一覧**。月ごと・閲覧専用 |

※ `hiddenAt`（「宿泊終了」ボタン）は TTL（`expireAt` = 6ヶ月後の自動削除）の起点も兼ねる。
お迎え日超過だけで `hiddenAt` を書かない場合、その文書は自動削除の対象にならない（表示上は終了扱い）。

---

## 同時編集の扱い(2025 改修後)

| 操作 | 競合耐性 |
|---|---|
| ケア/ラン実施チェック(`writeDailyRecord` merge) | フィールド単位マージ。別項目の同時更新は安全 |
| ケア担当「項目を編集」(`patchScheduleDay`) | `arrayUnion`/`arrayRemove`。同じ日に別項目を足しても取りこぼさない |
| 登録画面の保存(`writeSchedulesMerge`) | `runTransaction` ＋ 3-wayマージ(base / server / next)。別の日・同じ結論には触れない |
| `saveRabbit` のスカラー項目(氏名・日程など) | 最後の書き込みが勝つ(低リスクのため許容) |
| 同じうさぎ・同じ日を2人が同時に別内容へ編集 | 最後が勝つ(セマンティックな衝突。トランザクションでも解決しない) |
