// アイコンは public/icons/<name>.svg（個別ファイル）を CSS の mask で表示する。
// 色は CSS の color から効く（.ico { background-color: currentColor }）。
// HTML では <span class="ico ico-<name>"></span> と直接書き、JS 生成部分ではこの icon() を使う。
//
// 使える name: chevron-left / chevron-right / menu / close / plus / help / caret / grip

export function icon(name, extraClass = "") {
  const cls = extraClass ? `ico ico-${name} ${extraClass}` : `ico ico-${name}`;
  return `<span class="${cls}" aria-hidden="true"></span>`;
}
