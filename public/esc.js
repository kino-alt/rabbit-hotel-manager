// HTML エスケープ（テキスト・属性値の埋め込み共用）。
const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => MAP[c]);
}
