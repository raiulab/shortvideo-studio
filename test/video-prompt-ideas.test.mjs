import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoPromptIdeaRequest,
  generateVideoPromptIdea,
  normalizePromptIdeaInput
} from "../lib/video-prompt-ideas.mjs";

test("お題・複数の雰囲気・キャラクター画像から動画プロンプト作成リクエストを組み立てる", () => {
  const body = buildVideoPromptIdeaRequest({
    mode: "topic",
    topic: "終電後の無人駅で、雨に濡れた広告を見ている",
    moods: ["lonely", "surreal"],
    subjectName: "demo-subject",
    profile: "爪を齧る癖がある。",
    duration: 5,
    aspectRatio: "16:9",
    audio: true,
    image: { mimeType: "image/png", base64: "SU1BR0U=" }
  });
  const text = body.contents[0].parts[0].text;
  assert.match(text, /終電後の無人駅/);
  assert.match(text, /lonely/);
  assert.match(text, /surreal/);
  assert.match(text, /about 5 seconds, 16:9/);
  assert.equal(body.contents[0].parts[1].inline_data.mime_type, "image/png");
  assert.match(body.system_instruction.parts[0].text, /Return only one English prompt/);
});

test("複数の参照画像を動画プロンプト作成へ渡す", () => {
  const body = buildVideoPromptIdeaRequest({
    mode: "free",
    imageSource: "reference-images",
    images: [
      { mimeType: "image/png", base64: "SU1BR0Ux" },
      { mimeType: "image/webp", base64: "SU1BR0Uy" }
    ]
  });
  assert.match(body.contents[0].parts[0].text, /2 reference images are attached/i);
  assert.equal(body.contents[0].parts.filter(part => part.inline_data).length, 2);
});

test("お題モードは空のお題を拒否する", () => {
  assert.throws(() => normalizePromptIdeaInput({ mode: "topic", topic: "" }), /お題を入力/);
});

test("アップロードした開始フレームを動画の正確な開始構図として指示する", () => {
  const body = buildVideoPromptIdeaRequest({
    mode: "free",
    imageSource: "uploaded-start-frame",
    image: { mimeType: "image/webp", base64: "U1RBUlQ=" }
  });
  const text = body.contents[0].parts[0].text;
  assert.match(text, /uploaded first-frame image is attached/i);
  assert.match(text, /exact opening composition/i);
  assert.equal(body.contents[0].parts[1].inline_data.mime_type, "image/webp");
  assert.match(body.system_instruction.parts[0].text, /single source of truth/i);
  assert.match(body.system_instruction.parts[0].text, /conflict with that image/i);
  assert.match(text, /frame zero, not as the story/i);
  assert.match(body.system_instruction.parts[0].text, /not an image-captioning task/i);
  assert.match(body.system_instruction.parts[0].text, /at least three different continuations/i);
  assert.match(body.system_instruction.parts[0].text, /initiating change/i);
  assert.match(body.system_instruction.parts[0].text, /mostly a description of the source image/i);
});

test("Geminiの返答から見出しとコードフェンスを除いてプロンプトを返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /gemini-3\.6-flash:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "```text\nPrompt: The character slowly looks up.\n```" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateVideoPromptIdea({ mode: "free" }, { GEMINI_API_KEY: "test-key" });
    assert.equal(result.prompt, "The character slowly looks up.");
    assert.equal(result.model, "gemini-3.6-flash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MAX_TOKENSで途中終了したプロンプトは出力枠を増やして自動で作り直す", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const retry = requests.length === 2;
    return new Response(JSON.stringify({
      candidates: [{
        finishReason: retry ? "STOP" : "MAX_TOKENS",
        content: { parts: [{ text: retry ? "The cat stops, looks back, and continues through the blue dunes." : "The cat stops in the" }] }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateVideoPromptIdea({ mode: "free" }, { GEMINI_API_KEY: "test-key" });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].generationConfig.maxOutputTokens, 1024);
    assert.equal(requests[1].generationConfig.maxOutputTokens, 1536);
    assert.equal(result.prompt, "The cat stops, looks back, and continues through the blue dunes.");
    assert.equal(result.retried, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
