import { dataUrlParts, ensureModel, ensureOption, providerError, readProviderJson } from "./utils.mjs";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta";

export const veoProvider = {
  id: "veo",
  name: "Veo",
  configured(env) { return Boolean(env.GEMINI_API_KEY); },
  envKey: "GEMINI_API_KEY",
  cancelStates: [],
  notes: "Veoの動画には音声が常に含まれます。",
  referenceNotes: "Veoの参照画像生成は8秒固定です。",
  extension: {
    source: "local-video",
    kind: "native",
    supportsFinalFrame: false,
    sourceModels: ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"],
    sourceResolutions: ["720p"],
    sourceAspectRatios: ["9:16", "16:9"],
    maxExtensions: 20,
    maxSourceDuration: 141,
    note: "Veo 3.1 / Fastの720p動画を7秒延長します。Lite・1080p・4K動画は対象外です。",
    models: [
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", default: true },
      { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard" }
    ],
    durations: [7],
    resolutions: ["720p"]
  },
  models: [
    {
      id: "veo-3.1-lite-generate-preview",
      label: "Veo 3.1 Lite",
      default: true,
      modes: ["image-to-video"],
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["9:16", "16:9"],
      audioMode: "always",
      offPeak: false,
      price: { type: "per-second", rates: { "720p": 0.05, "1080p": 0.08 } },
      summary: { cost: "$0.05/秒（約¥8、720p）・$0.08/秒（約¥13、1080p）", features: "最安のVeo。音声付きの短尺生成", limits: "延長不可・4K不可" }
    },
    {
      id: "veo-3.1-fast-generate-preview",
      label: "Veo 3.1 Fast",
      modes: ["image-to-video", "reference-to-video", "start-end-to-video"],
      durations: [4, 6, 8],
      startEndDurations: [8],
      referenceDurations: [8],
      referenceAspectRatios: ["9:16", "16:9"],
      resolutions: ["720p", "1080p", "4k"],
      aspectRatios: ["9:16", "16:9"],
      audioMode: "always",
      offPeak: false,
      price: { type: "per-second", rates: { "720p": 0.10, "1080p": 0.12, "4k": 0.30 } },
      summary: { cost: "$0.10/秒〜（約¥17/秒〜）", features: "Veoの高速版。本アプリの動画延長に対応（開始／終了フレーム指定はVeo API機能）", limits: "4Kと1080pは8秒生成のみ" }
    },
    {
      id: "veo-3.1-generate-preview",
      label: "Veo 3.1 Standard",
      modes: ["image-to-video", "reference-to-video", "start-end-to-video"],
      durations: [4, 6, 8],
      startEndDurations: [8],
      referenceDurations: [8],
      referenceAspectRatios: ["9:16", "16:9"],
      resolutions: ["720p", "1080p", "4k"],
      aspectRatios: ["9:16", "16:9"],
      audioMode: "always",
      offPeak: false,
      price: { type: "per-second", rates: { "720p": 0.40, "1080p": 0.40, "4k": 0.60 } },
      summary: { cost: "$0.40/秒（約¥66、720p・1080p）・$0.60/秒（約¥100、4K）", features: "高精細な映像、音声、本アプリの動画延長（開始／終了フレーム指定はVeo API機能）", limits: "4Kと1080pは8秒生成のみ" }
    }
  ],
  normalize(input) {
    const model = ensureModel(this, input.model, input.mode);
    const durations = input.mode === "start-end-to-video"
      ? model.startEndDurations || model.durations
      : input.mode === "reference-to-video" ? model.referenceDurations || [8] : model.durations;
    const aspectRatios = input.mode === "reference-to-video"
      ? model.referenceAspectRatios || model.aspectRatios
      : model.aspectRatios;
    const duration = ensureOption(input.duration, durations, durations[0], "長さ");
    const resolution = ensureOption(input.resolution, model.resolutions, "720p", "解像度");
    if (resolution !== "720p" && duration !== 8) {
      throw providerError(400, "Veoの1080p・4K生成は8秒だけに対応しています。");
    }
    return {
      ...input,
      model: model.id,
      duration,
      resolution,
      aspectRatio: ensureOption(input.aspectRatio, aspectRatios, aspectRatios[0], "画面比率"),
      audio: true,
      offPeak: false
    };
  },
  estimate(input) {
    const model = this.models.find(item => item.id === input.model);
    return input.duration * (model?.price.rates[input.resolution] || 0);
  },
  canExtend(record) {
    return this.extension.sourceModels.includes(record.model)
      && record.resolution === "720p"
      && Number(record.duration) <= this.extension.maxSourceDuration
      && (Number(record.extensionDepth) || 0) < this.extension.maxExtensions;
  },
  async create(input, env) {
    if (!env.GEMINI_API_KEY) throw providerError(400, ".env に GEMINI_API_KEY を設定してください。");
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(input.model)}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(buildVeoRequestBody(input))
    });
    const data = await readProviderJson(response, "Veoへの送信に失敗しました。");
    return { taskId: data.name, state: data.done ? "processing" : "queueing" };
  },
  async get(taskId, env) {
    const response = await fetch(`${baseUrl}/${taskId.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }
    });
    const data = await readProviderJson(response, "Veoの生成状態を取得できませんでした。");
    if (!data.done) return { state: "processing" };
    if (data.error) return { state: "failed", failure: data.error.message || "Veoの生成に失敗しました。" };
    const video = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video
      || data.response?.generatedVideos?.[0]?.video
      || {};
    return {
      state: "success",
      outputUrl: video.uri || null,
      outputBase64: video.videoBytes || video.bytesBase64Encoded || null,
      downloadHeaders: video.uri ? { "x-goog-api-key": env.GEMINI_API_KEY } : undefined
    };
  },
  normalizeExtension(input) {
    const model = this.extension.models.find(item => item.id === String(input.model || ""))
      || this.extension.models.find(item => item.default);
    if (!model) throw providerError(400, "Veoの延長モデルが正しくありません。");
    if (!input.videoBase64) throw providerError(409, "Veoへ送る元動画を読み込めませんでした。");
    return {
      ...input,
      model: model.id,
      prompt: String(input.prompt || "").trim(),
      duration: 7,
      resolution: "720p"
    };
  },
  estimateExtension(input) {
    const model = this.models.find(item => item.id === input.model);
    return input.duration * (model?.price.rates["720p"] || 0);
  },
  async extend(input, env) {
    if (!env.GEMINI_API_KEY) throw providerError(400, ".env に GEMINI_API_KEY を設定してください。");
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(input.model)}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(buildVeoExtensionRequestBody(input))
    });
    const data = await readProviderJson(response, "Veoの続きを送信できませんでした。");
    return { taskId: data.name, state: data.done ? "processing" : "queueing" };
  }
};

export function buildVeoRequestBody(input) {
  const source = input.mode === "image-to-video" || input.mode === "start-end-to-video"
    ? input.startImage
    : input.images?.[0];
  const image = veoImage(source);
  const instance = { prompt: input.prompt };
  if (input.mode === "image-to-video" || input.mode === "start-end-to-video") {
    instance.image = image;
    if (input.mode === "start-end-to-video") instance.lastFrame = veoImage(input.endImage);
  } else {
    instance.referenceImages = [{ image, referenceType: "asset" }];
  }
  return {
    instances: [instance],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.duration,
      resolution: input.resolution
    }
  };
}

export function buildVeoExtensionRequestBody(input) {
  if (!input.videoBase64) throw providerError(409, "Veoへ送る元動画がありません。");
  return {
    instances: [{
      prompt: input.prompt || "",
      video: {
        bytesBase64Encoded: input.videoBase64,
        mimeType: "video/mp4"
      }
    }],
    parameters: {
      resolution: "720p"
    }
  };
}

function veoImage(dataUrl) {
  const { mimeType, base64 } = dataUrlParts(dataUrl);
  return { bytesBase64Encoded: base64, mimeType };
}
