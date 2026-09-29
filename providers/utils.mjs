export function providerError(status, message, details = null) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

export async function readProviderJson(response, fallbackMessage) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw providerError(
      response.status,
      data.error?.message || data.message || data.error || fallbackMessage,
      data
    );
  }
  return data;
}

export function dataUrlParts(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw providerError(400, "送信する画像データの形式が正しくありません。");
  return { mimeType: match[1], base64: match[2] };
}

export function ensureModel(provider, modelId, mode) {
  const requestedId = String(modelId || "").trim();
  const model = requestedId
    ? provider.models.find(item => item.id === requestedId)
    : provider.models.find(item => item.default && item.modes.includes(mode))
      || provider.models.find(item => item.modes.includes(mode));
  if (!model || !model.modes.includes(mode)) {
    throw providerError(400, `${provider.name}では選択した生成方式とモデルを組み合わせられません。`);
  }
  return model;
}

export function ensureOption(value, allowed, fallback, label) {
  const normalized = typeof fallback === "number" ? Number(value) : String(value || "");
  const result = allowed.includes(normalized) ? normalized : fallback;
  if (!allowed.includes(result)) throw providerError(400, `${label}の指定が正しくありません。`);
  return result;
}
