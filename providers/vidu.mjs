import { ensureModel, ensureOption, providerError } from "./utils.mjs";

const id = "vidu";

export const viduProvider = {
  id,
  name: "Vidu",
  configured(env) { return Boolean(env.VIDU_API_KEY); },
  envKey: "VIDU_API_KEY",
  cancelStates: ["created", "queueing"],
  notes: "ViduはImage／Reference／Text／Start End／Digital Humanに対応します。",
  extension: {
    source: "vidu-creation",
    kind: "native",
    supportsFinalFrame: true,
    maxSourceDuration: 60,
    note: "Viduの専用延長APIで1〜7秒追加します。",
    models: [
      { id: "viduq2-turbo", label: "Q2 Turbo", default: true },
      { id: "viduq2-pro", label: "Q2 Pro" }
    ],
    durations: [1, 2, 3, 4, 5, 6, 7],
    resolutions: ["540p", "720p", "1080p"]
  },
  models: [
    {
      id: "viduq3-turbo",
      label: "Q3 Turbo",
      default: true,
      modes: ["image-to-video", "reference-to-video", "text-to-video", "start-end-to-video"],
      durations: [3, 4, 5, 6, 8, 10, 12, 15],
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["9:16", "16:9", "1:1"],
      audioMode: "optional",
      offPeak: true,
      price: { type: "vidu" }
    },
    {
      id: "viduq3",
      label: "Q3",
      modes: ["reference-to-video"],
      durations: [3, 4, 5, 6, 8, 10, 12, 15],
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["9:16", "16:9", "1:1"],
      audioMode: "optional",
      offPeak: true,
      price: { type: "vidu" }
    },
    {
      id: "viduq3-pro",
      label: "Q3 Pro",
      modes: ["text-to-video", "start-end-to-video"],
      durations: [3, 4, 5, 6, 8, 10, 12, 15],
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["9:16", "16:9", "1:1"],
      audioMode: "optional",
      offPeak: true,
      price: { type: "vidu" }
    },
    {
      id: "viduq2-turbo",
      label: "Q2 Turbo",
      modes: ["digital-human"],
      durations: [5],
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["9:16"],
      audioMode: "external",
      offPeak: false,
      price: { type: "after-generation" }
    },
    {
      id: "viduq2-pro",
      label: "Q2 Pro",
      modes: ["digital-human"],
      durations: [5],
      resolutions: ["540p", "720p", "1080p"],
      aspectRatios: ["9:16"],
      audioMode: "external",
      offPeak: false,
      price: { type: "after-generation" }
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
      offPeak: Boolean(input.offPeak)
    };
  },
  estimate(input) {
    if (input.mode === "digital-human") return 0;
    let rate;
    if (input.mode !== "reference-to-video") {
      rate = input.model === "viduq3-pro"
        ? input.resolution === "540p" ? 0.045 : input.resolution === "1080p" ? 0.12 : 0.10
        : input.resolution === "540p" ? 0.035 : input.resolution === "1080p" ? 0.065 : 0.055;
    } else {
      rate = input.model === "viduq3"
        ? input.resolution === "540p" ? 0.035 : input.resolution === "1080p" ? 0.075 : 0.06
        : input.resolution === "540p" ? 0.02 : input.resolution === "1080p" ? 0.065 : 0.05;
    }
    return input.duration * rate * (input.offPeak ? 0.5 : 1);
  },
  actualCost(record) {
    if (record.credits === null || record.credits === undefined || record.credits === "") return null;
    const credits = Number(record.credits);
    return Number.isFinite(credits) && credits >= 0
      ? Math.round(credits * 0.005 * 10000) / 10000
      : null;
  },
  async create(input, env) {
    if (!env.VIDU_API_KEY) throw providerError(400, ".env に VIDU_API_KEY を設定してください。");
    const endpoint = {
      "image-to-video": "img2video",
      "reference-to-video": "reference2video",
      "text-to-video": "text2video",
      "start-end-to-video": "start-end2video",
      "digital-human": "digital-human"
    }[input.mode];
    if (!endpoint) throw providerError(400, "Viduの生成方式が正しくありません。");
    const body = buildViduRequestBody(input);
    const response = await fetch(`https://api.vidu.com/ent/v2/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Token ${env.VIDU_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response.status, data.message || data.error || "Viduへの送信に失敗しました。");
    return { taskId: data.task_id, state: data.state || "created", credits: data.credits || null };
  },
  async get(taskId, env) {
    if (!env.VIDU_API_KEY) throw providerError(400, "Vidu API未設定です。");
    const response = await fetch(`https://api.vidu.com/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`, { headers: { Authorization: `Token ${env.VIDU_API_KEY}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response.status, data.message || "生成状態を取得できませんでした。");
    const creation = data.creations?.[0] || null;
    return {
      state: data.state,
      credits: data.credits,
      creationId: creation?.id || null,
      outputUrl: creation?.url || null,
      failure: data.err_code || null
    };
  },
  normalizeExtension(input) {
    const models = this.extension.models;
    const requestedModel = String(input.model || "").trim();
    const model = requestedModel
      ? models.find(item => item.id === requestedModel)
      : models.find(item => item.default) || models[0];
    if (!model) throw providerError(400, "Viduの延長モデルが正しくありません。");
    if (Number(input.sourceDuration) > this.extension.maxSourceDuration) {
      throw providerError(409, "Viduで延長できる元動画は60秒以下です。");
    }
    return {
      ...input,
      model: model.id,
      prompt: String(input.prompt || "").trim(),
      duration: ensureOption(input.duration, this.extension.durations, 5, "追加時間"),
      resolution: ensureOption(input.resolution, this.extension.resolutions, "720p", "解像度")
    };
  },
  canExtend(record) {
    return Number(record.duration) <= this.extension.maxSourceDuration;
  },
  estimateExtension(input) {
    const prices = {
      "viduq2-turbo": {
        "540p": [0.05, 0.01],
        "720p": [0.075, 0.025],
        "1080p": [0.20, 0.05]
      },
      "viduq2-pro": {
        "540p": [0.075, 0.025],
        "720p": [0.15, 0.05],
        "1080p": [0.30, 0.075]
      }
    };
    const [start, additional] = prices[input.model]?.[input.resolution] || [0, 0];
    return start + Math.max(0, Number(input.duration) - 1) * additional;
  },
  async extend(input, env) {
    if (!env.VIDU_API_KEY) throw providerError(400, ".env に VIDU_API_KEY を設定してください。");
    const response = await fetch("https://api.vidu.com/ent/v2/extend", {
      method: "POST",
      headers: { Authorization: `Token ${env.VIDU_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildViduExtensionRequestBody(input))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response.status, data.message || data.error || "Viduの続きを送信できませんでした。");
    return {
      taskId: data.task_id,
      state: data.state || "created",
      credits: data.credits ?? null
    };
  },
  async cancel(taskId, env) {
    if (!env.VIDU_API_KEY) throw providerError(400, "Vidu API未設定です。");
    const response = await fetch(`https://api.vidu.com/ent/v2/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Token ${env.VIDU_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId })
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw providerError(response.status, data.message || "生成タスクをキャンセルできませんでした。");
    return { state: "cancelled" };
  }
};

export function buildViduExtensionRequestBody(input) {
  if (!input.videoCreationId || !input.videoUrl) {
    throw providerError(409, "元動画のVidu生成情報を取得できません。生成状態を更新してから再度お試しください。");
  }
  return {
    model: input.model,
    video_creation_id: input.videoCreationId,
    video_url: input.videoUrl,
    images: input.finalFrameImage ? [input.finalFrameImage] : undefined,
    prompt: input.prompt || undefined,
    duration: input.duration,
    resolution: input.resolution,
    payload: `shortvideo:extend:${input.parentGenerationId}:${Date.now()}`
  };
}

export function buildViduRequestBody(input, now = Date.now()) {
  if (input.mode === "reference-to-video" && (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 7)) {
    throw providerError(400, "Reference to Videoの参照画像は1〜7枚選択してください。");
  }

  if (input.mode === "image-to-video") {
    return {
        model: input.model,
        images: [input.startImage],
        prompt: input.prompt,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        audio: input.audio,
        audio_type: input.audio ? "all" : undefined,
        off_peak: input.offPeak,
        movement_amplitude: "auto",
        payload: `shortvideo:${input.characterId}:image:${now}`
      };
  }

  if (input.mode === "reference-to-video") {
    return {
      model: input.model,
        images: input.images,
        prompt: input.prompt,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        audio: input.audio,
        audio_type: input.audio ? "all" : undefined,
        off_peak: input.offPeak,
        payload: `shortvideo:${input.characterId}:reference:${now}`
      };
  }

  if (input.mode === "text-to-video") {
    return {
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      audio: input.audio,
      audio_type: input.audio ? "all" : undefined,
      off_peak: input.offPeak,
      payload: `shortvideo:${input.characterId}:text:${now}`
    };
  }

  if (input.mode === "start-end-to-video") {
    if (!input.startImage || !input.endImage) {
      throw providerError(400, "Start End to Videoには開始・終了の画像を1枚ずつ指定してください。");
    }
    return {
      model: input.model,
      images: [input.startImage, input.endImage],
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      audio: input.audio,
      audio_type: input.audio ? "all" : undefined,
      off_peak: input.offPeak,
      payload: `shortvideo:${input.characterId}:start-end:${now}`
    };
  }

  if (input.mode === "digital-human") {
    if (!input.startImage || !input.audioUrl) {
      throw providerError(400, "Digital Humanには静止画と音声ファイルが必要です。");
    }
    return {
      model: input.model,
      image: input.startImage,
      audio_url: input.audioUrl,
      prompt: input.prompt || undefined,
      resolution: input.resolution,
      payload: `shortvideo:${input.characterId}:digital-human:${now}`
    };
  }

  throw providerError(400, "Viduの生成方式が正しくありません。");
}
