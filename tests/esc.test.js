import { test } from "node:test";
import assert from "node:assert/strict";

import { esc } from "../public/esc.js";

test("esc: HTML特殊文字を実体参照に変換", () => {
  assert.equal(esc('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.equal(esc("山田さん"), "山田さん");
  assert.equal(esc(""), "");
});

test("esc: 文字列以外は String() 化してから処理", () => {
  assert.equal(esc(42), "42");
  assert.equal(esc(null), "null");
  assert.equal(esc(undefined), "undefined");
});
