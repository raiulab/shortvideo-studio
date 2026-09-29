import test from "node:test";
import assert from "node:assert/strict";
import { buildRunwayRequestBody, runwayProvider } from "../providers/runway.mjs";
import { buildSeedanceExtensionRequestBody, buildSeedanceRequestBody, seedanceProvider } from "../providers/seedance.mjs";
import { buildVeoExtensionRequestBody, buildVeoRequestBody, veoProvider } from "../providers/veo.mjs";
import { buildOmniRequestBody, omniProvider } from "../providers/omni.mjs";
import { buildHedraRequestBody, hedraProvider } from "../providers/hedra.mjs";
import { buildViduExtensionRequestBody, viduProvider } from "../providers/vidu.mjs";
import { listProviders } from "../providers/index.mjs";

const image = "data:image/png;base64,U0VMRUNURUQ=";

test("Runwayへ選択画像を開始フレームとして送る", () => {
  const body = buildRunwayRequestBody({
    mode: "image-to-video",
    startImage: image,
    prompt: "wave",
    model: "gen4.5",
    aspectRatio: "9:16",
    duration: 5
  });
  assert.equal(body.promptImage, image);
  assert.equal(body.ratio, "720:1280");
  assert.equal(body.duration, 5);
});

test("Seedanceの生成方式に応じて画像ロールを分ける", () => {
  const common = {
    images: [image],
    startImage: image,
    prompt: "wave",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16",
    audio: false
  };
  const start = buildSeedanceRequestBody({ ...common, mode: "image-to-video", model: "seedance-1-5-pro-251215" });
  const reference = buildSeedanceRequestBody({ ...common, mode: "reference-to-video", model: "dreamina-seedance-2-0-mini-260615" });
  assert.equal(start.content[1].role, "first_frame");
  assert.equal(reference.content[1].role, "reference_image");
  assert.equal(reference.content[1].image_url.url, image);
});

test("Veoは開始フレームと参照画像を別フィールドへ送る", () => {
  const common = {
    images: [image],
    startImage: image,
    prompt: "wave",
    duration: 8,
    resolution: "720p",
    aspectRatio: "9:16"
  };
  const start = buildVeoRequestBody({ ...common, mode: "image-to-video" });
  const reference = buildVeoRequestBody({ ...common, mode: "reference-to-video" });
  assert.equal(start.instances[0].image.bytesBase64Encoded, "U0VMRUNURUQ=");
  assert.equal(start.instances[0].image.mimeType, "image/png");
  assert.equal(reference.instances[0].referenceImages.length, 1);
  assert.equal(reference.instances[0].referenceImages[0].referenceType, "asset");
});

test("Gemini OmniはInteractions API向けに画像と動画設定を送る", () => {
  const body = buildOmniRequestBody({
    mode: "image-to-video", startImage: image, prompt: "wave", model: "gemini-omni-flash-preview", aspectRatio: "9:16"
  });
  assert.equal(body.model, "gemini-omni-flash-preview");
  assert.equal(body.input[0].type, "image");
  assert.equal(body.input[1].text, "wave");
  assert.equal(body.generation_config.video_config.task, "image_to_video");
  assert.equal(body.response_format.aspect_ratio, "9:16");
});

test("Gemini Omniは720p・3〜10秒の対応範囲に正規化する", () => {
  const result = omniProvider.normalize({
    mode: "text-to-video", model: "gemini-omni-flash-preview", duration: 8, resolution: "4k", aspectRatio: "16:9"
  });
  assert.equal(result.duration, 8);
  assert.equal(result.resolution, "720p");
  assert.equal(result.audio, true);
});

test("Hedra Avatar v3はアップロード済み画像・音声URLをジョブへ送る", () => {
  const body = buildHedraRequestBody({
    prompt: "gestures naturally",
    aspectRatio: "9:16",
    resolution: "720p",
    duration: 8
  }, "https://files.example/portrait", "https://files.example/speech");
  assert.equal(body.input.num_outputs, 1);
  assert.equal(body.input.start_image.url, "https://files.example/portrait");
  assert.equal(body.input.audio.url, "https://files.example/speech");
  assert.equal(body.input.duration_ms, 8000);
});

test("Hedra Avatarは10分までの音声を受け付ける", () => {
  const avatar = hedraProvider.normalize({
    mode: "digital-human",
    model: "hedra-avatar",
    audioDuration: 120,
    resolution: "1080p",
    aspectRatio: "16:9"
  });
  assert.equal(avatar.duration, 120);
  assert.equal(avatar.audio, true);
});

test("Hedra v3はファイルをアップロードしてAvatarジョブを開始する", async () => {
  const originalFetch = globalThis.fetch;
  let generationBody;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "https://media.example/audio/test.mp3") {
      return new Response(Buffer.from("audio"), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }
    if (url === "https://api.hedra.com/v3/files" && options.method === "POST") {
      const file = await options.body.get("file");
      return new Response(JSON.stringify({ url: `https://files.example/${file.name}` }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.hedra.com/v3/models/hedra-avatar") {
      generationBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ job_id: "hedra-job", status: "IN_QUEUE" }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const input = hedraProvider.normalize({
      mode: "digital-human",
      model: "hedra-avatar",
      startImage: image,
      audioUrl: "https://media.example/audio/test.mp3",
      audioObjectKey: "audio/test.mp3",
      audioDuration: 5,
      prompt: "speaks naturally",
      resolution: "720p",
      aspectRatio: "9:16"
    });
    const result = await hedraProvider.create(input, { HEDRA_API_KEY: "test-key" });
    assert.deepEqual(result, { taskId: "hedra-job", state: "queueing" });
    assert.equal(generationBody.input.start_image.url, "https://files.example/portrait.png");
    assert.equal(generationBody.input.audio.url, "https://files.example/speech.mp3");
    assert.equal(requests.find(request => request.url === "https://api.hedra.com/v3/files").options.headers.Authorization, "Key test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hedra v3の完了ジョブから動画URLとUSD実額を取得する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, "https://api.hedra.com/v3/jobs/job-1");
    assert.equal(options.headers.Authorization, "Key key-id:secret");
    return new Response(JSON.stringify({
      status: "COMPLETED",
      cost: 0.42,
      currency: "USD",
      outputs: [{ status: "COMPLETED", url: "https://output.example/video.mp4" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await hedraProvider.get("job-1", { HEDRA_API_KEY: "key-id:secret" });
    assert.deepEqual(result, { state: "success", outputUrl: "https://output.example/video.mp4", actualCost: 0.42, failure: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Veoの参照画像モードは8秒へ正規化する", () => {
  const result = veoProvider.normalize({
    mode: "reference-to-video",
    model: "veo-3.1-fast-generate-preview",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16"
  });
  assert.equal(result.duration, 8);
  assert.equal(result.aspectRatio, "9:16");
  assert.equal(result.audio, true);
});

test("Veo Fast / Standardは開始・終了フレームを8秒動画として送る", () => {
  const input = veoProvider.normalize({
    mode: "start-end-to-video",
    model: "veo-3.1-fast-generate-preview",
    duration: 4,
    resolution: "720p",
    aspectRatio: "9:16"
  });
  const body = buildVeoRequestBody({ ...input, startImage: image, endImage: image, prompt: "walk" });
  assert.equal(input.duration, 8);
  assert.equal(body.instances[0].image.bytesBase64Encoded, "U0VMRUNURUQ=");
  assert.equal(body.instances[0].lastFrame.bytesBase64Encoded, "U0VMRUNURUQ=");
  assert.equal(body.parameters.durationSeconds, 8);
});

test("Veoの延長は元動画をBase64として720pで送る", () => {
  const body = buildVeoExtensionRequestBody({
    videoBase64: "VklERU8=",
    prompt: "continue walking"
  });
  assert.equal(body.instances[0].video.mimeType, "video/mp4");
  assert.equal(body.instances[0].video.bytesBase64Encoded, "VklERU8=");
  assert.equal(body.parameters.resolution, "720p");
});

test("Seedanceの延長は参照動画と合計尺を送る", () => {
  const normalized = seedanceProvider.normalizeExtension({
    videoUrl: "https://example.com/source.mp4",
    sourceDuration: 5,
    prompt: "the cat starts running",
    model: "dreamina-seedance-2-0-mini-260615",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16",
    audio: true
  });
  const body = buildSeedanceExtensionRequestBody(normalized);
  assert.equal(body.content[1].role, "reference_video");
  assert.equal(body.content[1].video_url.url, "https://example.com/source.mp4");
  assert.match(body.content[0].text, /^Generate content after Video 1:/);
  assert.equal(body.duration, 10);
});

test("Runwayの疑似延長は最終フレームをImage to Videoへ渡す", () => {
  const normalized = runwayProvider.normalizeExtension({
    startImage: image,
    sourceDuration: 5,
    prompt: "",
    model: "gen4.5",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16"
  });
  const body = buildRunwayRequestBody(normalized);
  assert.equal(body.promptImage, image);
  assert.equal(body.duration, 5);
  assert.match(body.promptText, /Continue/);
});

test("Veo・Seedance・Runwayの延長APIへ正しいエンドポイントで送信する", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const response = url.includes("generativelanguage")
      ? { name: "operations/veo-1" }
      : url.includes("bytepluses")
        ? { id: "seedance-1", status: "queued" }
        : { id: "runway-1", status: "PENDING" };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    await veoProvider.extend({
      model: "veo-3.1-fast-generate-preview",
      videoBase64: "VklERU8=",
      prompt: "continue",
      duration: 7
    }, { GEMINI_API_KEY: "test" });
    await seedanceProvider.extend({
      model: "dreamina-seedance-2-0-mini-260615",
      videoUrl: "https://example.com/source.mp4",
      prompt: "continue",
      outputDuration: 10,
      resolution: "720p",
      aspectRatio: "9:16",
      audio: true
    }, { ARK_API_KEY: "test" });
    await runwayProvider.extend(runwayProvider.normalizeExtension({
      startImage: image,
      sourceDuration: 5,
      prompt: "continue",
      model: "gen4.5",
      duration: 5,
      resolution: "720p",
      aspectRatio: "9:16"
    }), { RUNWAYML_API_SECRET: "test" });
    assert.match(requests[0].url, /veo-3\.1-fast-generate-preview:predictLongRunning$/);
    assert.match(requests[1].url, /contents\/generations\/tasks$/);
    assert.match(requests[2].url, /\/image_to_video$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Viduの動画延長へ生成ID・URL・終了フレームを送る", () => {
  const normalized = viduProvider.normalizeExtension({
    parentGenerationId: "gen-1",
    videoCreationId: "creation-1",
    videoUrl: "https://example.com/video.mp4",
    finalFrameImage: image,
    prompt: "keep walking",
    model: "viduq2-turbo",
    duration: 5,
    resolution: "720p"
  });
  const body = buildViduExtensionRequestBody(normalized);
  assert.equal(body.video_creation_id, "creation-1");
  assert.equal(body.video_url, "https://example.com/video.mp4");
  assert.deepEqual(body.images, [image]);
  assert.equal(body.duration, 5);
  assert.equal(body.resolution, "720p");
});

test("Viduの動画延長は生成IDとURLが揃わない場合に送信しない", () => {
  assert.throws(
    () => buildViduExtensionRequestBody({
      model: "viduq2-turbo",
      videoCreationId: "",
      videoUrl: "",
      duration: 5,
      resolution: "720p"
    }),
    error => error.status === 409 && /生成情報/.test(error.message)
  );
});

test("Viduの延長元動画は60秒を超えると拒否する", () => {
  assert.throws(() => viduProvider.normalizeExtension({
    model: "viduq2-turbo",
    sourceDuration: 61,
    duration: 5,
    resolution: "720p"
  }), /60秒以下/);
  assert.equal(viduProvider.canExtend({ duration: 60 }), true);
  assert.equal(viduProvider.canExtend({ duration: 61 }), false);
});

test("Vidu Q3はImage to Videoのモデル候補として受け付けない", () => {
  assert.throws(() => viduProvider.normalize({
    model: "viduq3",
    mode: "image-to-video"
  }), /組み合わせられません/);
});

test("Vidu Q3 TurboとQ3 ProはText／Start End to Videoのモデル候補として受け付ける", () => {
  assert.equal(viduProvider.normalize({
    model: "viduq3-turbo",
    mode: "text-to-video",
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9"
  }).model, "viduq3-turbo");
  assert.equal(viduProvider.normalize({
    model: "viduq3-pro",
    mode: "start-end-to-video",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16"
  }).model, "viduq3-pro");
});

test("Vidu Q2 TurboとQ2 ProはDigital Humanのモデル候補として受け付ける", () => {
  assert.equal(viduProvider.normalize({
    model: "viduq2-turbo",
    mode: "digital-human",
    duration: 5,
    resolution: "720p",
    aspectRatio: "9:16"
  }).model, "viduq2-turbo");
  assert.equal(viduProvider.normalize({
    model: "viduq2-pro",
    mode: "digital-human",
    duration: 5,
    resolution: "1080p",
    aspectRatio: "9:16"
  }).model, "viduq2-pro");
});

test("Viduの動画延長APIへ正しいエンドポイントで送信する", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ task_id: "extend-task-1", state: "created", credits: 6 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const result = await viduProvider.extend({
      parentGenerationId: "gen-1",
      videoCreationId: "creation-1",
      videoUrl: "https://example.com/video.mp4",
      prompt: "keep walking",
      model: "viduq2-turbo",
      duration: 5,
      resolution: "720p"
    }, { VIDU_API_KEY: "test-key" });
    assert.equal(request.url, "https://api.vidu.com/ent/v2/extend");
    assert.equal(request.options.method, "POST");
    assert.equal(JSON.parse(request.options.body).video_creation_id, "creation-1");
    assert.deepEqual(result, { taskId: "extend-task-1", state: "created", credits: 6 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成方式に非対応のモデル指定は暗黙に別モデルへ変更しない", () => {
  assert.throws(
    () => seedanceProvider.normalize({
      mode: "reference-to-video",
      model: "seedance-1-5-pro-251215",
      duration: 5,
      resolution: "720p",
      aspectRatio: "9:16"
    }),
    error => error.status === 400 && /組み合わせられません/.test(error.message)
  );
});

test("APIキーの有無を秘密値なしでプロバイダー一覧へ反映する", () => {
  const providers = listProviders({ VIDU_API_KEY: "x", HEDRA_API_KEY: "x", RUNWAYML_API_SECRET: "", GEMINI_API_KEY: "x" });
  assert.equal(providers.find(item => item.id === "vidu").configured, true);
  assert.equal(providers.find(item => item.id === "runway").configured, false);
  assert.equal(providers.find(item => item.id === "veo").configured, true);
  assert.equal(providers.find(item => item.id === "seedance").configured, false);
  assert.equal(providers.find(item => item.id === "hedra").configured, true);
  assert.equal(providers.find(item => item.id === "vidu").extension.durations.at(-1), 7);
  assert.equal(providers.find(item => item.id === "veo").extension.durations[0], 7);
  assert.equal(providers.find(item => item.id === "seedance").extension.maxOutputDuration, 15);
  assert.equal(providers.find(item => item.id === "runway").extension.kind, "pseudo");
  assert.equal(providers.find(item => item.id === "vidu").models[0].durations[0], 3);
  assert.equal(providers.find(item => item.id === "runway").models[0].durations[0], 3);
  assert.equal(providers.find(item => item.id === "seedance").models[0].durations[0], 4);
  assert.equal(providers.find(item => item.id === "veo").models[0].durations[0], 4);
});

test("各プロバイダーの概算料金が数値で返る", () => {
  assert.equal(runwayProvider.estimate({ duration: 5 }), 0.6);
  assert.equal(seedanceProvider.estimate({ model: "seedance-1-5-pro-251215", duration: 5, resolution: "720p", audio: false }), 0.13);
  assert.equal(veoProvider.estimate({ model: "veo-3.1-lite-generate-preview", duration: 4, resolution: "720p" }), 0.2);
  assert.equal(viduProvider.estimateExtension({ model: "viduq2-turbo", duration: 5, resolution: "720p" }), 0.175);
  assert.equal(hedraProvider.estimate({ model: "hedra-avatar", duration: 10, resolution: "540p" }), 0.25);
  assert.equal(hedraProvider.estimate({ model: "hedra-avatar", duration: 10, resolution: "720p" }), 0.5);
  assert.equal(hedraProvider.estimate({ model: "hedra-avatar", duration: 10, resolution: "1080p" }), 0.625);
});

test("Viduの返却クレジットを実額へ換算する", () => {
  assert.equal(viduProvider.actualCost({ credits: 35 }), 0.175);
  assert.equal(viduProvider.actualCost({ credits: null }), null);
});
