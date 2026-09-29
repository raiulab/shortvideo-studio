import test from "node:test";
import assert from "node:assert/strict";
import { inputPathForGeneration, outputPathForGeneration, selectGenerationsForDeletion } from "../lib/generation-history.mjs";

const generations = [
  { id: "success-1", state: "success" },
  { id: "cancelled-1", state: "cancelled" },
  { id: "queueing-1", state: "queueing" }
];

test("選択した完了済み履歴だけを削除対象として解決する", () => {
  assert.deepEqual(
    selectGenerationsForDeletion(generations, ["cancelled-1", "success-1"]),
    [generations[1], generations[0]]
  );
});

test("待機中の履歴は削除対象にできない", () => {
  assert.throws(
    () => selectGenerationsForDeletion(generations, ["queueing-1"]),
    error => error.status === 409 && /キャンセル/.test(error.message)
  );
});

test("保存動画URLからoutputs内のMP4だけを解決する", () => {
  assert.equal(
    outputPathForGeneration("/tmp/outputs", "/outputs/demo-123.mp4"),
    "/tmp/outputs/demo-123.mp4"
  );
  assert.equal(outputPathForGeneration("/tmp/outputs", "/characters/demo/image.png"), null);
  assert.equal(outputPathForGeneration("/tmp/outputs", "/outputs/../secret.mp4"), null);
});


test("履歴用入力画像URLからinputs内の画像だけを解決する", () => {
  assert.equal(
    inputPathForGeneration("/tmp/inputs", "/inputs/gen-123-start.webp"),
    "/tmp/inputs/gen-123-start.webp"
  );
  assert.equal(inputPathForGeneration("/tmp/inputs", "/characters/demo/image.png"), null);
  assert.equal(inputPathForGeneration("/tmp/inputs", "/inputs/../secret.png"), null);
});
