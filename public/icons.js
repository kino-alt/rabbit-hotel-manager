// アイコンは public/icons.svg（スプライト）に SVG シンボルとして持つ。
// currentColor なので色は CSS 側から効く。
// HTML では直接 <svg class="ico"><use href="/icons.svg#name" /></svg> と書き、
// JS 生成部分ではこの icon() を使う。

// 使える name: chevron-left / chevron-right / menu / close / plus / help / caret / grip

export function icon(name, extraClass = "") {
  const cls = extraClass ? `ico ${extraClass}` : "ico";
  return `<svg class="${cls}" aria-hidden="true"><use href="/icons.svg#${name}" /></svg>`;
}
