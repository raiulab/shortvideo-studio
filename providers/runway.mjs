import { dataUrlParts, ensureModel, ensureOption, providerError, readProviderJson } from "./utils.mjs";

const baseUrl = "https://api.dev.runwayml.com/v1";
const apiVersion = "2024-11-06";

export const runwayProvider = {
  id: "runway",
  name: "Runway",
  configured(env) { return Boolean(env.RUNWAYML_API_SECRET); },
  envKey: "RUNWAYML_API_SECRET",
  cancelStates: ["created", "queueing", "processing"],
  notes: "Gen-4.5は開始フレームからのImage to Videoに対応します。",
  extension: {
    source: "last-frame",
    kind: "pseudo",
    postProcess: "concat-parent",
    supportsFinalFrame: false,
    sourceModels: ["gen4.5"],
    sourceResolutions: ["720p"],
    sourceAspectRatios: ["9:16", "16:9"],
    note: "元動画の最終フレームから新しいクリップを生成し、ローカルで結合します。接続部はネイティブ延長より変化が出る場合があります。",
    models: [
      { id: "gen4.5", label: "Gen-4.5", default: true }
    ],
    durations: [3, 4, 5, 6, 8, 10],
    resolutions: ["720p"]
  },
  models: [
    {
      id: "gen4.5",
      label: "Gen-4.5",
      default: true,
      modes: ["image-to-video"],
      durations: [3, 4, 5, 6, 8, 10],
      resolutions: ["720p"],
      aspectRatios: ["9:16", "16:9"],
      audioMode: "none",
      offPeak: false,
      price: { type: "runway-credits", creditsPerSecond: 12, imageCredits: 0 }
    }
  ],
  normalize(input) {
    const model = ensureModel(this, input.model, input.mode);
    return {
      ...input,
      model: model.id,
      duration: ensureOption(input.duration, model.durations, 5, "長さ"),
      resolution: "720p",
      aspectRatio: ensureOption(input.aspectRatio, model.aspectRatios, "9:16", "画面比率"),
      audio: false,
      offPeak: false
    };
  },
  estimate(input) {
    return input.duration * 12 * 0.01;
  },
  canExtend(record) {
    return this.extension.sourceModels.includes(record.model)
      && record.resolution === "720p"
      && ["9:16", "16:9"].includes(record.aspectRatio);
  },
  async create(input, env) {
    if (!env.RUNWAYML_API_SECRET) throw providerError(400, ".env に RUNWAYML_API_SECRET を設定してください。");
    const body = buildRunwayRequestBody(input);
    const response = await fetch(`${baseUrl}/image_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
        "Content-Type": "application/json",
        "X-Runway-Version": apiVersion
      },
      body: JSON.stringify(body)
    });
    const data = await readProviderJson(response, "Runwayへの送信に失敗しました。");
    return { taskId: data.id, state: mapRunwayState(data.status) };
  },
  async get(taskId, env) {
    const response = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
        "X-Runway-Version": apiVersion
      }
    });
    const data = await readProviderJson(response, "Runwayの生成状態を取得できませんでした。");
    return {
      state: mapRunwayState(data.status),
      outputUrl: Array.isArray(data.output) ? data.output[0] || null : null,
      failure: data.failure || data.failureCode || null
    };
  },
  normalizeExtension(input) {
    const model = this.extension.models.find(item => item.id === String(input.model || ""))
      || this.extension.models.find(item => item.default);
    if (!model) throw providerError(400, "Runwayの延長モデルが正しくありません。");
    if (!input.startImage) throw providerError(409, "元動画の最終フレームを取得できませんでした。");
    return {
      ...input,
      mode: "image-to-video",
      model: model.id,
      prompt: String(input.prompt || "").trim()
        || "Continue the preceding action naturally with the same subject, scene, camera position, lighting, and visual style.",
      duration: ensureOption(input.duration, this.extension.durations, 5, "追加時間"),
      resolution: "720p",
      aspectRatio: ensureOption(input.aspectRatio, ["9:16", "16:9"], "9:16", "画面比率"),
      audio: false,
      offPeak: false
    };
  },
  estimateExtension(input) {
    return input.duration * 12 * 0.01;
  },
  async extend(input, env) {
    return this.create(input, env);
  },
  async cancel(taskId, env) {
    const response = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
        "X-Runway-Version": apiVersion
      }
    });
    await readProviderJson(response, "Runwayの生成タスクをキャンセルできませんでした。");
    return { state: "cancelled" };
  }
};

export function buildRunwayRequestBody(input) {
  if (input.mode !== "image-to-video" || !input.startImage) {
    throw providerError(400, "Runway Gen-4.5には開始フレーム画像が必要です。");
  }
  dataUrlParts(input.startImage);
  return {
    model: input.model,
    promptImage: input.startImage,
    promptText: input.prompt,
    ratio: input.aspectRatio === "16:9" ? "1280:720" : "720:1280",
    duration: input.duration
  };
}

function mapRunwayState(state) {
  return ({
    PENDING: "queueing",
    THROTTLED: "queueing",
    RUNNING: "processing",
    SUCCEEDED: "success",
    FAILED: "failed",
    CANCELED: "cancelled",
    CANCELLED: "cancelled"
  })[String(state || "").toUpperCase()] || "created";
}
