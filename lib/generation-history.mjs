import { join } from "node:path";

const deletableStates = new Set(["success", "failed", "cancelled"]);

export function selectGenerationsForDeletion(generations, requestedIds) {
  const ids = [...new Set(
    (Array.isArray(requestedIds) ? requestedIds : [])
      .map(id => String(id || "").trim())
      .filter(Boolean)
  )];

  if (!ids.length) throw historyError(400, "削除する生成履歴を選択してください。");
  if (ids.length > 100) throw historyError(400, "一度に削除できる生成履歴は100件までです。");

  const byId = new Map(generations.map(item => [item.id, item]));
  const selected = ids.map(id => byId.get(id));
  if (selected.some(item => !item)) throw historyError(404, "選択した生成履歴が見つかりません。");
  if (selected.some(item => !deletableStates.has(item.state))) {
    throw historyError(409, "受付中・待機中・生成中の履歴は、先にキャンセルしてください。");
  }
  return selected;
}

export function outputPathForGeneration(outputDir, localUrl) {
  const match = String(localUrl || "").match(/^\/outputs\/([A-Za-z0-9-]+\.mp4)$/);
  return match ? join(outputDir, match[1]) : null;
}

export function inputPathForGeneration(inputDir, localUrl) {
  const match = String(localUrl || "").match(/^\/inputs\/([A-Za-z0-9-]+\.(?:png|jpg|webp))$/);
  return match ? join(inputDir, match[1]) : null;
}

function historyError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
