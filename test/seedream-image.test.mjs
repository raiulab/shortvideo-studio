import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSeedreamCompositionBody,
  normalizeSeedreamCompositionInput,
  seedreamCompositionCost
} from "../lib/seedream-image.mjs";

const image1 = "data:image/png;base64,SU1BR0Ux";
const image2 = "data:image/jpeg;base64,SU1BR0Uy";

test("Seedream 4.5を既定にして複数画像を単一画像へ合成するリクエストを作る", () => {
  const body = buildSeedreamCompositionBody({
    images: [image1, image2],
    prompt: "Place the character in the scene.",
    aspectRatio: "16:9"
  });
  assert.equal(body.model, "seedream-4-5-251128");
  assert.deepEqual(body.image, [image1, image2]);
  assert.equal(body.size, "2560x1440");
  assert.equal(body.sequential_image_generation, "disabled");
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.watermark, false);
});

test("Seedream 5.0 Liteと縦長画像を明示的に選べる", () => {
  const input = normalizeSeedreamCompositionInput({
    model: "seedream-5-0-lite-260128",
    images: [image1, image2],
    prompt: "Compose",
    aspectRatio: "9:16"
  });
  assert.equal(input.model.id, "seedream-5-0-lite-260128");
  assert.equal(input.size, "1440x2560");
  assert.equal(seedreamCompositionCost(input.model.id), 0.035);
});

test("合成元が1枚だけの場合は送信しない", () => {
  assert.throws(() => normalizeSeedreamCompositionInput({ images: [image1], prompt: "Compose" }), /2枚以上/);
});
