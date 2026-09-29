export function resolveRegisteredSourceImage(images, requestedName) {
  const name = String(requestedName || "").trim();
  if (!name) return null;

  const image = images.find(item => item.name === name);
  if (image) return image;

  const error = new Error("選択した元画像が見つかりません。画像を選び直してください。");
  error.status = 400;
  throw error;
}
