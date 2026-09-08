// 小さなインラインSVGアイコン。フォント依存の文字グリフ（⠿ ▲▼ など）の置き換え用。
// 色は currentColor なので CSS 側から効く。返すのは innerHTML に入れる文字列。

// 並べ替えハンドル（6点グリップ）
export function grip() {
  const dots = [4, 8, 12]
    .map((y) => `<circle cx="6" cy="${y}" r="1.35"/><circle cx="10" cy="${y}" r="1.35"/>`)
    .join("");
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">${dots}</svg>`;
}

// 開閉キャレット（下向き。開いているときは CSS で 180° 回転させる）
export function caret() {
  return (
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 6l4 4 4-4"/></svg>'
  );
}
