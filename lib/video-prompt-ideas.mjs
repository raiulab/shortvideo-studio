import { providerError, readProviderJson } from "../providers/utils.mjs";

export const promptIdeaMoods = Object.freeze({
  funny: "funny, dryly comic, and character-driven",
  lonely: "lonely, wistful, and quietly melancholic",
  lovable: "tender, lovable, and emotionally intimate",
  uneasy: "subtly ominous, uneasy, and suspenseful",
  surreal: "surreal, absurd, and inexplicably compelling"
});

export function normalizePromptIdeaInput(input = {}) {
  const mode = input.mode === "topic" ? "topic" : "free";
  const topic = String(input.topic || "").trim().slice(0, 500);
  if (mode === "topic" && !topic) throw providerError(400, "お題を入力してください。");
  const moods = [...new Set((Array.isArray(input.moods) ? input.moods : [])
    .map(String).filter(value => Object.hasOwn(promptIdeaMoods, value)))].slice(0, 5);
  return {
    mode,
    topic,
    moods,
    subjectName: String(input.subjectName || "the subject").trim().slice(0, 100),
    subjectType: input.subjectType === "scene" ? "scene" : "character",
    profile: String(input.profile || "").trim().slice(0, 1500),
    compositionPrompt: String(input.compositionPrompt || "").trim().slice(0, 1200),
    imageSource: ["uploaded-start-frame", "composition", "registered", "reference-images"].includes(input.imageSource)
      ? input.imageSource
      : "registered",
    duration: Math.min(15, Math.max(3, Number(input.duration) || 5)),
    aspectRatio: ["16:9", "1:1", "9:16"].includes(input.aspectRatio) ? input.aspectRatio : "16:9",
    audio: Boolean(input.audio),
    images: (Array.isArray(input.images) ? input.images : input.image ? [input.image] : []).filter(Boolean).slice(0, 7)
  };
}

export function buildVideoPromptIdeaRequest(input, { maxOutputTokens = 1024 } = {}) {
  const normalized = normalizePromptIdeaInput(input);
  const mood = normalized.moods.length
    ? normalized.moods.map(value => promptIdeaMoods[value]).join("; ")
    : "choose the most distinctive emotional tone for this subject";
  const visualReference = normalized.imageSource === "uploaded-start-frame"
    ? "An uploaded first-frame image is attached. Treat it as the exact opening composition for the video."
    : normalized.imageSource === "reference-images"
      ? normalized.images.length + " reference images are attached. Treat all of them as a single consistent visual reference; preserve the shared subject, setting, and important details without contradicting any image."
    : normalized.compositionPrompt
      ? `The selected first frame was composed with this request: ${normalized.compositionPrompt}`
      : "Use the attached registered image as the visual reference.";
  const parts = [{ text: [
    `Subject name: ${normalized.subjectName}`,
    `Subject type: ${normalized.subjectType}`,
    normalized.profile ? `Registered profile: ${normalized.profile}` : "Registered profile: none",
    visualReference,
    normalized.mode === "topic" ? `Required situation/topic: ${normalized.topic}` : "Mode: free invention. Invent an unexpected but visually clear situation that suits this subject.",
    `Desired mood: ${mood}`,
    "Creative requirement: treat the image as frame zero, not as the story. Invent a clear cause-and-effect event that begins after this frame and turns the selected mood into visible motion, atmosphere, and an ending beat.",
    "Spend most of the final prompt on what newly happens over time. Mention existing image details only when they are needed to preserve continuity or explain an interaction.",
    `Video constraints: about ${normalized.duration} seconds, ${normalized.aspectRatio}.`,
    normalized.audio ? "The selected video service supports audio: include one concise sound or ambience cue." : "Do not rely on dialogue or audio to make the action understandable."
  ].join("\n") }];
  for (const image of normalized.images) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  return {
    system_instruction: {
      parts: [{ text: [
        "You write production-ready English prompts for short image-to-video generation.",
        "Return only one English prompt with no heading, explanation, quotation marks, markdown, or alternatives.",
        "This is not an image-captioning task. Silently inspect the image for continuity, but do not use the final prompt mainly to list or interpret what is already visible.",
        "Treat the supplied image as frame zero of a new micro-story. Silently consider at least three different continuations and choose the most distinctive one that is filmable within the stated duration.",
        "Create one continuous shot with a causal progression: an initiating change, a subject or environmental reaction, a small escalation, and a memorable final beat. Avoid a prompt where the subject merely looks around, smiles, walks, or poses unless something specific and surprising develops from it.",
        "Make the requested mood visible through concrete cinematic behavior: timing, body language or environmental motion, light and shadow changes, weather or particles when appropriate, spatial depth, color atmosphere, and one meaningful interaction with the existing scene.",
        "For a character, include a character-specific action and an emotional shift. For a scene, build the arc through environmental motion, changing light, a reveal, or an unusual physical event instead of inventing a person.",
        "Use restrained but intentional camera behavior that reinforces the feeling—such as a slow push, lateral drift, locked-off tension, or subtle handheld response—rather than adding camera terminology without purpose.",
        "Use the supplied image as the exact opening composition. Preserve identity, face, body proportions, clothing, colors, setting geometry, and major objects at the start; after frame zero, allow plausible motion, lighting changes, atmosphere, particles, and interactions. Do not add a new major character or unrelated object unless the topic requires it.",
        "When the supplied image is an uploaded first frame, it is the single source of truth for visible people, clothing, objects, setting, composition, and initial lighting. Never restore details from the registered profile that conflict with that image; use the profile only for compatible personality and behavior.",
        "Describe only events that can occur within the stated duration. Include one primary action, one secondary atmospheric motion, an emotional or visual payoff, and a concise sound cue only when audio is enabled.",
        "Before answering, silently reject and rewrite any result that is mostly a description of the source image or lacks a visible change between the opening and ending frames.",
        "Avoid cuts, scene changes, montages, captions, subtitles, logos, and abstract backstory. Keep the result between 70 and 130 words."
      ].join("\n") }]
    },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens,
      thinkingConfig: { thinkingLevel: "low" }
    }
  };
}

export async function generateVideoPromptIdea(input, env = process.env) {
  if (!env.GEMINI_API_KEY) throw providerError(400, ".env に GEMINI_API_KEY を設定してください。");
  const model = String(env.GEMINI_PROMPT_MODEL || "gemini-3.6-flash").trim();
  const request = async maxOutputTokens => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(buildVideoPromptIdeaRequest(input, { maxOutputTokens }))
    });
    return readProviderJson(response, "動画プロンプトを作成できませんでした。");
  };
  let data = await request(1024);
  let retried = false;
  if ((data.candidates || []).some(candidate => candidate.finishReason === "MAX_TOKENS")) {
    retried = true;
    data = await request(1536);
  }
  const text = (data.candidates || []).flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || "").join("\n").trim()
    .replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "")
    .replace(/^(?:video prompt|prompt)\s*:\s*/i, "").trim();
  if ((data.candidates || []).some(candidate => candidate.finishReason === "MAX_TOKENS")) {
    throw providerError(502, "動画プロンプトが途中で終了しました。もう一度「プロンプト作成」を押してください。", data);
  }
  if (!text) throw providerError(502, "Geminiから動画プロンプトを取得できませんでした。", data);
  return { prompt: text.slice(0, 3000), model, usage: data.usageMetadata || null, retried };
}
