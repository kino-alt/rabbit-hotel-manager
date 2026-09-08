import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAllDone, reconcileCare } from "../public/careReconcile.js";

test("computeAllDone: 空は完了扱い", () => {
  assert.equal(computeAllDone({}, {}), true);
  assert.equal(computeAllDone(null, null), true);
});

test("computeAllDone: 通常項目は全 true で完了", () => {
  assert.equal(computeAllDone({ a: true, b: true }, {}), true);
  assert.equal(computeAllDone({ a: true, b: false }, {}), false);
});

test("computeAllDone: 回数式は done>=need で完了", () => {
  assert.equal(computeAllDone({}, { x: { need: 2, done: 2 } }), true);
  assert.equal(computeAllDone({}, { x: { need: 2, done: 1 } }), false);
  assert.equal(computeAllDone({ a: true }, { x: { need: 1, done: 1 } }), true);
});

test("reconcileCare: 予定に増えた通常項目を done=false で追加", () => {
  const r = reconcileCare({ items: {}, counts: {} }, ["a"], {}, new Set(), false);
  assert.deepEqual(r.items, { a: false });
  assert.equal(r.changed, true);
});

test("reconcileCare: 予定に増えた回数式項目を追加し、need を追随", () => {
  const r = reconcileCare({ items: {}, counts: {} }, ["x"], { x: 3 }, new Set(["x"]), false);
  assert.deepEqual(r.counts, { x: { need: 3, done: 0 } });
  assert.equal(r.changed, true);

  const r2 = reconcileCare({ counts: { x: { need: 1, done: 0 } } }, ["x"], { x: 3 }, new Set(["x"]), false);
  assert.equal(r2.counts.x.need, 3);
  assert.equal(r2.changed, true);
});

test("reconcileCare: removeUnfulfilled=false なら予定外でも消さない", () => {
  const r = reconcileCare({ items: { a: true, b: false } }, ["a"], {}, new Set(), false);
  assert.deepEqual(r.items, { a: true, b: false });
  assert.equal(r.changed, false);
});

test("reconcileCare: removeUnfulfilled=true は予定外の未実施だけ消す", () => {
  const r = reconcileCare({ items: { a: true, b: false } }, ["a"], {}, new Set(), true);
  assert.deepEqual(r.items, { a: true }); // b(未実施)は消える、a(実施済み)は残る
  assert.equal(r.changed, true);
});

test("reconcileCare: 実施済みの回数式は予定から外れても残す", () => {
  const r = reconcileCare(
    { items: {}, counts: { x: { need: 2, done: 1 } } },
    [], {}, new Set(["x"]), true,
  );
  assert.deepEqual(r.counts, { x: { need: 2, done: 1 } });
  assert.equal(r.changed, false);
});

test("reconcileCare: 変更が無ければ changed=false", () => {
  const r = reconcileCare({ items: { a: false }, counts: {} }, ["a"], {}, new Set(), true);
  assert.equal(r.changed, false);
});
