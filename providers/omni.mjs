import { dataUrlParts, ensureModel, ensureOption, providerError, readProviderJson } from "./utils.mjs";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta";

export const omniProvider = {
  id: "omni",
  name: "Gemini Omni",
  configured(env) { return Boolean(env.GEMINI_API_KEY); },
  envKey: "GEMINI_API_KEY",
  cancelStates: [],
  notes: "人物・映像の一貫性に強い、Google推奨の短尺動画モデルです。動画延長・開始終了フレーム補間には対応しません。",
  models: [
    {
      id: "gemini-omni-flash-preview",
      label: "Gemini Omni Flash（Preview）",
      default: true,
      modes: ["image-to-video", "reference-to-video", "text-to-video"],
      durations: [3, 4, 5, 6, 8, 10],
      resolutions: ["720p"],
      aspectRatios: ["9:16", "16:9"],
      audioMode: "always",
      price: { type: "per-second", rates: { "720p": 0.10 } },
      summary: {
        cost: "約 $0.10/秒（約¥17、720p）",
        features: "短尺生成・画像を組み合わせた指示・人物／映像の一貫性",
        limits: "3〜10秒・720p。延長と開始／終了フレーム補間は不可"
      }
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
      audio: true,
      offPeak: false
    };
  },
  estimate(input) {
    return input.duration * 0.10;
  },
  async create(input, env) {
    if (!env.GEMINI_API_KEY) throw providerError(400, ".env に GEMINI_API_KEY を設定してください。");
    const response = await fetch(`${baseUrl}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(buildOmniRequestBody(input))
    });
    const data = await readProviderJson(response, "Gemini Omniへの送信に失敗しました。");
    if (!data.id) throw providerError(502, "Gemini Omniの生成IDを取得できませんでした。");
    // The create response can already be completed, but the local app retrieves the
    // delivered URI/base64 through the normal polling path before marking it finished.
    return { taskId: data.id, state: data.status === "failed" ? "failed" : "processing" };
  },
  async get(taskId, env) {
    const response = await fetch(`${baseUrl}/interactions/${encodeURIComponent(taskId)}`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }
    });
    const data = await readProviderJson(response, "Gemini Omniの生成状態を取得できませんでした。");
    const video = data.steps?.flatMap(step => step.content || []).find(item => item.type === "video");
    return {
      state: omniState(data.status),
      outputBase64: video?.data || null,
      outputUrl: video?.uri || null,
      downloadHeaders: video?.uri ? { "x-goog-api-key": env.GEMINI_API_KEY } : undefined,
      failure: data.error?.message || null
    };
  }
};

export function buildOmniRequestBody(input) {
  const task = ({
    "text-to-video": "text_to_video",
    "image-to-video": "image_to_video",
    "reference-to-video": "reference_to_video"
  })[input.mode];
  if (!task) throw providerError(400, "Gemini Omniではこの生成方式を利用できません。");
  const images = input.mode === "image-to-video" ? [input.startImage] : input.images || [];
  const content = [
    ...images.filter(Boolean).map(imagePart),
    { type: "text", text: input.prompt }
  ];
  return {
    model: input.model,
    input: input.mode === "text-to-video" ? input.prompt : content,
    response_format: { type: "video", delivery: "uri", aspect_ratio: input.aspectRatio },
    generation_config: { video_config: { task } }
  };
}

function imagePart(dataUrl) {
  const { mimeType, base64 } = dataUrlParts(dataUrl);
  return { type: "image", data: base64, mime_type: mimeType };
}

function omniState(status) {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  return "processing";
}
