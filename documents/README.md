# うさぎホテル業務管理アプリ 実装用ドキュメント一覧

このフォルダは、実装を担当する方に渡すための設計資料一式です。上から順に読めば、要件→データ構造→処理の流れ→関数の役割まで把握できます。

> **注意（2026-09 時点）**：このフォルダは初期実装時点の設計資料で、その後の変更は反映していません。
> 現在の正は次のとおり：
> - セットアップ・セキュリティ・データ構造 … リポジトリ直下の `README.md`
> - 認証 … メール/パスワード（匿名認証は廃止）
> - `config/common` … `managerPassword` のみ（`commonPassword` は廃止）
> - テスト・純粋モジュール（`schedule.js` / `scheduleGrid.js` / `scheduleMerge.js` / `careReconcile.js`） … `tests/`
> - `setup.html` / `seed-stores.html` … **削除済み**。初期データ（`config/common` / `stores/{storeId}`）は
>   Firestoreコンソールから手動で作成する（詳細はリポジトリ直下の `README.md`「セットアップ手順」）

## 1. システム構成

- **技術**:Firebase(無料のSparkプランで運用)
- **Hosting**:アプリ画面(HTML/CSS/JS)を配信する
- **Firestore**:全データを保存する(Storageは使わない。写真ファイル自体は保存せず、状態フラグのみ管理)
- **認証**:匿名認証(Firebase Authentication)。共通パスワードが一致した時だけ、裏側で自動的にログインする。スタッフから見える操作は「パスワードを1つ入力するだけ」

## 2. Hostingに配置するファイル構成

設計時点のおおまかな構成は「画面ごとにHTML/JS 1組＋共通ロジック層（`auth.js` / `schedule.js` /
`scheduleGrid.js` / `dailyRecord.js`）＋データアクセス層（`db.js`）」という層分け。
**実際の全ファイル一覧・各ファイルの役割は増えており、正確な最新版はリポジトリ直下の `README.md`
「ファイル構成」を参照**（このドキュメント作成後に追加・削除されたファイルがあるため、ここでは重複させない）。

> 関数の引数・`db.js` の関数一覧・同時編集の扱いは `function_relationships.md` にまとめている。
> プロジェクト直下の `README.md` の「データ層と同時アクセス対策」も参照。

## 3. 関連ドキュメント

| ファイル名 | 内容 |
|---|---|
| `firestore_data_structure_final.md` | Firestoreのデータ構造(コレクション・フィールド設計) |
| `function_relationships.md` | ファイルごとの関数一覧・役割・呼び出し関係 |
| `feature_to_function_mapping.md` | 機能ごとに、どの関数がどの順番で動くか |
| `js_functions_diagram.mmd` / `js_diagram_source.dot` | 上記を1枚の図にまとめたソース(Mermaid記法 / Graphviz記法)。関数の詳細・引数は `function_relationships.md` を正とする |
| `js_functions_diagram.png` | `js_functions_diagram.mmd` から書き出した画像。更新時は `npx @mermaid-js/mermaid-cli -i js_functions_diagram.mmd -o js_functions_diagram.png -b white` で再生成 |
| `care_screen_wireframe.svg` / `run_screen_wireframe.svg` | 画面レイアウトの参考。**操作方式は実装と一部相違あり**:項目の追加/削除は「項目を編集」トグル＋ボタンに置き換えている。完了確定・LINE送信済みにする操作は図のとおりスワイプ(`swipe.js`)で実装(呼ぶ関数は資料どおり) |

## 4. 実装時に特に注意してほしい点

1. **`dailyRecords`はサブコレコレクションではなく、うさぎ文書内のフィールドとして持たせること**(6ヶ月後の自動削除で消し残りが起きるのを防ぐため)
2. **Firestoreのセキュリティルールで、ログイン(匿名認証)済みユーザーのみ読み書きを許可すること**(パスワード画面だけでは技術的な防御にならないため)
3. **Firestore TTLの設定**:`rabbits`コレクションの`expireAt`フィールドを対象にTTLポリシーを有効化すること(Firebaseコンソールから設定。追加のプログラムは不要)
4. **同時アクセス対策**:`dailyRecord.js`の`getOrCreateDailyRecord()`は、複数のスタッフが同時にアプリを開いても記録が重複作成されないよう、「存在しなければ作る」形の書き込み(マージ書き込み)にすること。
   予定の書き込みは日単位(`patchScheduleDay` = `arrayUnion`/`arrayRemove`、登録画面の保存 = `writeSchedulesMerge` の `runTransaction`)。詳細は `function_relationships.md` の「同時編集の扱い」。
