import { dataUrlParts, ensureModel, ensureOption, providerError, readProviderJson } from "./utils.mjs";

const baseUrl = "https://api.hedra.com/v3";
const avatarModelId = "hedra-avatar";
const avatarRates = Object.freeze({ "540p": 0.025, "720p": 0.05, "1080p": 0.0625 });

export const hedraProvider = {
  id: "hedra",
  name: "Hedra",
  configured(env) { return Boolean(env.HEDRA_API_KEY); },
  envKey: "HEDRA_API_KEY",
  cancelStates: [],
  notes: "Developer Platform v3のHedra Avatarを使用します。Studio契約は不要です。実際のAPI料金は完了後にHedraから返るUSD金額で記録します。",
  models: [
    {
      id: avatarModelId,
      label: "Hedra Avatar",
      default: true,
      modes: ["digital-human"],
      durations: [5],
      maxAudioDuration: 600,
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["1:1", "16:9", "9:16"],
      audioMode: "external",
      offPeak: false,
      price: { type: "per-second", rates: avatarRates },
      summary: {
        cost: "540p $0.025／秒・720p $0.05／秒・1080p $0.0625／秒",
        features: "安定したリップシンク・プレゼンター・長尺会話",
        limits: "音声に応じて最大10分"
      }
    }
  ],
  normalize(input) {
    const model = ensureModel(this, input.model, input.mode);
    const duration = normalizeAudioDuration(input.audioDuration, model.maxAudioDuration, model.label);
    return {
      ...input,
      model: model.id,
      duration,
      resolution: ensureOption(input.resolution, model.resolutions, "720p", "解像度"),
      aspectRatio: ensureOption(input.aspectRatio, model.aspectRatios, "9:16", "画面比率"),
      audio: true,
      offPeak: false
    };
  },
  estimate(input) {
    const rate = avatarRates[input.resolution] || avatarRates["720p"];
    return Math.round(Number(input.duration) * rate * 10000) / 10000;
  },
  async create(input, env) {
    if (!env.HEDRA_API_KEY) throw providerError(400, ".env に HEDRA_API_KEY を設定してください。");
    if (!input.startImage || !input.audioUrl) {
      throw providerError(400, "Hedraには開始画像と音声ファイルが必要です。");
    }

    const image = dataUrlFile(input.startImage, "portrait");
    const audio = await remoteAudioFile(input.audioUrl, input.audioObjectKey);
    const [imageUpload, audioUpload] = await Promise.all([
      uploadHedraFile(image, env.HEDRA_API_KEY),
      uploadHedraFile(audio, env.HEDRA_API_KEY)
    ]);
    const response = await fetch(`${baseUrl}/models/${avatarModelId}`, {
      method: "POST",
      headers: hedraHeaders(env.HEDRA_API_KEY, true),
      body: JSON.stringify(buildHedraRequestBody(input, imageUpload.url, audioUpload.url))
    });
    const data = await readProviderJson(response, "Hedraへの送信に失敗しました。");
    if (!data.job_id) throw providerError(502, "HedraのジョブIDを取得できませんでした。");
    return { taskId: data.job_id, state: mapHedraState(data.status) };
  },
  async get(taskId, env) {
    if (!env.HEDRA_API_KEY) throw providerError(400, "Hedra API未設定です。");
    const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(taskId)}`, {
      headers: hedraHeaders(env.HEDRA_API_KEY)
    });
    const data = await readProviderJson(response, "Hedraの生成状態を取得できませんでした。");
    const output = Array.isArray(data.outputs)
      ? data.outputs.find(item => item?.status === "COMPLETED" && item?.url) || data.outputs.find(item => item?.url)
      : null;
    return {
      state: mapHedraState(data.status),
      outputUrl: output?.url || null,
      actualCost: normalizeActualCost(data.cost, data.currency),
      failure: data.error?.message || output?.error?.message || null
    };
  }
};

export function buildHedraRequestBody(input, imageUrl, audioUrl) {
  if (!imageUrl || !audioUrl) throw providerError(400, "Hedraへ送る画像または音声のアップロードURLがありません。");
  return {
    input: {
      num_outputs: 1,
      prompt: String(input.prompt || "").trim() || "The person speaks naturally to the camera.",
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      duration_ms: Math.round(Number(input.duration) * 1000),
      start_image: { source: "url", url: imageUrl },
      audio: { source: "url", url: audioUrl }
    }
  };
}

async function uploadHedraFile(file, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.name);
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: hedraHeaders(apiKey),
    body: form
  });
  const uploaded = await readProviderJson(response, `Hedraへ${file.mimeType.startsWith("image/") ? "画像" : "音声"}をアップロードできませんでした。`);
  if (!uploaded.url) throw providerError(502, "HedraのアップロードURLを取得できませんでした。");
  return uploaded;
}

function dataUrlFile(dataUrl, baseName) {
  const { mimeType, base64 } = dataUrlParts(dataUrl);
  const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  return { name: `${baseName}${extension}`, mimeType, buffer: Buffer.from(base64, "base64") };
}

async function remoteAudioFile(url, objectKey) {
  const response = await fetch(url);
  if (!response.ok) throw providerError(response.status, "Hedraへ送る音声ファイルを取得できませんでした。");
  const extension = String(objectKey || url).match(/\.(mp3|wav|m4a|aac|ogg|wma)(?:\?|$)/i)?.[1]?.toLowerCase() || "mp3";
  const mimeType = ({
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    wma: "audio/x-ms-wma"
  })[extension];
  return {
    name: `speech.${extension}`,
    mimeType: response.headers.get("content-type")?.split(";")[0] || mimeType,
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

function normalizeAudioDuration(value, maxDuration, label) {
  const duration = Math.round(Number(value));
  if (!Number.isFinite(duration) || duration < 1) throw providerError(400, "音声の長さを確認できませんでした。");
  if (duration > maxDuration) throw providerError(400, `${label}で使える音声は${maxDuration === 600 ? "10分" : `${maxDuration}秒`}以内です。`);
  return duration;
}

function hedraHeaders(apiKey, json = false) {
  const credential = String(apiKey).trim().replace(/^Key\s+/i, "");
  return { Authorization: `Key ${credential}`, ...(json ? { "Content-Type": "application/json" } : {}) };
}

function normalizeActualCost(cost, currency) {
  const amount = Number(cost);
  return String(currency || "USD").toUpperCase() === "USD" && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function mapHedraState(status) {
  return ({
    in_queue: "queueing",
    queued: "queueing",
    pending: "queueing",
    in_progress: "processing",
    processing: "processing",
    running: "processing",
    finalizing: "processing",
    completed: "success",
    complete: "success",
    success: "success",
    failed: "failed",
    error: "failed",
    cancelled: "cancelled",
    canceled: "cancelled"
  })[String(status || "").toLowerCase()] || "created";
}
