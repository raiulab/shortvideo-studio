import { providerError, readProviderJson } from "../providers/utils.mjs";

export const seedreamImageModels = Object.freeze([
  { id: "seedream-4-5-251128", label: "Seedream 4.5（推奨）", price: 0.04, default: true },
  { id: "seedream-5-0-lite-260128", label: "Seedream 5.0 Lite（低コスト）", price: 0.035 }
]);

const sizeByRatio = Object.freeze({
  "16:9": "2560x1440",
  "1:1": "2048x2048",
  "9:16": "1440x2560"
});

export function normalizeSeedreamCompositionInput(input = {}) {
  const requestedModel = typeof input.model === "object" ? input.model?.id : input.model;
  const model = seedreamImageModels.find(item => item.id === String(requestedModel || ""))
    || seedreamImageModels.find(item => item.default);
  const aspectRatio = Object.hasOwn(sizeByRatio, input.aspectRatio) ? input.aspectRatio : "16:9";
  const images = (Array.isArray(input.images) ? input.images : []).map(String).filter(Boolean);
  if (images.length < 2) throw providerError(400, "合成元の画像を2枚以上選択してください。");
  if (images.length > 6) throw providerError(400, "合成元の画像は6枚までです。");
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw providerError(400, "どのように合成するか入力してください。");
  return { model, aspectRatio, size: sizeByRatio[aspectRatio], images, prompt };
}

export function buildSeedreamCompositionBody(input) {
  const normalized = normalizeSeedreamCompositionInput(input);
  return {
    model: normalized.model.id,
    prompt: normalized.prompt,
    image: normalized.images,
    size: normalized.size,
    sequential_image_generation: "disabled",
    response_format: "b64_json",
    stream: false,
    watermark: false
  };
}

export async function generateSeedreamComposition(input, env = process.env) {
  if (!env.ARK_API_KEY) throw providerError(400, ".env に ARK_API_KEY を設定してください。");
  const body = buildSeedreamCompositionBody(input);
  const response = await fetch("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ARK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await readProviderJson(response, "Seedreamの画像合成に失敗しました。");
  const output = data.data?.[0];
  if (!output?.b64_json && !output?.url) {
    throw providerError(502, "Seedreamから合成画像を取得できませんでした。", data);
  }
  return {
    id: data.id || null,
    base64: output.b64_json || null,
    url: output.url || null,
    size: output.size || body.size,
    model: body.model
  };
}

export function seedreamCompositionCost(modelId) {
  return seedreamImageModels.find(item => item.id === modelId)?.price
    ?? seedreamImageModels.find(item => item.default).price;
}
