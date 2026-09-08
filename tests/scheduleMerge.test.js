import { test } from "node:test";
import assert from "node:assert/strict";

import { computeSchedulePatch, DELETE } from "../public/scheduleMerge.js";

test("base と next が同じなら何も書かない", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"] } },
    { careSchedule: { d1: ["a"] } },
    { careSchedule: { d1: ["a"] } },
  );
  assert.deepEqual(patch, {});
});

test("利用者が日を足したら、その field path だけ書く", () => {
  const patch = computeSchedulePatch(
    { careSchedule: {} },
    { careSchedule: { d1: ["a"] } },
    { careSchedule: {} },
  );
  assert.deepEqual(patch, { "careSchedule.d1": ["a"] });
});

test("利用者が日を消したら DELETE 番兵を返す", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"] } },
    { careSchedule: {} },
    { careSchedule: { d1: ["a"] } },
  );
  assert.deepEqual(patch, { "careSchedule.d1": DELETE });
});

test("サーバが既に利用者の意図どおりなら書かない（冪等）", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"] } },
    { careSchedule: { d1: ["a", "b"] } },
    { careSchedule: { d1: ["a", "b"] } },
  );
  assert.deepEqual(patch, {});
});

test("利用者が触っていない日は、サーバが別端末で変わっていても触らない", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"], d2: ["x"] } },
    { careSchedule: { d1: ["a"], d2: ["x"] } }, // 利用者は d1 も d2 も触っていない
    { careSchedule: { d1: ["a"], d2: ["x", "y"] } }, // 別端末が d2 を更新
  );
  assert.deepEqual(patch, {});
});

test("利用者とサーバが別々に変えた日は、利用者の値で上書きする（その日は last-write）", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"] } },
    { careSchedule: { d1: ["a", "b"] } },
    { careSchedule: { d1: ["a", "c"] } },
  );
  assert.deepEqual(patch, { "careSchedule.d1": ["a", "b"] });
});

test("next に無い系統（careCounts / runSchedule）は対象外", () => {
  const patch = computeSchedulePatch(
    { runSchedule: { d1: 1 } },
    { careSchedule: {} }, // careSchedule だけ保存対象、runSchedule は含めない
    { runSchedule: { d1: 1 } },
  );
  assert.deepEqual(patch, {});
});

test("3系統を同時に差分検出する", () => {
  const patch = computeSchedulePatch(
    { careSchedule: { d1: ["a"] }, careCounts: {}, runSchedule: { d1: 1 } },
    { careSchedule: { d1: ["a"] }, careCounts: { d1: { brush: 2 } }, runSchedule: { d1: 2 } },
    { careSchedule: { d1: ["a"] }, careCounts: {}, runSchedule: { d1: 1 } },
  );
  assert.deepEqual(patch, {
    "careCounts.d1": { brush: 2 },
    "runSchedule.d1": 2,
  });
});

test("引数が undefined でも落ちない", () => {
  assert.deepEqual(computeSchedulePatch(undefined, undefined, undefined), {});
  assert.deepEqual(computeSchedulePatch(null, { careSchedule: { d: [1] } }, null), {
    "careSchedule.d": [1],
  });
});
