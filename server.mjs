import { createServer } from "node:http";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat, unlink, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider, listProviders } from "./providers/index.mjs";
import { resolveRegisteredSourceImage } from "./lib/source-image.mjs";
import { inputPathForGeneration, outputPathForGeneration, selectGenerationsForDeletion } from "./lib/generation-history.mjs";
import { concatenateVideoFiles, concatenateVideos, extractLastFrameDataUrl } from "./lib/video-tools.mjs";
import {
  generateSeedreamComposition,
  normalizeSeedreamCompositionInput,
  seedreamCompositionCost,
  seedreamImageModels
} from "./lib/seedream-image.mjs";
import { generateVideoPromptIdea } from "./lib/video-prompt-ideas.mjs";
import {
  assertProviderBudgetAllows,
  defaultProviderBudgetSettings,
  normalizeProviderBudgetSettings,
  providerIds,
  summarizeProviderCosts,
  summarizeProviderMonthlyHistory,
  updateProviderBudgetSetting
} from "./lib/provider-budget.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const charactersDir = join(root, "characters");
const databasePath = join(root, "data", "characters.json");
const generationsPath = join(root, "data", "generations.json");
const generationSequencesPath = join(root, "data", "generation-sequences.json");
const providerBudgetSettingsPath = join(root, "data", "provider-budgets.json");
const providerCostLedgerPath = join(root, "data", "provider-cost-ledger.json");
const legacySeedanceBudgetSettingsPath = join(root, "data", "seedance-budget.json");
const legacySeedanceBudgetLedgerPath = join(root, "data", "seedance-budget-ledger.json");
const temporaryAudioPath = join(root, "data", "temporary-audio.json");
const imageCompositionsPath = join(root, "data", "image-compositions.json");
const outputDir = join(root, "projects", "outputs");
const generationInputDir = join(root, "projects", "inputs");
const compositionOutputDir = join(root, "projects", "compositions");
const maxBodyBytes = 20 * 1024 * 1024;
const maxCharacterImages = 15;
const maxReferenceImages = 7;
const maxReferenceImageBytes = 14 * 1024 * 1024;
const maxAudioUploadBytes = 15 * 1024 * 1024;
const maxCompositionImages = 6;
const maxCompositionInputBytes = 18 * 1024 * 1024;
const maxCompositionOutputBytes = 20 * 1024 * 1024;
const audioRetentionMs = 24 * 60 * 60 * 1000;
let providerCostQueue = Promise.resolve();
const seedreamCostProvider = Object.freeze({ id: "seedream", name: "Seedream" });

await loadEnv(join(root, ".env"));
const port = Number(process.env.PORT || 4173);
setInterval(() => {
  removeExpiredAudioUploads().catch(error => console.error("期限切れ音声の削除に失敗しました。", error));
}, 60 * 60 * 1000).unref();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".wma": "audio/x-ms-wma"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        viduConfigured: Boolean(process.env.VIDU_API_KEY),
        capabilities: {
          explicitSourceImage: true,
          referenceSingleImage: true,
          textToVideo: true,
          startEndToVideo: true,
          digitalHuman: true,
          multiProvider: true,
          comparisonGeneration: true,
          videoExtension: true,
          videoConcatenation: true,
          imageComposition: Boolean(process.env.ARK_API_KEY),
          promptIdeas: Boolean(process.env.GEMINI_API_KEY)
        },
        providers: listProviders(process.env),
        imageComposition: {
          configured: Boolean(process.env.ARK_API_KEY),
          models: seedreamImageModels
        },
        promptIdeas: {
          configured: Boolean(process.env.GEMINI_API_KEY),
          model: process.env.GEMINI_PROMPT_MODEL || "gemini-3.6-flash"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/characters") {
      const characters = await readCharacters();
      const result = await Promise.all(characters.filter(character => !character.temporary).map(async character => ({
        ...character,
        images: await listImages(character.id)
      })));
      return json(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/generations") return json(response, 200, await readGenerations());

    if (request.method === "GET" && url.pathname === "/api/compositions") {
      return json(response, 200, await readImageCompositions());
    }

    if (request.method === "POST" && url.pathname === "/api/prompt-ideas") {
      const body = await readJson(request);
      const character = (await readCharacters()).find(item => item.id === String(body.characterId || ""));
      if (!character) return json(response, 404, { error: "選択中の素材が見つかりません。" });
      let image = null;
      let images = [];
      let compositionPrompt = "";
      const rawStartFrameImage = String(body.startFrameImage || "");
      const startFrameImage = rawStartFrameImage ? validateImageDataUrl(rawStartFrameImage) : null;
      if (rawStartFrameImage && !startFrameImage) {
        return json(response, 400, { error: "開始フレームにはPNG、JPEG、WebP画像を選択してください。" });
      }
      let imageSource = "registered";
      if (startFrameImage) {
        image = inlineImageFromDataUrl(startFrameImage);
        imageSource = "uploaded-start-frame";
      } else if (body.compositionId) {
        const composition = (await readImageCompositions()).find(item => item.id === String(body.compositionId));
        if (!composition) return json(response, 404, { error: "選択した合成画像が見つかりません。" });
        image = inlineImageFromDataUrl(await compositionImageToDataUrl(composition));
        compositionPrompt = composition.prompt || composition.sentPrompt || "";
        imageSource = "composition";
      } else {
        const registered = resolveRegisteredSourceImage(await listImages(character.id), body.sourceImageName);
        if (registered) image = inlineImageFromDataUrl(await imageFileToDataUrl(character.id, registered.name));
      }
      const referenceImages = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
        .map(validateImageDataUrl)
        .filter(Boolean);
      if (Array.isArray(body.referenceImages) && referenceImages.length !== body.referenceImages.length) {
        return json(response, 400, { error: "参照画像にはPNG、JPEG、WebP画像を指定してください。" });
      }
      if (referenceImages.length > maxReferenceImages) {
        return json(response, 400, { error: "参照画像は最大" + maxReferenceImages + "枚までです。" });
      }
      if (referenceImages.length) {
        images = referenceImages.map(inlineImageFromDataUrl);
        imageSource = "reference-images";
      } else if (image) {
        images = [image];
      }
      const result = await generateVideoPromptIdea({
        mode: body.ideaMode,
        topic: body.topic,
        moods: body.moods,
        subjectName: character.name,
        subjectType: normalizeAssetType(character.type),
        profile: character.description,
        compositionPrompt,
        imageSource,
        duration: body.duration,
        aspectRatio: body.aspectRatio,
        audio: body.audio,
        images
      }, process.env);
      return json(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/compositions") {
      const body = await readJson(request, 24 * 1024 * 1024);
      if (!process.env.ARK_API_KEY) return json(response, 400, { error: ".env に ARK_API_KEY を設定してください。" });
      const characters = await readCharacters();
      const registered = Array.isArray(body.registeredImages) ? body.registeredImages : [];
      const uploaded = (Array.isArray(body.uploadedImages) ? body.uploadedImages : [])
        .map(validateImageDataUrl)
        .filter(Boolean);
      if (registered.length + uploaded.length < 2) {
        return json(response, 400, { error: "合成元の画像を2枚以上選択してください。" });
      }
      if (registered.length + uploaded.length > maxCompositionImages) {
        return json(response, 400, { error: `合成元の画像は${maxCompositionImages}枚までです。` });
      }

      const registeredInputs = [];
      for (const reference of registered) {
        const assetId = String(reference?.assetId || "").trim();
        const imageName = String(reference?.imageName || "").trim();
        const asset = characters.find(item => item.id === assetId);
        const image = asset && (await listImages(asset.id)).find(item => item.name === imageName);
        if (!asset || !image) return json(response, 400, { error: "選択した登録画像を確認できません。もう一度選択してください。" });
        registeredInputs.push({
          asset,
          image,
          dataUrl: await imageFileToDataUrl(asset.id, image.name)
        });
      }
      const images = [...registeredInputs.map(item => item.dataUrl), ...uploaded];
      if (images.reduce((total, image) => total + dataUrlByteLength(image), 0) > maxCompositionInputBytes) {
        return json(response, 413, { error: "合成元画像の合計は18MB以内にしてください。" });
      }
      const prompt = compositionPrompt(registeredInputs, uploaded.length, body.prompt, body.aspectRatio);
      const normalized = normalizeSeedreamCompositionInput({
        model: body.model,
        aspectRatio: body.aspectRatio,
        images,
        prompt
      });
      const recordId = createLocalId("img");
      const createdAt = new Date().toISOString();
      const cost = seedreamCompositionCost(normalized.model.id);
      const task = await submitProviderTask({
        provider: seedreamCostProvider,
        input: { model: normalized.model.id, mode: "image-composition" },
        recordId,
        createdAt,
        estimatedCost: cost,
        createTask: async () => {
          const providerInputs = await prepareSeedreamInputImages(images, recordId);
          try {
            const result = await generateSeedreamComposition({ ...normalized, images: providerInputs.images }, process.env);
            return { taskId: result.id || recordId, state: "success", result };
          } finally {
            await Promise.allSettled(providerInputs.objectKeys.map(deleteR2Object));
          }
        }
      });
      const saved = await saveCompositionOutput(task.result, recordId);
      const record = {
        id: recordId,
        providerTaskId: task.taskId,
        provider: "seedream",
        model: normalized.model.id,
        aspectRatio: normalized.aspectRatio,
        size: task.result.size || normalized.size,
        prompt: String(body.prompt || "").trim(),
        sentPrompt: prompt,
        sourceImages: registeredInputs.map(item => ({
          assetId: item.asset.id,
          assetName: item.asset.name,
          assetType: normalizeAssetType(item.asset.type),
          imageName: item.image.name,
          imageUrl: item.image.url
        })),
        uploadedImageCount: uploaded.length,
        inputImageCount: images.length,
        estimatedCost: cost,
        actualCost: cost,
        state: "success",
        fileName: saved.fileName,
        localUrl: saved.localUrl,
        createdAt
      };
      await saveImageComposition(record);
      return json(response, 201, record);
    }

    if (request.method === "GET" && url.pathname === "/api/costs") {
      return json(response, 200, await providerCostStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/costs/history") {
      return json(response, 200, await providerCostMonthlyHistory());
    }

      const budgetMatch = url.pathname.match(/^\/api\/budgets\/(vidu|runway|seedance|seedream|veo|omni|hedra)$/);
    if (request.method === "PUT" && budgetMatch) {
      const providerId = budgetMatch[1];
      const body = await readJson(request);
      const settings = updateProviderBudgetSetting(
        await readProviderBudgetSettings(),
        providerId,
        body.settings || body
      );
      await writeFile(providerBudgetSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      return json(response, 200, await providerCostStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/budgets/seedance") {
      const status = await providerCostStatus();
      return json(response, 200, status.providers.seedance);
    }

    if (request.method === "PUT" && url.pathname === "/api/budgets/seedance") {
      const body = await readJson(request);
      const settings = updateProviderBudgetSetting(
        await readProviderBudgetSettings(),
        "seedance",
        { enabled: true, ...(body.settings || body) }
      );
      await writeFile(providerBudgetSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      const status = await providerCostStatus();
      return json(response, 200, status.providers.seedance);
    }

    if (request.method === "DELETE" && url.pathname === "/api/generations") {
      const body = await readJson(request);
      const generations = await readGenerations();
      const selectedGenerations = selectGenerationsForDeletion(generations, body.ids);
      const selectedIdsRequested = new Set(selectedGenerations.map(item => item.id));
      const hasPendingPseudoChild = generations.some(item =>
        item.postProcess === "concat-parent"
        && ["created", "queueing", "processing"].includes(item.state)
        && selectedIdsRequested.has(item.parentGenerationId)
      );
      if (hasPendingPseudoChild) {
        return json(response, 409, { error: "Runwayの続き生成が完了するまで、元動画は削除できません。" });
      }
      const selectedIds = new Set(selectedGenerations.map(item => item.id));

      await Promise.all(selectedGenerations.map(async item => {
        const paths = [
          outputPathForGeneration(outputDir, item.localUrl),
          inputPathForGeneration(generationInputDir, item.startImageUrl),
          inputPathForGeneration(generationInputDir, item.endImageUrl),
          inputPathForGeneration(generationInputDir, item.finalFrameImageUrl)
        ].filter(Boolean);
        for (const path of new Set(paths)) {
          try {
            await unlink(path);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
      }));

      await writeFile(generationsPath, `${JSON.stringify(generations.filter(item => !selectedIds.has(item.id)), null, 2)}\n`);
      return json(response, 200, { deletedIds: [...selectedIds] });
    }

    if (request.method === "POST" && url.pathname === "/api/generations/concat") {
      const body = await readJson(request);
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(id => String(id || "").trim()).filter(Boolean))];
      if (ids.length < 2 || ids.length > 10) {
        return json(response, 400, { error: "結合できる動画は2〜10本です。" });
      }
      const generations = await readGenerations();
      const records = ids.map(id => generations.find(item => item.id === id));
      if (records.some(item => !item)) return json(response, 404, { error: "選択した動画が見つかりません。" });
      if (records.some(item => item.state !== "success" || !item.localUrl)) {
        return json(response, 409, { error: "完成してローカルに保存済みの動画だけを結合できます。" });
      }
      const inputPaths = records.map(item => outputPathForGeneration(outputDir, item.localUrl));
      if (inputPaths.some(path => !path)) return json(response, 409, { error: "選択した動画ファイルを読み込めません。" });
      const existing = await Promise.all(inputPaths.map(path => stat(path).then(info => info.isFile()).catch(() => false)));
      if (existing.some(value => !value)) return json(response, 409, { error: "選択した動画ファイルが見つかりません。" });

      const first = records[0];
      const record = {
        id: createLocalId("concat"),
        providerTaskId: null,
        comparisonGroupId: null,
        parentGenerationId: null,
        rootGenerationId: null,
        extensionDepth: 0,
        provider: "local",
        mode: "video-concat",
        characterId: first.characterId || "local",
        characterName: first.characterName || "動画結合",
        sourceGenerationIds: ids,
        sourceImageName: null,
        sourceImageUrl: null,
        startImageSource: null,
        providerImageCount: 0,
        prompt: `${records.length}本の動画を選択順に結合`,
        model: "local-concat",
        duration: records.reduce((total, item) => total + (Number(item.duration) || 0), 0),
        resolution: first.resolution || "720p",
        aspectRatio: first.aspectRatio || "9:16",
        audio: records.some(item => item.audio),
        offPeak: false,
        estimatedCost: 0,
        actualCost: 0,
        credits: null,
        state: "success",
        createdAt: new Date().toISOString()
      };
      await assignAutomaticTitles(generations, [record]);
      await mkdir(outputDir, { recursive: true });
      const outputPath = join(outputDir, outputFileName(record));
      await concatenateVideoFiles(inputPaths, outputPath);
      record.localUrl = `/outputs/${outputFileName(record)}`;
      generations.unshift(record);
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 201, record);
    }

    if (request.method === "POST" && url.pathname === "/api/generations/download") {
      const body = await readJson(request);
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(id => String(id || "").trim()).filter(Boolean))];
      if (!ids.length || ids.length > 20) {
        return json(response, 400, { error: "ダウンロードできる動画は1〜20本です。" });
      }
      const generations = await readGenerations();
      const records = ids.map(id => generations.find(item => item.id === id));
      if (records.some(item => !item)) return json(response, 404, { error: "選択した動画が見つかりません。" });
      if (records.some(item => item.state !== "success" || !item.localUrl)) {
        return json(response, 409, { error: "完成してローカルに保存済みの動画だけをダウンロードできます。" });
      }
      const inputPaths = records.map(item => outputPathForGeneration(outputDir, item.localUrl));
      if (inputPaths.some(path => !path)) return json(response, 409, { error: "選択した動画ファイルを読み込めません。" });
      const existing = await Promise.all(inputPaths.map(path => stat(path).then(info => info.isFile()).catch(() => false)));
      if (existing.some(value => !value)) return json(response, 409, { error: "選択した動画ファイルが見つかりません。" });
      await streamZip(response, inputPaths);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/generations") {
      const body = await readJson(request);
      const character = (await readCharacters()).find(item => item.id === body.characterId);
      if (!character) return json(response, 404, { error: "キャラクターが見つかりません。" });
      const supportedModes = new Set(["image-to-video", "reference-to-video", "text-to-video", "start-end-to-video", "digital-human"]);
      const mode = supportedModes.has(body.mode) ? body.mode : "image-to-video";
      const userPrompt = String(body.prompt || "").trim();
      if (!userPrompt && mode !== "digital-human") return json(response, 400, { error: "動画の内容を入力してください。" });
      const prompt = promptWithCharacterProfile(character.description, userPrompt, character.type);
      const providers = normalizeProviderRequests(body).map(requested => {
        const provider = getProvider(requested.id);
        if (!provider.configured(process.env)) {
          const error = new Error(`${provider.name}のAPIキーが未設定です。`);
          error.status = 400;
          throw error;
        }
        return { provider, model: requested.model };
      });
      const registeredImages = await listImages(character.id);
      let sourceImage = resolveRegisteredSourceImage(registeredImages, body.sourceImageName);
      const composition = body.compositionId
        ? (await readImageCompositions()).find(item => item.id === String(body.compositionId))
        : null;
      if (body.compositionId && !composition) return json(response, 404, { error: "選択した合成画像が見つかりません。" });
      let referenceRegisteredImages = [];
      let images = [];
      let startImage = null;
      let endImage = null;
      let startImageSource = null;
      let endImageSource = null;
      let endRegisteredImage = null;
      if (mode === "image-to-video" || mode === "start-end-to-video" || mode === "digital-human") {
        startImage = validateImageDataUrl(body.startImage);
        if (startImage) {
          startImageSource = "upload";
        } else if (composition) {
          startImage = await compositionImageToDataUrl(composition);
          startImageSource = "composition";
          sourceImage = { name: composition.fileName, url: composition.localUrl };
        } else if (sourceImage) {
          startImage = await imageFileToDataUrl(character.id, sourceImage.name);
          startImageSource = "registered";
        }
        if (!startImage) return json(response, 400, { error: `${mode === "start-end-to-video" ? "Start End to Video" : mode === "digital-human" ? "Lip Sync" : "Image to Video"}には開始画像を1枚選択してください。` });
        if (mode === "start-end-to-video") {
          endImage = validateImageDataUrl(body.endImage);
          if (endImage) {
            endImageSource = "upload";
          } else if (body.endImageName) {
            endRegisteredImage = registeredImages.find(image => image.name === String(body.endImageName));
            if (!endRegisteredImage) return json(response, 400, { error: "選択した終了フレームの登録画像を確認できません。" });
            endImage = await imageFileToDataUrl(character.id, endRegisteredImage.name);
            endImageSource = "registered";
          }
          if (!endImage) return json(response, 400, { error: "Start End to Videoには終了画像を1枚選択してください。" });
        }
      } else if (mode === "reference-to-video") {
        const names = [...new Set((Array.isArray(body.referenceImageNames) ? body.referenceImageNames : [])
          .map(name => String(name || "").trim()).filter(Boolean))];
        referenceRegisteredImages = names.map(name => registeredImages.find(image => image.name === name));
        if (referenceRegisteredImages.some(image => !image)) {
          return json(response, 400, { error: "Reference to Videoの登録画像を確認できません。もう一度選択してください。" });
        }
        const uploadedImages = (Array.isArray(body.referenceUploadImages) ? body.referenceUploadImages : [])
          .map(validateImageDataUrl).filter(Boolean);
        if (names.length + uploadedImages.length > maxReferenceImages) {
          return json(response, 400, { error: `Reference to Videoの参照画像は最大${maxReferenceImages}枚です。` });
        }
        images = [
          ...await Promise.all(referenceRegisteredImages.map(image => imageFileToDataUrl(character.id, image.name))),
          ...uploadedImages
        ];
        if (!images.length) return json(response, 400, { error: "Reference to Videoには登録画像または追加画像を1枚以上選択してください。" });
        if (images.reduce((total, image) => total + dataUrlByteLength(image), 0) > maxReferenceImageBytes) {
          return json(response, 413, { error: "Reference to Videoの参照画像の合計は14MB以内にしてください。" });
        }
        if (images.length > 1 && providers.some(({ provider }) => provider.id !== "vidu")) {
          return json(response, 400, { error: "複数の参照画像を使うReference to VideoはViduだけを選択してください。" });
        }
        sourceImage = referenceRegisteredImages[0] || null;
      }
      const audio = mode === "digital-human" ? validateDigitalHumanAudio(body.audioUrl, body.audioObjectKey) : null;
      const audioUrl = audio?.url || null;
      const usedSourceImage = referenceRegisteredImages.length > 0 || ["registered", "composition"].includes(startImageSource);
      const comparisonGroupId = providers.length > 1 ? createLocalId("cmp") : null;
      const createdAt = new Date().toISOString();
      const prepared = providers.map(({ provider, model }) => {
        const input = provider.normalize({
          mode,
          characterId: character.id,
          images,
          startImage,
          endImage,
          audioUrl,
          audioObjectKey: audio?.key || null,
          audioDuration: normalizedAudioDuration(body.audioDuration),
          prompt,
          model,
          duration: Number(body.duration),
          resolution: body.resolution,
          aspectRatio: body.aspectRatio,
          audio: Boolean(body.audio),
          offPeak: Boolean(body.offPeak)
        });
        return { provider, input, recordId: createLocalId("gen") };
      });
      const results = await Promise.allSettled(
        prepared.map(({ provider, input, recordId }) => submitProviderTask({
          provider,
          input,
          recordId,
          createdAt,
          createTask: () => provider.create(input, process.env),
          estimatedCost: provider.estimate(input)
        }))
      );
      const records = [];
      const errors = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const { provider, input, recordId } = prepared[index];
        if (result.status === "rejected") {
          errors.push({
            provider: provider.id,
            name: provider.name,
            error: result.reason?.message || "送信に失敗しました。"
          });
          continue;
        }
        const task = result.value;
        const startImageUrl = startImageSource === "upload"
          ? await trySaveGenerationInputImage(recordId, "start", startImage)
          : ["registered", "composition"].includes(startImageSource) ? sourceImage?.url || null : null;
        const endImageUrl = endImageSource === "upload"
          ? await trySaveGenerationInputImage(recordId, "end", endImage)
          : endRegisteredImage?.url || null;
        records.push({
          id: recordId,
          providerTaskId: task.taskId,
          comparisonGroupId,
          provider: provider.id,
          mode,
          characterId: character.id,
          characterName: character.name,
          sourceImageName: usedSourceImage ? sourceImage?.name || null : null,
          sourceImageUrl: usedSourceImage ? sourceImage?.url || null : null,
          compositionId: startImageSource === "composition" ? composition.id : null,
          startImageSource,
          startImageUrl,
          endImageSource,
          endImageName: endRegisteredImage?.name || null,
          endImageUrl,
          providerImageCount: mode === "reference-to-video" ? images.length : mode === "start-end-to-video" ? 2 : mode === "text-to-video" ? 0 : 1,
          audioUrl,
          prompt,
          userPrompt,
          model: input.model,
          duration: mode === "digital-human" ? normalizedAudioDuration(body.audioDuration) : input.duration,
          resolution: input.resolution,
          aspectRatio: input.aspectRatio,
          audio: input.audio,
          offPeak: input.offPeak,
          estimatedCost: roundCost(provider.estimate(input)),
          state: task.state,
          credits: task.credits ?? null,
          localUrl: null,
          createdAt
        });
      }
      if (records.length) await saveGenerations(records);
      if (!records.length && audio?.key) await deleteTemporaryAudio(audio.key);
      return json(response, errors.length ? (records.length ? 207 : 502) : 201, {
        records,
        errors,
        comparisonGroupId
      });
    }

    const cancelMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const taskId = cancelMatch[1];
      const generations = await readGenerations();
      const record = generations.find(item => item.id === taskId);
      if (!record) return json(response, 404, { error: "生成履歴が見つかりません。" });
      const provider = getProvider(record.provider || "vidu");
      if (typeof provider.cancel !== "function" || !(provider.cancelStates || []).includes(record.state)) {
        return json(response, 409, { error: `${provider.name}は現在の生成状態をキャンセルできません。` });
      }
      await provider.cancel(record.providerTaskId || record.id, process.env);
      record.state = "cancelled";
      record.cancelledAt = new Date().toISOString();
      await syncProviderCostEntry(record);
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 200, record);
    }

    const favoriteMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/favorite$/);
    if (request.method === "PUT" && favoriteMatch) {
      const body = await readJson(request);
      const generations = await readGenerations();
      const record = generations.find(item => item.id === favoriteMatch[1]);
      if (!record) return json(response, 404, { error: "生成履歴が見つかりません。" });
      record.favorite = body.favorite === true;
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 200, record);
    }

    const titleMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/title$/);
    if (request.method === "PUT" && titleMatch) {
      const body = await readJson(request);
      const title = String(body.title || "").trim().replace(/\s+/g, " ");
      if (!title || title.length > 120) {
        return json(response, 400, { error: "タイトルは1〜120文字で入力してください。" });
      }
      const generations = await readGenerations();
      const record = generations.find(item => item.id === titleMatch[1]);
      if (!record) return json(response, 404, { error: "生成履歴が見つかりません。" });
      record.title = title;
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 200, record);
    }

    const extensionMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/extend$/);
    if (request.method === "POST" && extensionMatch) {
      const parentId = extensionMatch[1];
      const generations = await readGenerations();
      const parent = generations.find(item => item.id === parentId);
      if (!parent) return json(response, 404, { error: "元動画の生成履歴が見つかりません。" });
      if (parent.state !== "success") return json(response, 409, { error: "完成した動画だけ続きを生成できます。" });

      const provider = getProvider(parent.provider || "vidu");
      if (typeof provider.extend !== "function" || typeof provider.normalizeExtension !== "function") {
        return json(response, 409, { error: `${provider.name}はこのアプリの動画延長に未対応です。` });
      }
      if (!provider.configured(process.env)) {
        return json(response, 400, { error: `${provider.name}のAPIキーが未設定です。` });
      }
      if (typeof provider.canExtend === "function" && !provider.canExtend(parent)) {
        return json(response, 409, { error: `${provider.name}では、この動画のモデル・長さ・解像度を延長できません。` });
      }

      const body = await readJson(request);
      const rawFinalFrameImage = String(body.finalFrameImage || "");
      if (rawFinalFrameImage && !provider.extension?.supportsFinalFrame) {
        return json(response, 400, { error: `${provider.name}の延長では終了フレーム画像を指定できません。` });
      }
      const finalFrameImage = rawFinalFrameImage ? validateImageDataUrl(rawFinalFrameImage) : null;
      const finalFrameImageName = finalFrameImage
        ? String(body.finalFrameImageName || "").replaceAll("/", "").replaceAll(String.fromCharCode(92), "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || null
        : null;
      if (rawFinalFrameImage && !finalFrameImage) {
        return json(response, 400, { error: "終了フレームにはPNG、JPEG、WebP画像を選択してください。" });
      }

      const sourceDuration = Number(parent.duration) || 0;
      const extensionSource = await prepareExtensionSource(provider, parent);
      const character = (await readCharacters()).find(item => item.id === parent.characterId);
      const userPrompt = String(body.prompt || "").trim();
      const input = provider.normalizeExtension({
        parentGenerationId: parent.id,
        ...extensionSource,
        finalFrameImage,
        prompt: promptWithCharacterProfile(character?.description, userPrompt, character?.type),
        model: body.model,
        duration: Number(body.duration),
        resolution: body.resolution,
        sourceDuration,
        aspectRatio: parent.aspectRatio || "9:16",
        audio: Boolean(parent.audio)
      });
      const createdAt = new Date().toISOString();
      const recordId = createLocalId("gen");
      const task = await submitProviderTask({
        provider,
        input,
        recordId,
        createdAt,
        createTask: () => provider.extend(input, process.env),
        estimatedCost: provider.estimateExtension?.(input)
      });
      const extensionBranch = nextExtensionBranch(generations, parent.id);
      const finalFrameImageUrl = finalFrameImage
        ? await trySaveGenerationInputImage(recordId, "final", finalFrameImage)
        : null;
      const record = {
        id: recordId,
        providerTaskId: task.taskId,
        comparisonGroupId: null,
        parentGenerationId: parent.id,
        rootGenerationId: parent.rootGenerationId || parent.id,
        extensionDepth: (Number(parent.extensionDepth) || 0) + 1,
        extensionBranch,
        provider: parent.provider || "vidu",
        mode: "video-extension",
        characterId: parent.characterId,
        characterName: parent.characterName,
        sourceImageName: parent.sourceImageName || null,
        sourceImageUrl: parent.sourceImageUrl || null,
        startImageSource: null,
        providerImageCount: finalFrameImage ? 1 : 0,
        finalFrameImageUrl,
        finalFrameImageName,
        prompt: input.prompt,
        userPrompt,
        model: input.model,
        sourceDuration,
        extensionDuration: input.duration,
        duration: input.outputDuration || sourceDuration + input.duration,
        resolution: input.resolution,
        aspectRatio: parent.aspectRatio || "9:16",
        audio: Boolean(parent.audio),
        offPeak: false,
        extensionKind: provider.extension?.kind || "native",
        postProcess: provider.extension?.postProcess || null,
        estimatedCost: roundCost(provider.estimateExtension?.(input)),
        state: task.state,
        credits: task.credits ?? null,
        localUrl: null,
        titleSubject: extensionTitleSubject(parent, extensionBranch),
        createdAt
      };
      await assignAutomaticTitles(generations, [record]);
      generations.unshift(record);
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 201, record);
    }

    const generationMatch = url.pathname.match(/^\/api\/generations\/([^/]+)$/);
    if (request.method === "GET" && generationMatch) {
      const taskId = generationMatch[1];
      const generations = await readGenerations();
      const record = generations.find(item => item.id === taskId);
      if (!record) return json(response, 404, { error: "生成履歴が見つかりません。" });
      const provider = getProvider(record.provider || "vidu");
      const result = await provider.get(record.providerTaskId || record.id, process.env);
      record.state = result.state || record.state;
      record.credits = result.credits ?? record.credits;
      record.providerCreationId = result.creationId || record.providerCreationId || null;
      if (result.actualCost !== null && result.actualCost !== undefined) {
        record.actualCost = roundCost(result.actualCost);
      } else if (record.state === "success" && typeof provider.actualCost === "function") {
        record.actualCost = roundCost(provider.actualCost(record));
      }
      if (result.outputUrl) {
        record.providerOutputUrl = result.outputUrl;
        record.providerOutputUrlUpdatedAt = new Date().toISOString();
      }
      if (result.failure) {
        record.failureCode = result.failure;
        record.failure = isViduCreditInsufficientFailure(provider.id, result.failure)
          ? "Viduクレジット不足：クレジットを補充してから、もう一度生成してください。"
          : result.failure;
      }
      if (record.state === "success" && (result.outputUrl || result.outputBase64) && !record.localUrl) {
        await mkdir(outputDir, { recursive: true });
        const fileName = outputFileName(record);
        const outputPath = join(outputDir, fileName);
        if (record.postProcess === "concat-parent") {
          const parent = generations.find(item => item.id === record.parentGenerationId);
          const parentPath = outputPathForGeneration(outputDir, parent?.localUrl);
          if (!parentPath) {
            const error = new Error("Runwayの続きと結合する元動画が見つかりません。");
            error.status = 409;
            throw error;
          }
          const segmentPath = join(outputDir, fileName.replace(/\.mp4$/, "-segment.mp4"));
          try {
            await saveProviderVideo(segmentPath, result, provider.name);
            await concatenateVideos(parentPath, segmentPath, outputPath);
          } finally {
            try {
              await unlink(segmentPath);
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }
        } else {
          await saveProviderVideo(outputPath, result, provider.name);
        }
        record.localUrl = `/outputs/${fileName}`;
      }
      await syncProviderCostEntry(record);
      await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
      return json(response, 200, record);
    }

    if (request.method === "POST" && url.pathname === "/api/characters") {
      const body = await readJson(request);
      const name = String(body.name || "").trim();
      const id = assetIdForName(name);
      if (!name) return json(response, 400, { error: "素材名を入力してください。" });

      const characters = await readCharacters();
      if (characters.some(character => character.id === id)) {
        return json(response, 409, { error: "同じ名前の素材が既に存在します。" });
      }

      const character = {
        id,
        name,
        type: normalizeAssetType(body.type),
        description: normalizeCharacterDescription(body.description),
        temporary: Boolean(body.temporary),
        createdAt: new Date().toISOString()
      };
      await mkdir(join(charactersDir, id), { recursive: true });
      await writeFile(databasePath, `${JSON.stringify([...characters, character], null, 2)}\n`);
      return json(response, 201, { ...character, images: [] });
    }

    const characterMatch = url.pathname.match(/^\/api\/characters\/([a-z0-9-]+)$/);
    if (request.method === "GET" && characterMatch) {
      const id = characterMatch[1];
      const character = (await readCharacters()).find(item => item.id === id);
      if (!character) return json(response, 404, { error: "素材が見つかりません。" });
      return json(response, 200, { ...character, images: await listImages(character.id) });
    }

    if (request.method === "DELETE" && characterMatch) {
      const id = characterMatch[1];
      const characters = await readCharacters();
      const character = characters.find(item => item.id === id);
      if (!character) return json(response, 404, { error: "素材が見つかりません。" });
      await rm(join(charactersDir, id), { recursive: true, force: true });
      await writeFile(databasePath, `${JSON.stringify(characters.filter(item => item.id !== id), null, 2)}\n`);
      return json(response, 200, { ok: true, id });
    }
    if (request.method === "PUT" && characterMatch) {
      const id = characterMatch[1];
      const body = await readJson(request);
      const characters = await readCharacters();
      const index = characters.findIndex(character => character.id === id);
      if (index === -1) return json(response, 404, { error: "キャラクターが見つかりません。" });
      const current = characters[index];
      const name = body.name === undefined ? current.name : String(body.name || "").trim().slice(0, 60);
      if (!name) return json(response, 400, { error: "素材名を入力してください。" });
      if (characters.some(character => character.id !== id && character.name === name)) {
        return json(response, 409, { error: "同じ名前の素材が既に存在します。" });
      }
      characters[index] = {
        ...current,
        name,
        description: body.description === undefined
          ? current.description || ""
          : normalizeCharacterDescription(body.description)
      };
      await writeFile(databasePath, `${JSON.stringify(characters, null, 2)}\n`);
      return json(response, 200, { ...characters[index], images: await listImages(id) });
    }

    if (request.method === "POST" && url.pathname === "/api/uploads/audio") {
      if (!r2Configuration()) return json(response, 409, { error: ".env にCloudflare R2の接続設定を入力してください。" });
      const body = await readJson(request, 22 * 1024 * 1024);
      const upload = decodeAudioUpload(body.fileName, body.dataUrl);
      if (!upload) return json(response, 400, { error: "MP3、WAV、M4A、AAC、OGG、WMAの音声を選択してください。" });
      const { buffer, extension, mimeType } = upload;
      if (buffer.length > maxAudioUploadBytes) return json(response, 413, { error: "音声ファイルは15MB以内にしてください。" });
      await removeExpiredAudioUploads();
      const key = `audio/${randomUUID()}${extension}`;
      await putR2Object(key, buffer, mimeType);
      await saveTemporaryAudio({ key, createdAt: new Date().toISOString() });
      return json(response, 201, { url: `${r2Configuration().publicBaseUrl}/${key}`, key });
    }

    const temporaryAudioMatch = url.pathname.match(/^\/api\/uploads\/audio\/([0-9a-f-]+\.(?:mp3|wav|m4a|aac|ogg|wma))$/i);
    if (request.method === "DELETE" && temporaryAudioMatch) {
      await deleteTemporaryAudio(`audio/${temporaryAudioMatch[1]}`);
      return json(response, 200, { ok: true });
    }

    const uploadMatch = url.pathname.match(/^\/api\/characters\/([a-z0-9-]+)\/images$/);
    if (request.method === "POST" && uploadMatch) {
      const id = uploadMatch[1];
      const characters = await readCharacters();
      if (!characters.some(character => character.id === id)) {
        return json(response, 404, { error: "キャラクターが見つかりません。" });
      }

      if ((await listImages(id)).length >= maxCharacterImages) {
        return json(response, 409, { error: `参照画像は${maxCharacterImages}枚までです。` });
      }

      const body = await readJson(request);
      const match = String(body.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(response, 400, { error: "PNG、JPEG、WebP画像を選択してください。" });
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 8 * 1024 * 1024) return json(response, 413, { error: "画像は1枚8MB以内にしてください。" });

      const extension = match[1] === "image/png" ? ".png" : match[1] === "image/webp" ? ".webp" : ".jpg";
      const safeBase = slugify(String(body.fileName || "reference").replace(/\.[^.]+$/, "")) || "reference";
      const fileName = `${Date.now()}-${safeBase}${extension}`;
      await mkdir(join(charactersDir, id), { recursive: true });
      await writeFile(join(charactersDir, id, fileName), buffer);
      return json(response, 201, { name: fileName, url: `/characters/${id}/${fileName}` });
    }

    const deleteImageMatch = url.pathname.match(/^\/api\/characters\/([a-z0-9-]+)\/images\/([^/]+)$/);
    if (request.method === "DELETE" && deleteImageMatch) {
      const [, id, encodedName] = deleteImageMatch;
      const characters = await readCharacters();
      if (!characters.some(character => character.id === id)) {
        return json(response, 404, { error: "キャラクターが見つかりません。" });
      }

      const name = decodeURIComponent(encodedName);
      const image = (await listImages(id)).find(item => item.name === name);
      if (!image) return json(response, 404, { error: "画像が見つかりません。" });

      await unlink(join(charactersDir, id, image.name));
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname.startsWith("/characters/")) {
      return serveFile(response, charactersDir, url.pathname.slice("/characters/".length));
    }
    if (request.method === "GET" && url.pathname.startsWith("/compositions/")) {
      return serveFile(response, compositionOutputDir, url.pathname.slice("/compositions/".length));
    }
    if (request.method === "GET" && url.pathname.startsWith("/outputs/")) return serveFile(response, outputDir, url.pathname.slice("/outputs/".length));
    if (request.method === "GET" && url.pathname.startsWith("/inputs/")) return serveFile(response, generationInputDir, url.pathname.slice("/inputs/".length));

    if (request.method === "GET") {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      return serveFile(response, publicDir, requested);
    }

    json(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : error.status || 500;
    if (status >= 500) console.error(error);
    json(response, status, { error: error.message || "サーバーエラーが発生しました。" });
  }
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Shortvideo is already running at http://127.0.0.1:${port}`);
    console.error("Stop the existing server, or set PORT to another value before running npm run dev.");
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Shortvideo is running at http://127.0.0.1:${port}`);
});

async function prepareExtensionSource(provider, parent) {
  const sourceType = provider.extension?.source;
  if (sourceType === "local-video" || sourceType === "last-frame") {
    const sourcePath = outputPathForGeneration(outputDir, parent.localUrl);
    if (!sourcePath) {
      const error = new Error(`${provider.name}で延長する元動画がローカルに保存されていません。`);
      error.status = 409;
      throw error;
    }
    const info = await stat(sourcePath).catch(() => null);
    if (!info?.isFile()) {
      const error = new Error(`${provider.name}で延長する元動画ファイルが見つかりません。`);
      error.status = 409;
      throw error;
    }
    if (sourceType === "last-frame") {
      return { startImage: await extractLastFrameDataUrl(sourcePath) };
    }
    if (info.size > 50 * 1024 * 1024) {
      const error = new Error("Veoへ送る元動画は50MB以内にしてください。");
      error.status = 413;
      throw error;
    }
    return { videoBase64: (await readFile(sourcePath)).toString("base64") };
  }

  if (sourceType === "remote-video" || sourceType === "vidu-creation") {
    const latest = await provider.get(parent.providerTaskId || parent.id, process.env);
    if (latest.state !== "success") {
      const error = new Error(`${provider.name}の元動画情報を取得できません。少し待ってから再度お試しください。`);
      error.status = 409;
      throw error;
    }
    parent.providerCreationId = latest.creationId || parent.providerCreationId || null;
    parent.providerOutputUrl = latest.outputUrl || parent.providerOutputUrl || null;
    parent.providerOutputUrlUpdatedAt = latest.outputUrl ? new Date().toISOString() : parent.providerOutputUrlUpdatedAt;
    return {
      videoCreationId: parent.providerCreationId,
      videoUrl: parent.providerOutputUrl
    };
  }

  const error = new Error(`${provider.name}の延長元動画を準備できません。`);
  error.status = 500;
  throw error;
}

async function saveProviderVideo(path, result, providerName) {
  if (result.outputBase64) {
    await writeFile(path, Buffer.from(result.outputBase64, "base64"));
    return;
  }
  const videoResponse = await fetch(result.outputUrl, { headers: result.downloadHeaders || {} });
  if (!videoResponse.ok) {
    const error = new Error(`${providerName}の完成動画を保存できませんでした。`);
    error.status = videoResponse.status;
    throw error;
  }
  await writeFile(path, Buffer.from(await videoResponse.arrayBuffer()));
}

async function readCharacters() {
  return JSON.parse(await readFile(databasePath, "utf8"));
}

function normalizeCharacterDescription(value) {
  return String(value || "").trim().slice(0, 1000);
}

function normalizeAssetType(value) {
  return value === "scene" ? "scene" : "character";
}

function promptWithCharacterProfile(description, prompt, type = "character") {
  const profile = normalizeCharacterDescription(description);
  const scene = String(prompt || "").trim();
  if (!profile) return scene;
  const heading = normalizeAssetType(type) === "scene"
    ? "Reference scene profile (preserve these visual elements when relevant)"
    : "Character profile (keep these traits consistent when visible and relevant)";
  return `${heading}:\n${profile}\n\nScene request:\n${scene}`;
}

function compositionPrompt(registeredInputs, uploadedCount, request, aspectRatio) {
  const references = registeredInputs.map((item, index) => {
    const kind = normalizeAssetType(item.asset.type) === "scene" ? "background/scene" : "character/subject";
    const profile = normalizeCharacterDescription(item.asset.description);
    return `Image ${index + 1}: ${kind} reference named "${item.asset.name}".${profile ? ` Preserve this profile when relevant: ${profile}` : ""}`;
  });
  for (let index = 0; index < uploadedCount; index += 1) {
    references.push(`Image ${registeredInputs.length + index + 1}: additional visual reference.`);
  }
  const instruction = String(request || "").trim().slice(0, 2000)
    || "Place the referenced character or subject naturally into the referenced background or scene, preserving each subject's identity, clothing, proportions, and distinctive features.";
  const ratio = ["16:9", "1:1", "9:16"].includes(aspectRatio) ? aspectRatio : "16:9";
  return [
    "Create one coherent finished image from the numbered reference images.",
    ...references,
    `Composition request: ${instruction}`,
    `Output composition: ${ratio} aspect ratio, suitable as the first frame of a video.`,
    "Do not make a collage, split screen, contact sheet, or before-and-after layout. Integrate the elements into one natural scene. Do not add captions, labels, borders, or watermarks."
  ].join("\n");
}

async function readImageCompositions() {
  try {
    const value = JSON.parse(await readFile(imageCompositionsPath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function saveImageComposition(record) {
  const records = await readImageCompositions();
  records.unshift(record);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(imageCompositionsPath, `${JSON.stringify(records.slice(0, 200), null, 2)}\n`);
}

async function saveCompositionOutput(result, recordId) {
  let buffer;
  let mimeType = "image/jpeg";
  if (result.base64) {
    const match = String(result.base64).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    mimeType = match?.[1] || mimeType;
    buffer = Buffer.from(match?.[2] || result.base64, "base64");
  } else {
    const response = await fetch(result.url);
    if (!response.ok) {
      const error = new Error("Seedreamの合成画像をローカルへ保存できませんでした。");
      error.status = response.status;
      throw error;
    }
    mimeType = String(response.headers.get("content-type") || mimeType).split(";")[0];
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer?.length || buffer.length > maxCompositionOutputBytes) {
    const error = new Error("Seedreamの合成画像サイズが保存上限を超えています。");
    error.status = 502;
    throw error;
  }
  const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const fileName = `${recordId}${extension}`;
  await mkdir(compositionOutputDir, { recursive: true });
  await writeFile(join(compositionOutputDir, fileName), buffer);
  return { fileName, localUrl: `/compositions/${fileName}` };
}

async function compositionImageToDataUrl(composition) {
  const fileName = String(composition?.fileName || "");
  if (!/^[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(fileName)) {
    const error = new Error("合成画像の保存情報が正しくありません。");
    error.status = 409;
    throw error;
  }
  const extension = extname(fileName).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  try {
    return `data:${mimeType};base64,${(await readFile(join(compositionOutputDir, fileName))).toString("base64")}`;
  } catch (error) {
    if (error.code === "ENOENT") {
      const missing = new Error("選択した合成画像ファイルが見つかりません。");
      missing.status = 404;
      throw missing;
    }
    throw error;
  }
}

async function prepareSeedreamInputImages(images, recordId) {
  const config = r2Configuration();
  if (!config) return { images, objectKeys: [] };
  const objectKeys = [];
  try {
    const urls = [];
    for (const [index, dataUrl] of images.entries()) {
      const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!match) {
        const error = new Error("Seedreamへ送る合成元画像の形式が正しくありません。");
        error.status = 400;
        throw error;
      }
      const extension = match[1] === "image/png" ? ".png" : match[1] === "image/webp" ? ".webp" : ".jpg";
      const key = `image-compositions/input/${recordId}-${index + 1}${extension}`;
      await putR2Object(key, Buffer.from(match[2], "base64"), match[1]);
      objectKeys.push(key);
      urls.push(`${config.publicBaseUrl}/${key}`);
    }
    return { images: urls, objectKeys };
  } catch (error) {
    await Promise.allSettled(objectKeys.map(deleteR2Object));
    throw error;
  }
}

async function readGenerations() { try { return JSON.parse(await readFile(generationsPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; } }
async function saveGenerations(records) {
  const generations = await readGenerations();
  await assignAutomaticTitles(generations, records);
  generations.unshift(...records);
  await writeFile(generationsPath, `${JSON.stringify(generations, null, 2)}\n`);
}

async function assignAutomaticTitles(existingRecords, newRecords) {
  const sequences = await readGenerationSequences();
  const counts = new Map();
  for (const record of existingRecords) {
    const key = generationDateKey(record.createdAt);
    const sequence = Number(record.dailySequence) || titleSequence(record.title, key) || (counts.get(key) || 0) + 1;
    counts.set(key, Math.max(counts.get(key) || 0, sequence));
  }
  for (const record of newRecords) {
    const key = generationDateKey(record.createdAt);
    const sequence = Math.max(Number(sequences[key]) || 0, counts.get(key) || 0) + 1;
    counts.set(key, sequence);
    sequences[key] = sequence;
    record.dailySequence = sequence;
    record.title = `${key}-${String(sequence).padStart(2, "0")}｜${generationTitleSubject(record)}`;
  }
  await writeFile(generationSequencesPath, `${JSON.stringify(sequences, null, 2)}\n`);
}

async function readGenerationSequences() {
  try {
    const data = JSON.parse(await readFile(generationSequencesPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function titleSequence(title, date) {
  const match = String(title || "").match(new RegExp(`^${date}-(\\d+)｜`));
  return match ? Number(match[1]) : 0;
}

function generationDateKey(value) {
  const date = new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function generationTitleSubject(record) {
  const subject = String(record.titleSubject || record.userPrompt || record.prompt || "動画生成")
    .replace(/\s+/g, " ")
    .trim();
  return subject.length > 30 ? `${subject.slice(0, 30)}…` : subject;
}

function nextExtensionBranch(generations, parentGenerationId) {
  const siblings = generations.filter(item => item.mode === "video-extension" && item.parentGenerationId === parentGenerationId);
  const highestSavedBranch = siblings.reduce((highest, item) => Math.max(highest, Number(item.extensionBranch) || 0), 0);
  return Math.max(siblings.length, highestSavedBranch) + 1;
}

function extensionTitleSubject(parent, branch) {
  const parentSubject = String(parent.title || parent.userPrompt || parent.prompt || "元動画")
    .replace(/^\d{4}-\d{2}-\d{2}-\d+｜/, "")
    .replace(/\s+/g, " ")
    .trim();
  const depth = (Number(parent.extensionDepth) || 0) + 1;
  const suffix = branch > 1 ? `-${branch}` : "";
  return `${parentSubject.slice(0, 24)}（続き ${depth}${suffix}）`;
}

function isViduCreditInsufficientFailure(providerId, failure) {
  if (providerId !== "vidu") return false;
  return /credit[ _-]?insufficient|insufficient[ _-]?(?:credit|balance)|(?:credit|balance).*insufficient/i.test(String(failure || ""));
}

async function submitProviderTask({ provider, input, recordId, createdAt, createTask, estimatedCost }) {
  const reservation = await withProviderCostLock(async () => {
    const settings = await readProviderBudgetSettings();
    const entries = await readProviderCostLedger();
    const cost = roundCost(estimatedCost);
    assertProviderBudgetAllows(
      provider.id,
      provider.name,
      cost,
      summarizeProviderCosts(entries, settings)
    );

    const next = {
      id: recordId,
      provider: provider.id,
      providerTaskId: null,
      model: input.model,
      mode: input.mode || "video-extension",
      estimatedCost: cost,
      actualCost: null,
      state: "reserving",
      createdAt
    };
    entries.unshift(next);
    await writeProviderCostLedger(entries);
    return next;
  });

  try {
    const task = await createTask();
    await withProviderCostLock(async () => {
      const entries = await readProviderCostLedger();
      const entry = entries.find(item => item.id === reservation.id);
      if (entry) {
        entry.providerTaskId = task.taskId;
        entry.state = task.state || "created";
      }
      await writeProviderCostLedger(entries);
    });
    return task;
  } catch (error) {
    await withProviderCostLock(async () => {
      const entries = await readProviderCostLedger();
      const entry = entries.find(item => item.id === reservation.id);
      if (entry) {
        entry.state = "failed";
        entry.failedAt = new Date().toISOString();
      }
      await writeProviderCostLedger(entries);
    }).catch(writeError => {
      console.error(`${provider.name}の失敗記録を更新できませんでした。`, writeError);
    });
    throw error;
  }
}

async function providerCostStatus() {
  const settings = await readProviderBudgetSettings();
  const entries = await readProviderCostLedger();
  return summarizeProviderCosts(entries, settings);
}

async function providerCostMonthlyHistory() {
  const settings = await readProviderBudgetSettings();
  const entries = await readProviderCostLedger();
  return summarizeProviderMonthlyHistory(entries, settings);
}

async function readProviderBudgetSettings() {
  try {
    return normalizeProviderBudgetSettings(JSON.parse(await readFile(providerBudgetSettingsPath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const migrated = normalizeProviderBudgetSettings(defaultProviderBudgetSettings);
    try {
      const legacy = JSON.parse(await readFile(legacySeedanceBudgetSettingsPath, "utf8"));
      migrated.providers.seedance = updateProviderBudgetSetting(
        migrated,
        "seedance",
        { enabled: true, ...legacy }
      ).providers.seedance;
    } catch (legacyError) {
      if (legacyError.code !== "ENOENT") throw legacyError;
    }
    return migrated;
  }
}

async function readProviderCostLedger() {
  try {
    const entries = JSON.parse(await readFile(providerCostLedgerPath, "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const migrated = new Map();
    try {
      const legacyEntries = JSON.parse(await readFile(legacySeedanceBudgetLedgerPath, "utf8"));
      if (Array.isArray(legacyEntries)) {
        for (const entry of legacyEntries) migrated.set(entry.id, { ...entry, provider: "seedance" });
      }
    } catch (legacyError) {
      if (legacyError.code !== "ENOENT") throw legacyError;
    }
    for (const record of await readGenerations()) {
      const entry = providerCostEntryFromRecord(record);
      if (entry) migrated.set(entry.id, entry);
    }
    return [...migrated.values()];
  }
}

async function writeProviderCostLedger(entries) {
  await writeFile(providerCostLedgerPath, `${JSON.stringify(entries.slice(0, 5000), null, 2)}\n`);
}

async function syncProviderCostEntry(record) {
  return withProviderCostLock(async () => {
    const entries = await readProviderCostLedger();
    const next = providerCostEntryFromRecord(record);
    if (!next) return;
    const entry = entries.find(item => item.id === record.id);
    if (entry) Object.assign(entry, next);
    else entries.unshift(next);
    await writeProviderCostLedger(entries);
  });
}

function providerCostEntryFromRecord(record) {
  const providerId = providerIds.includes(record.provider) ? record.provider : "vidu";
  let actualCost = roundCost(record.actualCost);
  if (actualCost === null && record.state === "success") {
    const provider = getProvider(providerId);
    if (typeof provider.actualCost === "function") actualCost = roundCost(provider.actualCost(record));
  }
  if (!record.id || !record.createdAt) return null;
  return {
    id: record.id,
    provider: providerId,
    providerTaskId: record.providerTaskId || null,
    model: record.model,
    mode: record.mode,
    estimatedCost: roundCost(record.estimatedCost),
    actualCost,
    state: record.state,
    createdAt: record.createdAt
  };
}

function withProviderCostLock(callback) {
  const result = providerCostQueue.then(callback, callback);
  providerCostQueue = result.catch(() => {});
  return result;
}

async function listImages(id) {
  try {
    const names = await readdir(join(charactersDir, id));
    return names
      .filter(name => /\.(png|jpe?g|webp)$/i.test(name))
      .map(name => ({ name, url: `/characters/${id}/${name}` }));
  } catch {
    return [];
  }
}

async function imageFileToDataUrl(characterId, name) {
  const extension = extname(name).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${(await readFile(join(charactersDir, characterId, name))).toString("base64")}`;
}

async function readJson(request, limit = maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function streamZip(response, inputPaths) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const entries = [];
  let offset = 0;
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="shortvideo-${dateStamp(now)}.zip"`,
    "Cache-Control": "no-store"
  });

  for (const [index, inputPath] of inputPaths.entries()) {
    const info = await stat(inputPath);
    if (info.size > 0xffffffff) throw new Error("ZIPへ追加できる動画サイズを超えています。");
    const name = Buffer.from(`video-${String(index + 1).padStart(2, "0")}.mp4`);
    const crc = await crc32File(inputPath);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(info.size, 18);
    header.writeUInt32LE(info.size, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    await writeResponse(response, header);
    await writeResponse(response, name);
    for await (const chunk of createReadStream(inputPath)) await writeResponse(response, chunk);
    entries.push({ name, crc, size: info.size, offset });
    offset += header.length + name.length + info.size;
  }

  const centralOffset = offset;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    await writeResponse(response, header);
    await writeResponse(response, entry.name);
    offset += header.length + entry.name.length;
  }

  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(offset - centralOffset, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);
  response.end(footer);
}

function writeResponse(response, chunk) {
  if (response.write(chunk)) return Promise.resolve();
  return new Promise(resolve => response.once("drain", resolve));
}

async function crc32File(path) {
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(path)) {
    for (const byte of chunk) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dateStamp(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
}

async function serveFile(response, base, requested) {
  const path = resolve(base, normalize(requested));
  if (!path.startsWith(`${resolve(base)}/`)) return json(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream" });
    createReadStream(path).pipe(response);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function assetIdForName(name) {
  const slug = slugify(name);
  if (slug) return slug;
  return `asset-${createHash("sha256").update(String(name || "")).digest("hex").slice(0, 12)}`;
}

async function trySaveGenerationInputImage(recordId, role, dataUrl) {
  try {
    const image = inlineImageFromDataUrl(dataUrl);
    if (!image) return null;
    const extension = image.mimeType === "image/png" ? ".png" : image.mimeType === "image/webp" ? ".webp" : ".jpg";
    const fileName = String(recordId) + "-" + role + extension;
    await mkdir(generationInputDir, { recursive: true });
    await writeFile(join(generationInputDir, fileName), Buffer.from(image.base64, "base64"));
    return "/inputs/" + fileName;
  } catch (error) {
    console.error("履歴用の入力画像を保存できませんでした。", error);
    return null;
  }
}

function validateImageDataUrl(value) {
  const text = String(value || "");
  const match = text.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8 * 1024 * 1024) {
    const error = new Error("合成静止画は8MB以内にしてください。");
    error.status = 413;
    throw error;
  }
  return text;
}

function dataUrlByteLength(value) {
  const encoded = String(value || "").split(",", 2)[1] || "";
  return Buffer.from(encoded, "base64").length;
}

function inlineImageFromDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function r2Configuration() {
  const endpoint = String(process.env.CLOUDFLARE_R2_ENDPOINT || "").trim().replace(/\/$/, "");
  const publicBaseUrl = String(process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const bucket = String(process.env.CLOUDFLARE_R2_BUCKET || "").trim();
  const accessKeyId = String(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !publicBaseUrl || !bucket || !accessKeyId || !secretAccessKey) return null;
  try {
    if (new URL(endpoint).protocol !== "https:" || new URL(publicBaseUrl).protocol !== "https:") return null;
    return { endpoint, publicBaseUrl, bucket, accessKeyId, secretAccessKey };
  } catch {
    return null;
  }
}

function validateDigitalHumanAudio(value, key) {
  const url = String(value || "").trim();
  const objectKey = String(key || "").trim();
  const config = r2Configuration();
  if (!config || !/^audio\/[0-9a-f-]+\.(mp3|wav|m4a|aac|ogg|wma)$/.test(objectKey) || url !== `${config.publicBaseUrl}/${objectKey}`) {
    const error = new Error("Lip Sync用の音声ファイルをアップロードしてください。");
    error.status = 400;
    throw error;
  }
  return { url, key: objectKey };
}

function normalizedAudioDuration(value) {
  const duration = Math.round(Number(value));
  return Number.isFinite(duration) && duration >= 1 && duration <= 600 ? duration : 5;
}

function decodeAudioUpload(fileName, dataUrl) {
  const extension = extname(String(fileName || "")).toLowerCase();
  const mimeType = ({
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".wma": "audio/x-ms-wma"
  })[extension];
  if (!mimeType) return null;
  const match = String(dataUrl || "").match(/^data:([^;,]*);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const declaredMime = String(match[1] || "").toLowerCase();
  if (declaredMime && !declaredMime.startsWith("audio/")
    && declaredMime !== "video/mp4" && declaredMime !== "application/octet-stream") return null;
  return { extension, mimeType, buffer: Buffer.from(match[2], "base64") };
}

async function removeExpiredAudioUploads() {
  const cutoff = Date.now() - audioRetentionMs;
  const items = await readTemporaryAudio();
  const expired = items.filter(item => Date.parse(item.createdAt) < cutoff);
  await Promise.all(expired.map(item => deleteR2Object(item.key).catch(() => {})));
  if (expired.length) await writeTemporaryAudio(items.filter(item => !expired.includes(item)));
}

async function saveTemporaryAudio(item) {
  const items = await readTemporaryAudio();
  items.push(item);
  await writeTemporaryAudio(items);
}

async function deleteTemporaryAudio(key) {
  await deleteR2Object(key).catch(() => {});
  await writeTemporaryAudio((await readTemporaryAudio()).filter(item => item.key !== key));
}

async function readTemporaryAudio() { try { return JSON.parse(await readFile(temporaryAudioPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; } }
async function writeTemporaryAudio(items) { await writeFile(temporaryAudioPath, `${JSON.stringify(items, null, 2)}\n`); }

async function putR2Object(key, body, contentType) { return r2Request("PUT", key, body, contentType); }
async function deleteR2Object(key) { return r2Request("DELETE", key); }

async function r2Request(method, key, body = Buffer.alloc(0), contentType = "") {
  const config = r2Configuration();
  if (!config) throw Object.assign(new Error("Cloudflare R2の接続設定が不足しています。"), { status: 409 });
  const endpoint = new URL(config.endpoint);
  const canonicalUri = `/${[config.bucket, ...key.split("/")].map(encodeURIComponent).join("/")}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const headers = { host: endpoint.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...(contentType ? { "content-type": contentType, "cache-control": "no-store, max-age=0" } : {}) };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map(name => `${name}:${headers[name]}\n`).join("");
  const scope = `${date}/auto/s3/aws4_request`;
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders.join(";")}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const sign = (keyValue, value) => createHmac("sha256", keyValue).update(value).digest();
  const signingKey = sign(sign(sign(sign(`AWS4${config.secretAccessKey}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const response = await fetch(`${config.endpoint}${canonicalUri}`, { method, headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}` }, body: method === "DELETE" ? undefined : body });
  if (!response.ok) throw Object.assign(new Error(`Cloudflare R2への${method === "PUT" ? "アップロード" : "削除"}に失敗しました。`), { status: response.status });
}

function normalizeProviderRequests(body) {
  const raw = Array.isArray(body.providers) && body.providers.length
    ? body.providers
    : [{ id: body.provider || "vidu", model: body.model }];
  const unique = new Map();
  for (const item of raw) {
    const id = String(item?.id || "").trim();
    if (id && !unique.has(id)) unique.set(id, { id, model: String(item?.model || "").trim() });
  }
  if (!unique.size) {
    const error = new Error("生成サービスを1つ以上選択してください。");
    error.status = 400;
    throw error;
  }
  if (unique.size > 4) {
    const error = new Error("同時に比較できる生成サービスは4つまでです。");
    error.status = 400;
    throw error;
  }
  return [...unique.values()];
}

function createLocalId(prefix) {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `${prefix}-${date}-${time}-${randomUUID().slice(0, 8)}`;
}

function outputFileName(record) {
  const timestamp = String(record.createdAt || new Date().toISOString())
    .replace(/\D/g, "")
    .slice(0, 14);
  const character = slugify(record.characterId || "character") || "character";
  const provider = slugify(record.provider || "video") || "video";
  const suffix = String(record.id || "").split("-").at(-1).replace(/[^a-z0-9]/gi, "").slice(0, 8);
  return `${character}-${provider}-${timestamp}-${suffix}.mp4`;
}

function roundCost(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
