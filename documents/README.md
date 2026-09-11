# 補足資料

このフォルダには、実装の詳細を知りたいときに読む補足資料が入っています。
アプリの機能・仕組み・セットアップ方法は、まずリポジトリ直下の `README.md` を読んでください。

| ファイル名 | 内容 |
|---|---|
| `firestore_data_structure_final.md` | Firestoreのデータ構造の設計メモ(なぜこの形にしたか・検討して採用しなかった案) |
| `function_relationships.md` | ファイルごとの関数一覧・役割・呼び出し関係 |
| `feature_to_function_mapping.md` | 機能ごとに、どの関数がどの順番で動くか |
| `js_functions_diagram.mmd` / `js_diagram_source.dot` | 上記を1枚の図にまとめたソース(Mermaid記法 / Graphviz記法) |
| `js_functions_diagram.png` | `js_functions_diagram.mmd` から書き出した画像。更新時は `npx @mermaid-js/mermaid-cli -i js_functions_diagram.mmd -o js_functions_diagram.png -b white` で再生成 |
| `care_screen_wireframe.svg` / `run_screen_wireframe.svg` | 画面レイアウトの参考(初期の下書き。操作方式は一部実装と異なる) |
