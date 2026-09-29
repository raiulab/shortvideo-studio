import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegisteredSourceImage } from "../lib/source-image.mjs";
import { buildViduRequestBody, viduProvider } from "../providers/vidu.mjs";

const registeredImages = [
  { name: "first.png", url: "/characters/test/first.png" },
  { name: "selected.png", url: "/characters/test/selected.png" },
  { name: "third.png", url: "/characters/test/third.png" }
];

test("登録画像3枚から指定された1枚だけを解決する", () => {
  assert.deepEqual(
    resolveRegisteredSourceImage(registeredImages, "selected.png"),
    registeredImages[1]
  );
});

test("画像名がない場合に先頭画像へ暗黙フォールバックしない", () => {
  assert.equal(resolveRegisteredSourceImage(registeredImages, ""), null);
});

test("登録されていない画像名を拒否する", () => {
  assert.throws(
    () => resolveRegisteredSourceImage(registeredImages, "missing.png"),
    error => error.status === 400 && /見つかりません/.test(error.message)
  );
});

test("Reference to VideoのViduリクエストには複数の参照画像を入れられる", () => {
  const selectedDataUrls = ["data:image/png;base64,U0VMRUNURUQ=", "data:image/png;base64,U0VDT05E"];
  const body = buildViduRequestBody({
    mode: "reference-to-video",
    characterId: "test",
    images: selectedDataUrls,
    prompt: "wave",
    model: "viduq3-turbo",
    duration: 5,
    aspectRatio: "9:16",
    resolution: "720p",
    audio: false,
    offPeak: false
  }, 123);

  assert.deepEqual(body.images, selectedDataUrls);
  assert.equal(body.images.length, 2);
  assert.equal(body.prompt, "wave");
});

test("Reference to Videoは8枚以上の画像を送信前に拒否する", () => {
  assert.throws(
    () => buildViduRequestBody({
      mode: "reference-to-video",
      characterId: "test",
      images: Array.from({ length: 8 }, () => "data:image/png;base64,SU1BR0U="),
      prompt: "wave",
      model: "viduq3-turbo",
      duration: 5,
      aspectRatio: "9:16",
      resolution: "720p",
      audio: false,
      offPeak: false
    }),
    error => error.status === 400 && /1〜7枚/.test(error.message)
  );
});

test("Image to VideoのViduリクエストでは選択画像が開始フレームになる", () => {
  const selectedDataUrl = "data:image/png;base64,U0VMRUNURUQ=";
  const body = buildViduRequestBody({
    mode: "image-to-video",
    characterId: "test",
    startImage: selectedDataUrl,
    prompt: "wave",
    model: "viduq3-turbo",
    duration: 5,
    aspectRatio: "9:16",
    resolution: "720p",
    audio: false,
    offPeak: false
  }, 123);

  assert.deepEqual(body.images, [selectedDataUrl]);
  assert.equal(body.images.length, 1);
});

test("Text to VideoのViduリクエストは画像を送らない", () => {
  const body = buildViduRequestBody({
    mode: "text-to-video",
    characterId: "test",
    prompt: "A dog runs through a sunny field.",
    model: "viduq3-turbo",
    duration: 5,
    aspectRatio: "16:9",
    resolution: "720p",
    audio: true,
    offPeak: false
  }, 123);

  assert.equal(body.images, undefined);
  assert.equal(body.prompt, "A dog runs through a sunny field.");
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.audio, true);
});

test("Start End to VideoのViduリクエストは開始・終了の2画像を順番に送る", () => {
  const body = buildViduRequestBody({
    mode: "start-end-to-video",
    characterId: "test",
    startImage: "data:image/png;base64,U1RBUlQ=",
    endImage: "data:image/png;base64,RU5E",
    prompt: "The sun sets.",
    model: "viduq3-pro",
    duration: 5,
    resolution: "720p",
    audio: false,
    offPeak: true
  }, 123);

  assert.deepEqual(body.images, ["data:image/png;base64,U1RBUlQ=", "data:image/png;base64,RU5E"]);
  assert.equal(body.aspect_ratio, undefined);
  assert.equal(body.off_peak, true);
});

test("Digital HumanのViduリクエストは静止画と自前音声URLを送る", () => {
  const body = buildViduRequestBody({
    mode: "digital-human",
    characterId: "test",
    startImage: "data:image/png;base64,SU1BR0U=",
    audioUrl: "https://example.com/shortvideo/uploads/audio/test.mp3",
    prompt: "Speak naturally to camera.",
    model: "viduq2-turbo",
    resolution: "720p"
  }, 123);

  assert.equal(body.image, "data:image/png;base64,SU1BR0U=");
  assert.equal(body.audio_url, "https://example.com/shortvideo/uploads/audio/test.mp3");
  assert.equal(body.prompt, "Speak naturally to camera.");
  assert.equal(body.duration, undefined);
});

test("ViduのキャンセルAPIへタスクIDを送信する", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await viduProvider.cancel("task-123", { VIDU_API_KEY: "test-key" });
    assert.equal(request.url, "https://api.vidu.com/ent/v2/tasks/task-123/cancel");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { id: "task-123" });
    assert.deepEqual(result, { state: "cancelled" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
