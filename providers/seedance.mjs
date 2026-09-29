import { ensureModel, ensureOption, providerError, readProviderJson } from "./utils.mjs";

const baseUrl = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

export const seedanceProvider = {
  id: "seedance",
  name: "Seedance",
  configured(env) { return Boolean(env.ARK_API_KEY); },
  envKey: "ARK_API_KEY",
  cancelStates: ["created", "queueing"],
  notes: "Seedance 2.0の人物参照にはBytePlus側の素材認証が必要な場合があります。",
  extension: {
    source: "remote-video",
    kind: "native",
    supportsFinalFrame: false,
    sourceModels: ["dreamina-seedance-2-0-mini-260615"],
    sourceResolutions: ["480p", "720p"],
    sourceAspectRatios: ["9:16", "16:9", "1:1"],
    maxOutputDuration: 15,
    note: "Seedance 2.0の動画参照で後方へ延長します。元動画URLはBytePlus側で取得できる期間内に限ります。",
    models: [
      { id: "dreamina-seedance-2-0-mini-260615", label: "Seedance 2.0 Mini", default: true }
    ],
    durations: [1, 2, 3, 4, 5, 6, 7],
    resolutions: ["480p", "720p"]
  },
  models: [
    {
      id: "seedance-1-5-pro-251215",
      label: "Seedance 1.5 Pro",
      default: true,
      modes: ["image-to-video"],
      durations: [4, 5, 6, 8, 10, 12],
      resolutions: ["480p", "720p", "1080p"],
      aspectRatios: ["9:16", "16:9", "1:1"],
      audioMode: "optional",
      offPeak: false,
      price: { type: "seedance-1.5" }
    },
    {
      id: "dreamina-seedance-2-0-mini-260615",
      label: "Seedance 2.0 Mini",
      modes: ["image-to-video", "reference-to-video"],
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ["480p", "720p"],
      aspectRatios: ["9:16", "16:9", "1:1"],
      audioMode: "optional",
      offPeak: false,
      price: { type: "seedance-2-mini" }
    }
  ],
  normalize(input) {
    const model = ensureModel(this, input.model, input.mode);
    return {
      ...input,
      model: model.id,
      duration: ensureOption(input.duration, model.durations, 5, "長さ"),
      resolution: ensureOption(input.resolution, model.resolutions, "720p", "解像度"),
      aspectRatio: ensureOption(input.aspectRatio, model.aspectRatios, "9:16", "画面比率"),
      audio: Boolean(input.audio),
      offPeak: false
    };
  },
  estimate(input) {
    if (input.model === "seedance-1-5-pro-251215") {
      const silentRate = { "480p": 0.012, "720p": 0.026, "1080p": 0.058 }[input.resolution] || 0.026;
      return input.duration * silentRate * (input.audio ? 2 : 1);
    }
    const rate = input.resolution === "480p" ? 0.04 : 0.08;
    return input.duration * rate;
  },
  actualCost(record) {
    if (record.credits === null || record.credits === undefined || record.credits === "") return null;
    const tokens = Number(record.credits);
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    const rate = record.model === "seedance-1-5-pro-251215"
      ? record.audio ? 2.4 : 1.2
      : record.mode === "video-extension" ? 2.1 : 3.5;
    return tokens * rate / 1_000_000;
  },
  canExtend(record) {
    return this.extension.sourceModels.includes(record.model)
      && Number(record.duration) >= 2
      && Number(record.duration) < this.extension.maxOutputDuration;
  },
  async create(input, env) {
    if (!env.ARK_API_KEY) throw providerError(400, ".env に ARK_API_KEY を設定してください。");
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ARK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildSeedanceRequestBody(input))
    });
    const data = await readProviderJson(response, "Seedanceへの送信に失敗しました。");
    return { taskId: data.id, state: mapSeedanceState(data.status) };
  },
  async get(taskId, env) {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${env.ARK_API_KEY}` }
    });
    const data = await readProviderJson(response, "Seedanceの生成状態を取得できませんでした。");
    return {
      state: mapSeedanceState(data.status),
      outputUrl: data.content?.video_url || null,
      credits: data.usage?.completion_tokens ?? null,
      failure: data.error?.message || null
    };
  },
  normalizeExtension(input) {
    const model = this.extension.models.find(item => item.id === String(input.model || ""))
      || this.extension.models.find(item => item.default);
    if (!model) throw providerError(400, "Seedanceの延長モデルが正しくありません。");
    if (!input.videoUrl) throw providerError(409, "Seedanceへ送る元動画URLを取得できませんでした。");
    const sourceDuration = Number(input.sourceDuration) || 0;
    const allowedDurations = this.extension.durations.filter(value =>
      sourceDuration + value <= this.extension.maxOutputDuration
    );
    if (!allowedDurations.length) throw providerError(409, "Seedanceは合計15秒までの動画を生成できます。");
    const duration = ensureOption(input.duration, allowedDurations, allowedDurations[0], "追加時間");
    return {
      ...input,
      model: model.id,
      prompt: String(input.prompt || "").trim(),
      duration,
      outputDuration: sourceDuration + duration,
      resolution: ensureOption(input.resolution, this.extension.resolutions, "720p", "解像度")
    };
  },
  estimateExtension(input) {
    const rate = input.resolution === "480p" ? 0.04 : 0.08;
    return input.outputDuration * rate;
  },
  async extend(input, env) {
    if (!env.ARK_API_KEY) throw providerError(400, ".env に ARK_API_KEY を設定してください。");
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ARK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildSeedanceExtensionRequestBody(input))
    });
    const data = await readProviderJson(response, "Seedanceの続きを送信できませんでした。");
    return { taskId: data.id, state: mapSeedanceState(data.status) };
  },
  async cancel(taskId, env) {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ARK_API_KEY}` }
    });
    await readProviderJson(response, "Seedanceの待機タスクをキャンセルできませんでした。");
    return { state: "cancelled" };
  }
};

export function buildSeedanceRequestBody(input) {
  const source = input.mode === "image-to-video" ? input.startImage : input.images?.[0];
  if (!source) throw providerError(400, "Seedanceへ送信する画像がありません。");
  const role = input.mode === "image-to-video" ? "first_frame" : "reference_image";
  return {
    model: input.model,
    content: [
      { type: "text", text: input.prompt },
      { type: "image_url", image_url: { url: source }, role }
    ],
    generate_audio: Boolean(input.audio),
    ratio: input.aspectRatio,
    duration: input.duration,
    resolution: input.resolution,
    watermark: false
  };
}

export function buildSeedanceExtensionRequestBody(input) {
  if (!input.videoUrl) throw providerError(409, "Seedanceへ送る元動画URLがありません。");
  const continuation = input.prompt || "Continue the action naturally while preserving the subject, scene, and camera movement.";
  return {
    model: input.model,
    content: [
      { type: "text", text: `Generate content after Video 1: ${continuation}` },
      { type: "video_url", video_url: { url: input.videoUrl }, role: "reference_video" }
    ],
    generate_audio: Boolean(input.audio),
    ratio: input.aspectRatio,
    duration: input.outputDuration,
    resolution: input.resolution,
    watermark: false
  };
}

function mapSeedanceState(state) {
  return ({
    queued: "queueing",
    running: "processing",
    succeeded: "success",
    failed: "failed",
    cancelled: "cancelled"
  })[String(state || "").toLowerCase()] || "created";
}
