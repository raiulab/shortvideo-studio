const $ = selector => document.querySelector(selector);

let characters = [];
let selected = null;
let providerSpecs = [];
let serverReady = false;
const selectedImageNames = new Map();
const selectedReferenceImageNames = new Map();
const selectedEndImageNames = new Map();
const temporaryRegisteredReferenceKeys = new Set();
let temporaryReferenceQuery = "";
let referenceUploadFiles = [];
const selectedProviderIds = new Set();
const selectedModels = new Map();
const selectedHistoryIds = new Set();
let historyItems = [];
let historyFilter = "all";
let historyView = localStorage.getItem("shortvideo:history-view") === "grid" ? "grid" : "list";
let historyTitles = new Map();
let historyPage = 1;
const historyPageSize = 20;
const gridHistoryPageSize = 60;
const loopingHistoryIds = new Set();
let pollTimer = null;
let customStartImageObjectUrl = null;
let customEndImageObjectUrl = null;
let promptIdeaStartFrameObjectUrl = null;
let promptIdeaStartFrameFile = null;
let syncingPromptIdeaStartFrame = false;
let extensionParent = null;
let extensionProvider = null;
let costStatus = null;
let costHistory = [];
const openBudgetEditors = new Set();
let imageCompositions = [];
let activeComposition = null;
let compositionResultRecord = null;
const selectedCompositionImages = new Set();
let compositionUploadFiles = [];
let imageCompositionConfigured = false;
let promptIdeasConfigured = false;
let digitalAudioDurationSeconds = null;
let activeViduCreditFailureId = null;
const dismissedViduCreditFailureIds = new Set(JSON.parse(sessionStorage.getItem("shortvideo:dismissed-vidu-credit-failures") || "[]"));

const hour = new Date().getHours();
const isNight = hour >= 18 || hour < 6;
document.documentElement.dataset.theme = isNight ? "dark" : "light";
$("#theme-status").textContent = isNight ? "夜間モード" : "昼間モード";

const dialog = $("#character-dialog");
const form = $("#character-form");
const generationForm = $("#generation-form");
const characterProfileInput = $("#character-profile-input");
const characterProfileStatus = $("#character-profile-status");
const imagePicker = $("#image-picker");
const startImageInput = $("#start-image-input");
const digitalAudioInput = $("#digital-audio-input");
const digitalAudioField = $("#digital-audio-field");
const digitalAudioName = $("#digital-audio-name");
const startImageField = $("#start-image-field");
const startImageName = $("#start-image-name");
const endImageInput = $("#end-image-input");
const endImageName = $("#end-image-name");
const endFrameFields = $("#end-frame-fields");
const endRegisteredSelector = $("#end-registered-selector");
const endRegisteredImages = $("#end-registered-images");
const endRegisteredHint = $("#end-registered-hint");
const referenceImagesInput = $("#reference-images-input");
const referenceImagesField = $("#reference-images-field");
const referenceImagesName = $("#reference-images-name");
const referenceUploadList = $("#reference-upload-list");
const customStartStatus = $("#custom-start-status");
const customStartPreview = $("#custom-start-preview");
const customStartFileName = $("#custom-start-file-name");
const customEndStatus = $("#custom-end-status");
const customEndPreview = $("#custom-end-preview");
const customEndFileName = $("#custom-end-file-name");
const extensionDialog = $("#extension-dialog");
const extensionForm = $("#extension-form");
const extensionFinalFrameStatus = $("#extension-final-frame-status");
const extensionFinalFramePreview = $("#extension-final-frame-preview");
const extensionFinalFrameOpen = $("#extension-final-frame-open");
const extensionFinalFrameName = $("#extension-final-frame-name");
let extensionFinalFrameObjectUrl = null;
let extensionFinalFrameOriginalName = null;
const promptDraftButton = $("#save-prompt-draft");
const promptDraftStatus = $("#prompt-draft-status");
const compositionForm = $("#image-composition-form");
const compositionUploadInput = $("#composition-upload-input");
const compositionUploadName = $("#composition-upload-name");
const compositionUploadList = $("#composition-upload-list");
const promptIdeaButton = $("#create-prompt-idea");
const promptIdeaStatus = $("#prompt-idea-status");
const ideaTopicField = $("#idea-topic-field");
const promptIdeaStartFrameField = $("#prompt-idea-start-frame-field");
const promptIdeaStartFrameInput = $("#prompt-idea-start-frame-input");
const promptIdeaStartFrameStatus = $("#prompt-idea-start-frame-status");
const promptIdeaStartFramePreview = $("#prompt-idea-start-frame-preview");
const promptIdeaStartFrameName = $("#prompt-idea-start-frame-name");
const quickUploadInput = $("#quick-upload-input");
const quickUploadButton = $("#quick-upload-button");
const quickUploadStatus = $("#quick-upload-status");
const quickUploadList = $("#quick-upload-list");
const quickUploadNext = $("#quick-upload-next");
const quickRegisteredImages = $("#quick-registered-images");
const quickRegisteredHint = $("#quick-registered-hint");
const quickRegisteredSummary = $("#quick-registered-summary");
const temporaryReferenceSearch = $("#temporary-reference-search");
let quickUploadFiles = [];
const quickUploadPreviewUrls = new Map();
const quickRegisteredAssets = new Map();
const quickRegisteredImageKeys = new Set();
let promptDraftTimer = null;
let promptDraftCharacterId = null;

$("#show-all-history").onclick = () => setHistoryFilter("all");
$("#show-favorites-history").onclick = () => setHistoryFilter("favorites");
$("#show-non-favorites-history").onclick = () => setHistoryFilter("non-favorites");
$("#show-history-list").onclick = () => setHistoryView("list");
$("#show-history-grid").onclick = () => setHistoryView("grid");
$("#dismiss-vidu-credit-alert").onclick = () => {
  if (activeViduCreditFailureId) dismissedViduCreditFailureIds.add(activeViduCreditFailureId);
  sessionStorage.setItem("shortvideo:dismissed-vidu-credit-failures", JSON.stringify([...dismissedViduCreditFailureIds]));
  $("#vidu-credit-alert").hidden = true;
};

$("#open-dialog").onclick = () => dialog.showModal();
$("#close-dialog").onclick = () => dialog.close();
$("#close-extension-dialog").onclick = () => {
  clearExtensionFinalFrame();
  extensionDialog.close();
};
temporaryReferenceSearch.oninput = () => {
  temporaryReferenceQuery = temporaryReferenceSearch.value.trim().toLocaleLowerCase("ja-JP");
  renderTemporaryReferenceSelector();
};
quickUploadButton.onclick = () => quickUploadInput.click();

quickUploadInput.onchange = async () => {
  const files = [...quickUploadInput.files];
  if (!files.length) return;
  if (quickUploadFiles.length + selectedQuickRegisteredImages().length + files.length > 3) {
    alert("アップロードできる画像は3枚までです。");
    quickUploadInput.value = "";
    return;
  }
  if (files.some(file => !isSupportedImage(file))) {
    alert("PNG、JPEG、WebP形式の画像を選択してください。");
    quickUploadInput.value = "";
    return;
  }
  quickUploadButton.disabled = true;
  quickUploadStatus.textContent = "画像を最適化しています…";
  let optimizedFiles;
  try {
    optimizedFiles = await Promise.all(files.map(file => optimizeImageFile(file)));
  } catch (error) {
    quickUploadButton.disabled = false;
    quickUploadStatus.textContent = error.message;
    return;
  }
  if ([...quickUploadFiles, ...optimizedFiles].reduce((total, file) => total + file.size, 0) > 14 * 1024 * 1024) {
    quickUploadButton.disabled = false;
    quickUploadStatus.textContent = "圧縮後も画像の合計が14MBを超えています。画像数を減らしてください。";
    return;
  }
  quickUploadFiles = [...quickUploadFiles, ...optimizedFiles];
  quickUploadInput.value = "";
  quickUploadButton.disabled = false;
  quickUploadStatus.textContent = "PNG、JPEG、WebP（1枚8MB以内・合計14MB以内）";
  renderQuickUploads();
};

function selectedQuickRegisteredImages() {
  return characters.flatMap(asset => asset.images
    .filter(image => quickRegisteredImageKeys.has(compositionImageKey(asset.id, image.name)))
    .map(image => ({ asset, image })));
}

function renderQuickRegisteredLibrary() {
  const choices = characters.flatMap(asset => asset.images.map((image, index) => ({ asset, image, index })));
  const available = new Set(choices.map(({ asset, image }) => compositionImageKey(asset.id, image.name)));
  for (const key of quickRegisteredImageKeys) if (!available.has(key)) quickRegisteredImageKeys.delete(key);
  if (!choices.length) {
    quickRegisteredImages.innerHTML = '<span class="field-hint">選べる登録画像はありません。</span>';
  } else {
    quickRegisteredImages.replaceChildren(...choices.map(({ asset, image, index }) => {
      const key = compositionImageKey(asset.id, image.name);
      const isSelected = quickRegisteredImageKeys.has(key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `quick-registered-option${isSelected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(isSelected));
      button.title = `${asset.name} · 画像${index + 1}`;
      button.innerHTML = `<img src="${image.url}" alt=""><span>${escapeHtml(asset.name)} · ${index + 1}</span>`;
      button.onclick = () => {
        if (isSelected) quickRegisteredImageKeys.delete(key);
        else if (quickUploadFiles.length + selectedQuickRegisteredImages().length >= 3) return alert("アップロード画像と登録素材は、合計3枚まで選べます。");
        else quickRegisteredImageKeys.add(key);
        renderQuickRegisteredLibrary();
        renderQuickUploads();
      };
      return button;
    }));
  }
  quickRegisteredSummary.textContent = `登録素材から選ぶ（${quickUploadFiles.length + selectedQuickRegisteredImages().length}/3枚）`;
  quickRegisteredHint.textContent = `現在 ${quickUploadFiles.length + selectedQuickRegisteredImages().length}/3枚選択中（アップロード ${quickUploadFiles.length}枚・登録素材 ${selectedQuickRegisteredImages().length}枚）`;
}

function renderQuickUploads() {
  quickUploadList.hidden = !quickUploadFiles.length;
  quickUploadList.replaceChildren(...quickUploadFiles.map((file, index) => {
    const item = document.createElement("div");
    let previewUrl = quickUploadPreviewUrls.get(file);
    if (!previewUrl) {
      previewUrl = URL.createObjectURL(file);
      quickUploadPreviewUrls.set(file, previewUrl);
    }
    const preview = document.createElement("img");
    preview.src = previewUrl;
    preview.alt = "";
    const name = document.createElement("span");
    name.textContent = file.name;
    const content = document.createElement("div");
    content.className = "quick-upload-item-content";
    const registration = quickRegisteredAssets.get(file);
    const registerName = document.createElement("input");
    registerName.type = "text";
    registerName.maxLength = 60;
    registerName.placeholder = "素材名（任意）";
    const registerType = document.createElement("select");
    registerType.setAttribute("aria-label", "登録する素材のカテゴリー");
    registerType.innerHTML = '<option value="character">キャラクター</option><option value="scene">背景・シーン素材</option>';
    const register = document.createElement("button");
    register.type = "button";
    register.className = "quick-register-image";
    register.textContent = registration ? "登録済み" : "この画像を素材として登録";
    register.disabled = Boolean(registration) || !registerName.value.trim();
    registerName.disabled = Boolean(registration);
    registerName.oninput = () => {
      register.disabled = !registerName.value.trim();
    };
    register.onclick = async () => {
      const assetName = registerName.value.trim();
      if (!assetName) return;
      register.disabled = true;
      register.textContent = "登録中…";
      const existingAsset = characters.find(asset => asset.name === assetName);
      let asset = existingAsset;
      if (!asset) {
        asset = await api("/api/characters", {
          method: "POST",
          body: { name: assetName, type: registerType.value }
        });
        if (asset.error) {
          register.disabled = false;
          register.textContent = "この画像を素材として登録";
          return alert(asset.error);
        }
      }
      const image = await api(`/api/characters/${asset.id}/images`, {
        method: "POST",
        body: { fileName: file.name, dataUrl: await toDataUrl(file) }
      });
      if (image.error) {
        register.disabled = false;
        register.textContent = "この画像を素材として登録";
        return alert(image.error);
      }
      const registeredAsset = { ...asset, images: [...(asset.images || []), image] };
      quickRegisteredAssets.set(file, registeredAsset);
      const assetIndex = characters.findIndex(item => item.id === asset.id);
      if (assetIndex === -1) characters = [...characters, registeredAsset];
      else characters[assetIndex] = registeredAsset;
      if (selected?.id === asset.id) selected = registeredAsset;
      renderCharacters();
      renderQuickRegisteredLibrary();
      renderQuickUploads();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${file.name}を外す`);
    remove.onclick = () => {
      const [removed] = quickUploadFiles.splice(index, 1);
      const previewUrl = quickUploadPreviewUrls.get(removed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      quickUploadPreviewUrls.delete(removed);
      renderQuickUploads();
    };
    content.append(name, registerName, registerType, register);
    item.append(preview, content, remove);
    return item;
  }));
  quickUploadButton.textContent = quickUploadFiles.length >= 3 ? "画像は3枚選択済み" : "画像を追加";
  quickUploadButton.disabled = quickUploadFiles.length + selectedQuickRegisteredImages().length >= 3;
  quickUploadNext.disabled = !quickUploadFiles.length && !selectedQuickRegisteredImages().length;
}

quickUploadNext.onclick = beginQuickVideo;

async function beginQuickVideo() {
  const registeredImages = selectedQuickRegisteredImages();
  if (!quickUploadFiles.length && !registeredImages.length) return;
  quickUploadNext.disabled = true;
  quickUploadStatus.textContent = "動画の設定を準備しています…";
  const sourceImages = [
    ...await Promise.all(quickUploadFiles.map(async file => ({ fileName: file.name, dataUrl: await toDataUrl(file) }))),
    ...await Promise.all(registeredImages.map(async ({ image }) => ({ fileName: image.name, dataUrl: await imageUrlToDataUrl(image.url) })))
  ];
  if (sourceImages.reduce((total, source) => total + dataUrlByteLength(source.dataUrl), 0) > 14 * 1024 * 1024) {
    quickUploadStatus.textContent = "選択した画像の合計が14MBを超えています。画像を減らしてください。";
    renderQuickUploads();
    return;
  }
  const asset = await api("/api/characters", {
    method: "POST",
    body: {
      name: `アップロード画像 ${new Date().toLocaleString("ja-JP")}`,
      type: "character",
      temporary: true
    }
  });
  if (asset.error) {
    quickUploadStatus.textContent = asset.error;
    renderQuickUploads();
    return;
  }
  const images = [];
  for (const source of sourceImages) {
    const image = await api(`/api/characters/${asset.id}/images`, {
      method: "POST",
      body: source
    });
    if (image.error) {
      quickUploadStatus.textContent = image.error;
      renderQuickUploads();
      return;
    }
    images.push(image);
  }
  selected = { ...asset, images };
  selectedReferenceImageNames.set(selected.id, new Set(images.map(image => image.name)));
  generationForm.elements.mode.value = "reference-to-video";
  quickUploadFiles.forEach(file => {
    const previewUrl = quickUploadPreviewUrls.get(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  quickUploadPreviewUrls.clear();
  quickUploadFiles = [];
  quickRegisteredAssets.clear();
  quickRegisteredImageKeys.clear();
  renderQuickRegisteredLibrary();
  renderQuickUploads();
  reconcileProviderSelection();
  renderProviderPicker();
  refreshSharedOptions();
  renderCreator();
  updateModeUi();
};

$("#save-character-profile").onclick = async event => {
  if (!selected) return;
  const button = event.currentTarget;
  const characterId = selected.id;
  button.disabled = true;
  button.textContent = "保存中…";
  characterProfileStatus.textContent = "";
  const result = await api(`/api/characters/${encodeURIComponent(characterId)}`, {
    method: "PUT",
    body: { description: characterProfileInput.value }
  });
  button.disabled = false;
  button.textContent = "設定を保存";
  if (result.error) {
    characterProfileStatus.textContent = result.error;
    return;
  }
  const index = characters.findIndex(character => character.id === characterId);
  if (index !== -1) characters[index] = result;
  if (selected?.id === characterId) {
    selected = result;
    characterProfileInput.value = result.description || "";
    characterProfileStatus.textContent = result.description
      ? "保存しました。次回の生成から、このキャラクターだけに反映されます。"
      : "設定を空にしました。";
  }
};

async function loadCostStatus() {
  const result = await api("/api/costs");
  if (!result.error) costStatus = result;
  renderCostDashboard();
}

async function loadCostHistory() {
  const result = await api("/api/costs/history");
  if (result.error) {
    $("#cost-history-content").textContent = result.error;
    return;
  }
  costHistory = Array.isArray(result) ? result : [];
  renderCostHistory();
}

function renderCostHistory() {
  const content = $("#cost-history-content");
  const pastMonths = costHistory.filter(item => item.monthKey !== costStatus?.monthKey);
  if (!pastMonths.length) {
    content.textContent = "過去の費用記録はまだありません。";
    return;
  }
  const rows = pastMonths.map(item => {
    const amount = item.total.committed;
    return `<tr><th scope="row">${formatMonth(item.monthKey)}</th><td>${dollars(amount)}</td><td>${yen(amount)}</td></tr>`;
  }).join("");
  content.innerHTML = `<p class="field-hint">円は概算です（1ドル＝¥166で換算）。</p><table class="cost-history-table"><thead><tr><th>月</th><th>米ドル</th><th>日本円</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatMonth(monthKey) {
  const [year, month] = String(monthKey).split("-");
  return year && month ? `${year}年${Number(month)}月` : monthKey;
}

$("#cost-history").addEventListener("toggle", event => {
  if (event.currentTarget.open) loadCostHistory();
});

function renderCostDashboard() {
  const container = $("#provider-cost-cards");
  if (!costStatus?.providers) {
    $("#cost-dashboard-note").textContent = "費用情報を読み込めませんでした。サーバーを再起動してください。";
    return;
  }
  $("#monthly-total-cost").textContent = money(costStatus.totals.monthly.committed);
  container.replaceChildren(...Object.entries(costStatus.providers).map(([providerId, item]) => {
    const name = providerLabel(providerId);
    const card = document.createElement("article");
    card.className = "provider-cost-card";
    const editorOpen = openBudgetEditors.has(providerId);
    const dailyPercent = Math.min(100, item.daily.committed / item.settings.daily * 100);
    const monthlyPercent = Math.min(100, item.monthly.committed / item.settings.monthly * 100);
    card.innerHTML = `
      <div class="provider-cost-head">
        <strong>${escapeHtml(name)}</strong>
        <div class="provider-cost-actions">
          <span class="budget-state${item.settings.enabled ? " on" : ""}">上限停止 ${item.settings.enabled ? "ON" : "OFF"}</span>
          <button class="toggle-provider-budget" type="button">${editorOpen ? "閉じる" : "設定"}</button>
        </div>
      </div>
      <div class="provider-cost-usage">
        <div><span><b>今日</b><output>${money(item.daily.committed)}</output></span><i><em style="width:${dailyPercent}%"></em></i></div>
        <div><span><b>今月</b><output>${money(item.monthly.committed)}</output></span><i><em style="width:${monthlyPercent}%"></em></i></div>
      </div>
      <div class="provider-budget-editor"${editorOpen ? "" : " hidden"}>
        <label class="budget-enabled"><input class="budget-enabled-input" type="checkbox"${item.settings.enabled ? " checked" : ""}>設定額を超える前に送信を停止</label>
        <label>1回上限（USD、約${yen(item.settings.perRequest)}）<input class="per-request-limit" type="number" min="0.01" max="100000" step="0.01" value="${item.settings.perRequest}"></label>
        <label>1日上限（USD、約${yen(item.settings.daily)}）<input class="daily-limit" type="number" min="0.01" max="100000" step="0.01" value="${item.settings.daily}"></label>
        <label>月額上限（USD、約${yen(item.settings.monthly)}）<input class="monthly-limit" type="number" min="0.01" max="100000" step="0.01" value="${item.settings.monthly}"></label>
        <button class="save-provider-budget" type="button">保存</button>
        <p class="provider-budget-error error"></p>
      </div>`;
    card.querySelector(".toggle-provider-budget").onclick = () => {
      if (openBudgetEditors.has(providerId)) openBudgetEditors.delete(providerId);
      else openBudgetEditors.add(providerId);
      renderCostDashboard();
    };
    card.querySelector(".save-provider-budget").onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "保存中…";
      const errorElement = card.querySelector(".provider-budget-error");
      errorElement.textContent = "";
      const result = await api(`/api/budgets/${providerId}`, {
        method: "PUT",
        body: {
          enabled: card.querySelector(".budget-enabled-input").checked,
          perRequest: Number(card.querySelector(".per-request-limit").value),
          daily: Number(card.querySelector(".daily-limit").value),
          monthly: Number(card.querySelector(".monthly-limit").value)
        }
      });
      if (result.error) {
        button.disabled = false;
        button.textContent = "保存";
        errorElement.textContent = result.error;
        return;
      }
      costStatus = result;
      openBudgetEditors.delete(providerId);
      renderCostDashboard();
      updateGenerateState();
      updateExtensionBudgetNote();
    };
    return card;
  }));
  const reserved = costStatus.totals.monthly.reserved;
  $("#cost-dashboard-note").textContent = reserved > 0
    ? `待機・生成中の予約額 ${money(reserved)}を含みます。失敗・キャンセル分は自動で除外します。`
    : "本アプリから送信した動画生成とSeedream画像合成を集計します。履歴を削除しても費用記録は残ります。";
}

form.onsubmit = async event => {
  event.preventDefault();
  const data = new FormData(form);
  const result = await api("/api/characters", {
    method: "POST",
    body: { name: data.get("name"), type: data.get("type"), description: data.get("description") }
  });
  if (result.error) return $("#form-error").textContent = result.error;
  form.reset();
  dialog.close();
  await loadCharacters(result.id);
};

async function loadCharacters(selectId = selected?.id) {
  if (selected?.id && selected.id !== selectId) savePromptDraft({ silent: true });
  characters = await api("/api/characters");
  selected = characters.find(character => character.id === selectId) || null;
  renderCharacters();
  renderCreator();
  renderCompositionSourceLibrary();
  renderQuickRegisteredLibrary();
}

function renderCharacters() {
  const list = $("#character-list");
  const groups = [
    { type: "character", label: "キャラクター" },
    { type: "scene", label: "背景・シーン素材" }
  ];
  list.replaceChildren(...groups.flatMap(group => {
    const items = characters.filter(character => assetType(character) === group.type);
    if (!items.length) return [];
    const heading = document.createElement("h3");
    heading.className = "asset-group-title";
    heading.textContent = group.label;
    return [heading, ...items.map(character => {
    const button = document.createElement("button");
    button.className = `character-item ${selected?.id === character.id ? "selected" : ""}`;
    const typeLabel = assetType(character) === "scene" ? "シーン" : "キャラクター";
    button.innerHTML = `${character.images[0] ? `<img class="character-thumb" src="${character.images[0].url}" alt="">` : `<span class="character-thumb"></span>`}<span class="character-info"><span class="character-name-row"><strong>${escapeHtml(character.name)}</strong><small>${character.images.length}/15</small></span><span class="character-actions"><span class="add-image" title="画像を追加">Add</span><span class="rename-character" role="button" tabindex="0" aria-label="${escapeHtml(character.name)}の名前を変更">Rename</span><span class="delete-character" role="button" tabindex="0" aria-label="${escapeHtml(character.name)}を削除">Delete</span></span></span>`;
    button.onclick = event => {
      if (event.target.classList.contains("add-image")) {
        event.stopPropagation();
        pickImage(character);
      } else if (event.target.classList.contains("rename-character")) {
        event.stopPropagation();
        renameCharacter(character);
      } else if (event.target.classList.contains("delete-character")) {
        event.stopPropagation();
        deleteCharacter(character);
      } else if (selected?.id === character.id) {
        savePromptDraft({ silent: true });
        selected = null;
        renderCharacters();
        renderCreator();
        renderCompositionSourceLibrary();
      } else {
        savePromptDraft({ silent: true });
        selected = character;
        renderCharacters();
        renderCreator();
      }
    };
    button.onkeydown = event => {
      if (event.target.classList.contains("rename-character") && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        renameCharacter(character);
      } else if (event.target.classList.contains("delete-character") && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        deleteCharacter(character);
      }
    };
    return button;
    })];
  }));
}

async function renameCharacter(character) {
  const name = prompt("新しい素材名を入力してください。", character.name);
  if (name === null) return;
  const nextName = name.trim();
  if (!nextName) return alert("素材名を入力してください。");
  if (nextName === character.name) return;
  const result = await api(`/api/characters/${encodeURIComponent(character.id)}`, {
    method: "PUT",
    body: { name: nextName }
  });
  if (result.error) return alert(result.error);
  if (selected?.id === character.id) selected = result;
  await loadCharacters(character.id);
}

async function deleteCharacter(character) {
  if (!confirm(`「${character.name}」と登録画像をすべて削除します。生成履歴と生成済み動画は残ります。よろしいですか？`)) return;
  const result = await api(`/api/characters/${encodeURIComponent(character.id)}`, { method: "DELETE" });
  if (result.error) return alert(result.error);
  if (selected?.id === character.id) selected = null;
  selectedImageNames.delete(character.id);
  selectedReferenceImageNames.delete(character.id);
  for (const key of temporaryRegisteredReferenceKeys) {
    if (key.startsWith(`${character.id}\u0000`)) temporaryRegisteredReferenceKeys.delete(key);
  }
  await loadCharacters();
}

function assetType(asset) {
  return asset?.type === "scene" ? "scene" : "character";
}

function compositionImageKey(assetId, imageName) {
  return `${assetId}\u0000${imageName}`;
}

function selectedRegisteredCompositionImages() {
  return characters.flatMap(asset => asset.images
    .filter(image => selectedCompositionImages.has(compositionImageKey(asset.id, image.name)))
    .map(image => ({ asset, image })));
}

function renderCompositionSourceLibrary() {
  const library = $("#composition-source-library");
  const availableKeys = new Set(characters.flatMap(asset => asset.images.map(image => compositionImageKey(asset.id, image.name))));
  for (const key of selectedCompositionImages) if (!availableKeys.has(key)) selectedCompositionImages.delete(key);
  const choices = characters.flatMap(asset => asset.images.map((image, index) => ({ asset, image, index })));
  if (!choices.length) {
    library.innerHTML = '<span class="field-hint">合成に使える登録画像がありません。</span>';
  } else {
    library.replaceChildren(...choices.map(({ asset, image, index }) => {
      const key = compositionImageKey(asset.id, image.name);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `composition-source-option${selectedCompositionImages.has(key) ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(selectedCompositionImages.has(key)));
      button.innerHTML = `<img src="${image.url}" alt=""><span>${escapeHtml(asset.name)}</span><small>${assetType(asset) === "scene" ? "背景・シーン" : "キャラクター"} · 画像${index + 1}</small>`;
      button.onclick = () => {
        if (selectedCompositionImages.has(key)) selectedCompositionImages.delete(key);
        else if (selectedCompositionImages.size + compositionUploadFiles.length >= 6) return alert("合成元の画像は合計6枚までです。");
        else selectedCompositionImages.add(key);
        renderCompositionSourceLibrary();
      };
      return button;
    }));
  }
  $("#composition-source-count").textContent = `${selectedCompositionImages.size + compositionUploadFiles.length}/6枚選択中（登録 ${selectedCompositionImages.size}枚・追加 ${compositionUploadFiles.length}枚）`;
  updateCompositionGenerateState();
}

function renderCompositionUploads() {
  compositionUploadList.hidden = !compositionUploadFiles.length;
  if (!compositionUploadFiles.length) {
    compositionUploadList.replaceChildren();
    return;
  }
  compositionUploadList.replaceChildren(...compositionUploadFiles.map((file, index) => {
    const item = document.createElement("div");
    item.textContent = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${file.name}を外す`);
    remove.onclick = () => {
      compositionUploadFiles.splice(index, 1);
      compositionUploadInput.value = "";
      compositionUploadName.textContent = compositionUploadFiles.length
        ? `${compositionUploadFiles.length}枚の追加画像を選択中です。`
        : "登録画像と合わせて最大6枚、合計18MB以内です。";
      renderCompositionUploads();
      renderCompositionSourceLibrary();
    };
    item.append(remove);
    return item;
  }));
}

function compositionModelPrice() {
  return compositionForm.elements.compositionModel.value === "seedream-5-0-lite-260128" ? 0.035 : 0.04;
}

function updateCompositionGenerateState() {
  const button = $("#compose-image-button");
  const modelName = compositionForm.elements.compositionModel.value === "seedream-5-0-lite-260128"
    ? "Seedream 5.0 Lite"
    : "Seedream 4.5";
  const price = compositionModelPrice();
  const count = selectedCompositionImages.size + compositionUploadFiles.length;
  $("#composition-cost").textContent = `${dollars(price, 3)} / 約${yen(price)}`;
  button.disabled = !imageCompositionConfigured || count < 2 || count > 6;
  button.textContent = `${modelName}で合成画像を生成`;
  button.title = !imageCompositionConfigured
    ? "ARK_API_KEYを設定してください"
    : count < 2 ? "合成元の画像を2枚以上選択してください" : "";
}

function showCompositionResult(record) {
  compositionResultRecord = record;
  $("#composition-result").hidden = false;
  $("#composition-result-image").src = record.localUrl;
  $("#composition-result-meta").textContent = `${record.model === "seedream-5-0-lite-260128" ? "Seedream 5.0 Lite" : "Seedream 4.5"} / ${record.aspectRatio} / ${record.inputImageCount}枚を合成 / ${money(Number(record.actualCost || record.estimatedCost || 0), 3)}`;
  $("#composition-result-title").textContent = activeComposition?.id === record.id ? "動画の開始画像に使用中です" : "合成画像が完成しました";
  $("#use-composition-button").textContent = activeComposition?.id === record.id ? "動画に使用中" : "この画像を動画に使う";
  renderRecentCompositions();
}

function useComposition(record) {
  activeComposition = record;
  clearCustomStartImage();
  renderActiveComposition();
  renderCreator();
  showCompositionResult(record);
  $("#generation-error").textContent = "Seedreamの合成画像を動画の開始画像に設定しました。";
}

function renderActiveComposition() {
  const status = $("#composition-use-status");
  const applies = activeComposition && ["image-to-video", "start-end-to-video", "digital-human"].includes(getMode());
  status.hidden = !applies;
  if (applies) $("#composition-use-preview").src = activeComposition.localUrl;
  else $("#composition-use-preview").removeAttribute("src");
  renderPromptIdeaSource();
}

function currentPromptIdeaMode() {
  return generationForm.elements.ideaMode.value === "topic" ? "topic" : "free";
}

function renderPromptIdeaSource() {
  const source = $("#prompt-idea-source");
  const referenceImageCount = getMode() === "reference-to-video"
    ? getSelectedReferenceImages().length + referenceUploadFiles.length + temporaryRegisteredReferenceImages().length
    : 0;
  if (!selected) {
    source.textContent = "素材を選択してください";
  } else if (promptIdeaStartFrameFile || startImageInput.files[0]) {
    source.textContent = "アップロードした開始フレームを見て考えます";
  } else if (activeComposition && ["image-to-video", "start-end-to-video", "digital-human"].includes(getMode())) {
    source.textContent = "使用中のSeedream合成画像を見て考えます";
  } else if (referenceImageCount > 1) {
    source.textContent = "選択中の" + referenceImageCount + "枚の参照画像と設定から考えます";
  } else if (getSelectedSourceImage()) {
    source.textContent = `${selected.name}の選択画像と設定から考えます`;
  } else {
    source.textContent = `${selected.name}の設定から考えます`;
  }
  updatePromptIdeaState();
}

function updatePromptIdeaState() {
  const topicMode = currentPromptIdeaMode() === "topic";
  ideaTopicField.hidden = !topicMode;
  promptIdeaStartFrameField.hidden = !usesStartImage();
  generationForm.elements.ideaTopic.required = false;
  const topicMissing = topicMode && !generationForm.elements.ideaTopic.value.trim();
  promptIdeaButton.disabled = !promptIdeasConfigured || !selected || topicMissing;
  promptIdeaButton.title = !promptIdeasConfigured
    ? "GEMINI_API_KEYを設定してください"
    : topicMissing ? "お題を入力してください" : "";
}

for (const input of generationForm.querySelectorAll('input[name="ideaMode"]')) input.onchange = updatePromptIdeaState;
generationForm.elements.ideaTopic.oninput = updatePromptIdeaState;

promptIdeaButton.onclick = async () => {
  if (!selected) return;
  const isReferenceMode = getMode() === "reference-to-video";
  const sourceImage = getSelectedSourceImage();
  const selectedReferenceImages = isReferenceMode ? getSelectedReferenceImages() : [];
  const additionalRegisteredReferences = isReferenceMode ? temporaryRegisteredReferenceImages() : [];
  const startFrameFile = promptIdeaStartFrameFile || startImageInput.files[0] || null;
  const useComposition = activeComposition
    && !startFrameFile
    && ["image-to-video", "start-end-to-video", "digital-human"].includes(getMode());
  promptIdeaButton.disabled = true;
  promptIdeaButton.textContent = "アイデアを考えています…";
  promptIdeaStatus.className = "field-hint";
  promptIdeaStatus.textContent = isReferenceMode && selectedReferenceImages.length + additionalRegisteredReferences.length + referenceUploadFiles.length > 1
    ? "選択したすべての参照画像から、共通する人物・背景・構図を考えています。"
    : "キャラクターの癖、短い感情の変化、構図に合う動きを組み立てています。";
  const result = await api("/api/prompt-ideas", {
    method: "POST",
    body: {
      characterId: selected.id,
      sourceImageName: sourceImage?.name || null,
      referenceImages: isReferenceMode
        ? await Promise.all([
          ...selectedReferenceImages.map(image => imageUrlToDataUrl(image.url)),
          ...additionalRegisteredReferences.map(({ image }) => imageUrlToDataUrl(image.url)),
          ...referenceUploadFiles.map(file => toDataUrl(file))
        ])
        : [],
      compositionId: useComposition ? activeComposition.id : null,
      startFrameImage: startFrameFile ? await toDataUrl(startFrameFile) : null,
      ideaMode: currentPromptIdeaMode(),
      topic: generationForm.elements.ideaTopic.value,
      moods: [...generationForm.querySelectorAll('input[name="ideaMood"]:checked')].map(input => input.value),
      duration: Number(generationForm.elements.duration.value || 5),
      aspectRatio: generationForm.elements.aspectRatio.value || "16:9",
      audio: generationForm.elements.audio.checked
    }
  });
  promptIdeaButton.textContent = "もう一案を作る";
  updatePromptIdeaState();
  if (result.error) {
    promptIdeaStatus.className = "field-hint error";
    promptIdeaStatus.textContent = result.error;
    return;
  }
  generationForm.elements.prompt.value = result.prompt;
  savePromptDraft({ silent: true });
  promptIdeaStatus.className = "field-hint success";
  promptIdeaStatus.textContent = `英語プロンプトを作成しました（${result.model}）${result.retried ? "。途中終了を検出したため、自動で作り直しました" : ""}。内容を編集してから動画を生成できます。`;
  generationForm.elements.prompt.scrollIntoView({ behavior: "smooth", block: "center" });
};

function renderRecentCompositions() {
  const container = $("#recent-compositions");
  container.hidden = !imageCompositions.length;
  if (!imageCompositions.length) return container.replaceChildren();
  container.replaceChildren(...imageCompositions.slice(0, 8).map(record => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = activeComposition?.id === record.id ? "active" : "";
    button.title = "合成結果を表示";
    button.innerHTML = `<img src="${record.localUrl}" alt="合成画像">`;
    button.onclick = () => showCompositionResult(record);
    return button;
  }));
}

async function loadImageCompositions() {
  const result = await api("/api/compositions");
  imageCompositions = Array.isArray(result) ? result : [];
  if (activeComposition) activeComposition = imageCompositions.find(item => item.id === activeComposition.id) || null;
  renderRecentCompositions();
  renderActiveComposition();
}

function renderCreator() {
  if (!selected) {
    $("#creator").hidden = true;
    $("#empty-state").hidden = false;
    return;
  }
  $("#creator").hidden = false;
  $("#empty-state").hidden = true;
  restorePromptDraft();
  const isScene = assetType(selected) === "scene";
  $("#selected-kind-label").textContent = isScene ? "SELECTED SCENE" : "SELECTED CHARACTER";
  $("#selected-name").textContent = selected.name;
  $("#selected-image-count").textContent = `登録画像 ${selected.images.length}/15枚`;
  $("#character-profile-title").textContent = isScene ? "SCENE PROFILE" : "CHARACTER PROFILE";
  $("#character-profile-note").textContent = isScene
    ? "この背景・シーン素材を選んだ動画生成にだけ反映されます。"
    : "このキャラクターを選んだ動画生成にだけ反映されます。";
  $("#character-profile-label").firstChild.textContent = isScene ? "背景・シーン素材の特徴・設定" : "キャラクターの特徴・ペルソナ";
  characterProfileInput.placeholder = isScene
    ? "例：雨上がりの東京の路地。夕暮れから夜へ移り、濡れた路面にネオンが反射する。人物は小さく、背景を主役にする。"
    : "例：好奇心旺盛で穏やかな黒猫。片方の目は水色。ゆっくりした所作で、驚いても大げさに騒がない。";
  characterProfileInput.value = selected.description || "";
  characterProfileStatus.textContent = selected.description
    ? `登録済みです。生成時に選択中のこの${isScene ? "素材" : "キャラクター"}だけへ反映します。`
    : isScene
      ? "未設定です。場所・時間帯・雰囲気・固定したい構図などを入力できます。"
      : "未設定です。性格・見た目・話し方・避けたい表現などを入力できます。";
  const sourceImage = getSelectedSourceImage();
  const referenceImages = getSelectedReferenceImages();
  const isReferenceMode = getMode() === "reference-to-video";
  const imageContainer = $("#selected-images");
  if (selected.images.length) {
    imageContainer.replaceChildren(...selected.images.map((image, index) => {
      const item = document.createElement("div");
      const button = document.createElement("button");
      const removeButton = document.createElement("button");
      const isSelected = isReferenceMode ? referenceImages.some(item => item.name === image.name) : image.name === sourceImage?.name;
      const isOverridden = usesStartImage() && Boolean(startImageInput.files[0] || activeComposition);
      const isActive = isReferenceMode ? isSelected : isSelected && !isOverridden;
      button.type = "button";
      button.className = `source-image-option${isActive ? " selected" : ""}${isSelected && isOverridden ? " overridden" : ""}`;
      button.setAttribute("aria-pressed", String(isActive));
      button.setAttribute("aria-label", `${isReferenceMode ? "参照画像" : "元画像"} ${index + 1}${isActive ? "、選択中" : isSelected && isOverridden ? "、別画像で上書き中" : ""}`);
      button.innerHTML = `<img src="${image.url}" alt=""><span>${isReferenceMode ? isActive ? "参照に使う" : `画像 ${index + 1}` : isActive ? "選択中" : isSelected && isOverridden ? "上書き中" : `画像 ${index + 1}`}</span>`;
      button.onclick = () => {
        if (isReferenceMode) {
          toggleReferenceImage(image.name);
          renderCreator();
          return;
        }
        if (usesStartImage() && startImageInput.files[0]) clearCustomStartImage();
        activeComposition = null;
        selectedImageNames.set(selected.id, image.name);
        renderActiveComposition();
        updateModeUi();
        renderCreator();
      };
      removeButton.type = "button";
      removeButton.className = "remove-source-image";
      removeButton.setAttribute("aria-label", `画像 ${index + 1} を削除`);
      removeButton.textContent = "×";
      removeButton.onclick = async () => {
        if (!confirm(`「${selected.name}」の画像 ${index + 1} を削除しますか？`)) return;
        const result = await api(`/api/characters/${selected.id}/images/${encodeURIComponent(image.name)}`, { method: "DELETE" });
        if (result.error) return alert(result.error);
        if (selectedImageNames.get(selected.id) === image.name) selectedImageNames.delete(selected.id);
        selectedReferenceImageNames.get(selected.id)?.delete(image.name);
        if (selectedEndImageNames.get(selected.id) === image.name) selectedEndImageNames.delete(selected.id);
        await loadCharacters(selected.id);
      };
      item.className = "source-image-item";
      item.append(button, removeButton);
      return item;
    }));
  } else {
    imageContainer.innerHTML = `<span class="image-placeholder"></span>`;
  }
  $("#source-image-selector").classList.toggle("empty", !sourceImage);
  $("#image-notice").hidden = isReferenceMode
    ? Boolean(referenceImages.length || referenceUploadFiles.length || temporaryRegisteredReferenceImages().length)
    : Boolean(sourceImage || activeComposition);
  referenceImagesField.firstChild.textContent = isTemporaryReferenceFlow()
    ? "外部画像を追加（合計3枚まで）"
    : "追加の参照画像（Vidu専用・任意）";
  if (!referenceUploadFiles.length) {
    referenceImagesName.textContent = isTemporaryReferenceFlow()
      ? "登録素材と合わせて最大3枚、合計14MB以内です。"
      : "登録画像と合わせて最大7枚、合計14MB以内です。";
  }
  renderReferenceUploads();
  renderTemporaryReferenceSelector();
  renderEndRegisteredImages();
  renderPromptIdeaSource();
  updateGenerateState();
}

function promptDraftKey(characterId) {
  return `shortvideo:prompt-draft:${characterId}`;
}

function restorePromptDraft() {
  if (!selected || promptDraftCharacterId === selected.id) return;
  promptDraftCharacterId = selected.id;
  try {
    const saved = localStorage.getItem(promptDraftKey(selected.id));
    generationForm.elements.prompt.value = saved || "";
    promptDraftStatus.textContent = saved
      ? "保存した下書きを読み込みました。入力中の変更は自動保存されます。"
      : "このキャラクターの下書きは入力中に自動保存されます。";
  } catch {
    promptDraftStatus.textContent = "このブラウザでは下書きを保存できません。";
  }
}

function savePromptDraft({ silent = false } = {}) {
  if (!selected) return false;
  try {
    localStorage.setItem(promptDraftKey(selected.id), generationForm.elements.prompt.value);
    if (!silent) promptDraftStatus.textContent = "下書きを保存しました。";
    return true;
  } catch {
    if (!silent) promptDraftStatus.textContent = "下書きを保存できませんでした。";
    return false;
  }
}

promptDraftButton.onclick = () => savePromptDraft();

generationForm.elements.prompt.addEventListener("input", () => {
  clearTimeout(promptDraftTimer);
  promptDraftTimer = setTimeout(() => {
    if (savePromptDraft({ silent: true })) {
      promptDraftStatus.textContent = "下書きを自動保存しました。";
    }
  }, 500);
});

window.addEventListener("pagehide", () => savePromptDraft({ silent: true }));

function getSelectedSourceImage() {
  if (!selected?.images.length) return null;
  const savedName = selectedImageNames.get(selected.id);
  const sourceImage = selected.images.find(image => image.name === savedName) || selected.images[0];
  selectedImageNames.set(selected.id, sourceImage.name);
  return sourceImage;
}

function getSelectedEndImage() {
  if (!selected?.images.length) return null;
  const savedName = selectedEndImageNames.get(selected.id);
  return selected.images.find(image => image.name === savedName) || null;
}

function renderEndRegisteredImages() {
  const visible = getMode() === "start-end-to-video" && Boolean(selected);
  endFrameFields.hidden = !visible;
  if (!visible) return;
  const selectedEndImage = getSelectedEndImage();
  const isOverridden = Boolean(endImageInput.files[0]);
  if (!selected.images.length) {
    endRegisteredImages.innerHTML = '<span class="field-hint">選べる登録画像がありません。</span>';
  } else {
    endRegisteredImages.replaceChildren(...selected.images.map((image, index) => {
      const isSelected = image.name === selectedEndImage?.name;
      const isActive = isSelected && !isOverridden;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-image-option" + (isActive ? " selected" : "") + (isSelected && isOverridden ? " overridden" : "");
      button.setAttribute("aria-pressed", String(isActive));
      button.title = "終了フレーム 画像 " + (index + 1);
      button.innerHTML = '<img src="' + image.url + '" alt=""><span>' + (isActive ? '終了フレーム' : isSelected && isOverridden ? '上書き中' : '画像 ' + (index + 1)) + '</span>';
      button.onclick = () => {
        clearCustomEndImage();
        if (isSelected && !isOverridden) selectedEndImageNames.delete(selected.id);
        else selectedEndImageNames.set(selected.id, image.name);
        renderEndRegisteredImages();
        updateGenerateState();
      };
      return button;
    }));
  }
  endRegisteredHint.textContent = isOverridden
    ? "アップロード画像で上書き中です。登録画像をクリックすると、その画像へ切り替わります。"
    : selectedEndImage
      ? "選択した登録画像を終了フレームとして送信します。"
      : "登録画像を1枚選択するか、下から別画像をアップロードしてください。";
}

function getSelectedReferenceImages() {
  if (!selected?.images.length) return [];
  let names = selectedReferenceImageNames.get(selected.id);
  if (!names) {
    names = new Set([selected.images[0].name]);
    selectedReferenceImageNames.set(selected.id, names);
  }
  return selected.images.filter(image => names.has(image.name));
}

function temporaryRegisteredReferenceImages() {
  return characters.flatMap(asset => asset.images
    .filter(image => temporaryRegisteredReferenceKeys.has(compositionImageKey(asset.id, image.name)))
    .map(image => ({ asset, image })));
}

function isTemporaryReferenceFlow() {
  return selected?.temporary === true && getMode() === "reference-to-video";
}

function isMixedReferenceFlow() {
  return Boolean(selected) && getMode() === "reference-to-video";
}

function mixedReferenceImageLimit() {
  return isTemporaryReferenceFlow() ? 3 : 7;
}

function temporaryReferenceImageCount() {
  return getSelectedReferenceImages().length + referenceUploadFiles.length + temporaryRegisteredReferenceImages().length;
}

function renderTemporaryReferenceSelector() {
  const selector = $("#temporary-reference-selector");
  const container = $("#temporary-reference-images");
  if (!isMixedReferenceFlow()) {
    selector.hidden = true;
    return;
  }
  selector.hidden = false;
  selector.querySelector("summary").textContent = `登録素材から追加（${temporaryReferenceImageCount()}/${mixedReferenceImageLimit()}枚）`;
  temporaryReferenceSearch.value = temporaryReferenceQuery;
  const choices = characters
    .filter(asset => asset.id !== selected.id)
    .flatMap(asset => asset.images.map((image, index) => ({ asset, image, index })))
    .filter(({ asset }) => !temporaryReferenceQuery || asset.name.toLocaleLowerCase("ja-JP").includes(temporaryReferenceQuery));
  if (!choices.length) {
    container.innerHTML = '<span class="field-hint">追加できる登録画像はありません。</span>';
  } else {
    container.replaceChildren(...choices.map(({ asset, image, index }) => {
      const key = compositionImageKey(asset.id, image.name);
      const isSelected = temporaryRegisteredReferenceKeys.has(key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `source-image-option${isSelected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(isSelected));
      button.title = `${asset.name} · 画像${index + 1}`;
      button.innerHTML = `<img src="${image.url}" alt=""><span>${isSelected ? "参照に使う" : `${escapeHtml(asset.name)} · 画像${index + 1}`}</span>`;
      button.onclick = () => {
        if (isSelected) temporaryRegisteredReferenceKeys.delete(key);
        else if (temporaryReferenceImageCount() >= mixedReferenceImageLimit()) return alert(`参照画像は、アップロード画像と登録素材を合わせて${mixedReferenceImageLimit()}枚までです。`);
        else temporaryRegisteredReferenceKeys.add(key);
        renderTemporaryReferenceSelector();
        updateGenerateState();
      };
      return button;
    }));
  }
  $("#temporary-reference-hint").textContent = `現在 ${temporaryReferenceImageCount()}/${mixedReferenceImageLimit()}枚。左の登録素材と外部画像を自由に組み合わせられます。`;
}

function toggleReferenceImage(name) {
  if (!selected) return;
  const names = new Set(selectedReferenceImageNames.get(selected.id) || []);
  if (names.has(name)) names.delete(name);
  else if (names.size + referenceUploadFiles.length + (isMixedReferenceFlow() ? temporaryRegisteredReferenceImages().length : 0) >= mixedReferenceImageLimit()) return alert(`参照画像は、アップロード画像と登録素材を合わせて${mixedReferenceImageLimit()}枚までです。`);
  else names.add(name);
  selectedReferenceImageNames.set(selected.id, names);
}

function renderReferenceUploads() {
  const isReferenceMode = getMode() === "reference-to-video";
  referenceUploadList.hidden = !isReferenceMode || !referenceUploadFiles.length;
  if (!isReferenceMode || !referenceUploadFiles.length) return;
  referenceUploadList.replaceChildren(...referenceUploadFiles.map((file, index) => {
    const item = document.createElement("div");
    item.textContent = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${file.name}を外す`);
    remove.onclick = () => {
      referenceUploadFiles.splice(index, 1);
      referenceImagesInput.value = "";
      referenceImagesName.textContent = referenceUploadFiles.length
        ? `${referenceUploadFiles.length}枚の追加画像を選択中です。`
        : "登録画像と合わせて最大7枚、合計14MB以内です。";
      renderCreator();
    };
    item.append(remove);
    return item;
  }));
}

function pickImage(character) {
  savePromptDraft({ silent: true });
  selected = character;
  imagePicker.value = "";
  imagePicker.click();
}

imagePicker.onchange = async () => {
  let file = imagePicker.files[0];
  if (!file) return;
  if (selected.images.length >= 15) return alert("登録画像は15枚までです。");
  if (!isSupportedImage(file)) return alert("PNG、JPEG、WebP形式の画像を選択してください。");
  try {
    file = await optimizeImageFile(file);
  } catch (error) {
    return alert(error.message);
  }
  const result = await api(`/api/characters/${selected.id}/images`, {
    method: "POST",
    body: { fileName: file.name, dataUrl: await toDataUrl(file) }
  });
  if (result.error) return alert(result.error);
  await loadCharacters(selected.id);
};

referenceImagesInput.onchange = async () => {
  let files = [...referenceImagesInput.files];
  const selectedRegisteredCount = getSelectedReferenceImages().length;
  if (files.some(file => !isSupportedImage(file))) {
    alert("PNG、JPEG、WebP形式の画像を選択してください。");
    referenceImagesInput.value = "";
    return;
  }
  const referenceLimit = isTemporaryReferenceFlow() ? 3 : 7;
  const registeredReferenceCount = isMixedReferenceFlow() ? temporaryRegisteredReferenceImages().length : 0;
  const existingUploadCount = isTemporaryReferenceFlow() ? referenceUploadFiles.length : 0;
  if (selectedRegisteredCount + registeredReferenceCount + existingUploadCount + files.length > referenceLimit) {
    alert(isTemporaryReferenceFlow() ? "参照画像は、アップロード画像と登録素材を合わせて3枚までです。" : "登録画像と追加画像は合計7枚までです。");
    referenceImagesInput.value = "";
    return;
  }
  try {
    files = await Promise.all(files.map(file => optimizeImageFile(file)));
  } catch (error) {
    alert(error.message);
    referenceImagesInput.value = "";
    return;
  }
  const nextUploadFiles = isTemporaryReferenceFlow() ? [...referenceUploadFiles, ...files] : files;
  const totalBytes = nextUploadFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > 14 * 1024 * 1024) {
    alert("追加画像の合計は14MB以内にしてください。");
    referenceImagesInput.value = "";
    return;
  }
  referenceUploadFiles = nextUploadFiles;
  referenceImagesName.textContent = nextUploadFiles.length
    ? `${nextUploadFiles.length}枚の追加画像を選択中です。`
    : isTemporaryReferenceFlow() ? "登録素材と合わせて最大3枚、合計14MB以内です。" : "登録画像と合わせて最大7枚、合計14MB以内です。";
  renderCreator();
};

startImageInput.onchange = async () => {
  let file = startImageInput.files[0];
  if (file && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    alert("開始フレームにはPNG、JPEG、WebP画像を選択してください。");
    startImageInput.value = "";
    clearCustomStartImage();
    updateModeUi();
    renderCreator();
    return;
  }
  if (file) try {
    file = await optimizeImageFile(file);
    replaceInputFiles(startImageInput, [file]);
  } catch (error) {
    alert(error.message);
    startImageInput.value = "";
    clearCustomStartImage();
    updateModeUi();
    renderCreator();
    return;
  }
  if (!syncingPromptIdeaStartFrame) {
    promptIdeaStartFrameInput.value = "";
    promptIdeaStartFrameFile = file || null;
  }
  if (file) activeComposition = null;
  startImageName.textContent = file ? file.name : "未選択なら、上で選んだ登録画像を使います。";
  showCustomStartImage(file);
  renderPromptIdeaStartFrame();
  renderActiveComposition();
  updateModeUi();
  renderCreator();
};

$("#clear-start-image").onclick = () => {
  clearCustomStartImage();
  updateModeUi();
  renderCreator();
};

promptIdeaStartFrameInput.onchange = async () => {
  const file = promptIdeaStartFrameInput.files[0];
  if (!file) return;
  promptIdeaStartFrameFile = file;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  syncingPromptIdeaStartFrame = true;
  startImageInput.files = transfer.files;
  await startImageInput.onchange();
  syncingPromptIdeaStartFrame = false;
};

$("#clear-prompt-idea-start-frame").onclick = () => {
  clearCustomStartImage();
  updateModeUi();
  renderCreator();
};

endImageInput.onchange = async () => {
  let file = endImageInput.files[0];
  if (file && !isSupportedImage(file)) {
    alert("終了フレームにはPNG、JPEG、WebP画像を選択してください。");
    endImageInput.value = "";
    clearCustomEndImage();
    return;
  }
  if (file) try {
    file = await optimizeImageFile(file, 5 * 1024 * 1024);
    replaceInputFiles(endImageInput, [file]);
  } catch (error) {
    alert(error.message);
    endImageInput.value = "";
    clearCustomEndImage();
    return;
  }
  endImageName.textContent = file ? file.name : "未選択なら、上で選んだ終了フレームの登録画像を使います。";
  showCustomEndImage(file);
  renderEndRegisteredImages();
  updateModeUi();
};

$("#clear-end-image").onclick = () => {
  clearCustomEndImage();
  renderEndRegisteredImages();
  updateModeUi();
};

digitalAudioInput.onchange = async () => {
  const file = digitalAudioInput.files[0];
  digitalAudioDurationSeconds = null;
  if (file && file.size > 15 * 1024 * 1024) {
    alert("音声ファイルは15MB以内にしてください。");
    digitalAudioInput.value = "";
    return;
  }
  if (file && !/\.(mp3|wav|m4a|aac|ogg|wma)$/i.test(file.name)) {
    alert("MP3、WAV、M4A、AAC、OGG、WMAの音声を選択してください。");
    digitalAudioInput.value = "";
    return;
  }
  if (file) digitalAudioDurationSeconds = await mediaDuration(file);
  digitalAudioName.textContent = file
    ? `${file.name}${digitalAudioDurationSeconds ? `（約${digitalAudioDurationSeconds}秒）` : ""}`
    : "MP3、WAV、M4A、AAC、OGG、WMA（15MB以内）。Cloudflare R2へ一時保存し、24時間後に削除します。";
  updateGenerateState();
};

function showCustomStartImage(file) {
  if (customStartImageObjectUrl) URL.revokeObjectURL(customStartImageObjectUrl);
  customStartImageObjectUrl = file ? URL.createObjectURL(file) : null;
  customStartStatus.hidden = !file;
  customStartFileName.textContent = file?.name || "";
  if (file) customStartPreview.src = customStartImageObjectUrl;
  else customStartPreview.removeAttribute("src");
}

function clearCustomStartImage() {
  startImageInput.value = "";
  promptIdeaStartFrameInput.value = "";
  promptIdeaStartFrameFile = null;
  startImageName.textContent = "未選択なら、上で選んだ登録画像を使います。";
  showCustomStartImage(null);
  renderPromptIdeaStartFrame();
}

function renderPromptIdeaStartFrame() {
  const file = promptIdeaStartFrameFile || startImageInput.files[0] || null;
  promptIdeaStartFrameField.hidden = !usesStartImage();
  if (promptIdeaStartFrameObjectUrl) URL.revokeObjectURL(promptIdeaStartFrameObjectUrl);
  promptIdeaStartFrameObjectUrl = file ? URL.createObjectURL(file) : null;
  promptIdeaStartFrameStatus.hidden = !file;
  promptIdeaStartFrameName.textContent = file?.name || "";
  if (file) promptIdeaStartFramePreview.src = promptIdeaStartFrameObjectUrl;
  else promptIdeaStartFramePreview.removeAttribute("src");
}

function showCustomEndImage(file) {
  if (customEndImageObjectUrl) URL.revokeObjectURL(customEndImageObjectUrl);
  customEndImageObjectUrl = file ? URL.createObjectURL(file) : null;
  customEndStatus.hidden = !file;
  customEndFileName.textContent = file?.name || "";
  if (file) customEndPreview.src = customEndImageObjectUrl;
  else customEndPreview.removeAttribute("src");
}

function showExtensionFinalFrame(file, originalName = file?.name || null) {
  if (extensionFinalFrameObjectUrl) URL.revokeObjectURL(extensionFinalFrameObjectUrl);
  extensionFinalFrameObjectUrl = file ? URL.createObjectURL(file) : null;
  extensionFinalFrameOriginalName = file ? originalName : null;
  extensionFinalFrameStatus.hidden = !file;
  extensionFinalFrameName.textContent = originalName || file?.name || "保存済みの最終フレーム";
  if (file) {
    extensionFinalFramePreview.src = extensionFinalFrameObjectUrl;
    extensionFinalFrameOpen.href = extensionFinalFrameObjectUrl;
  } else {
    extensionFinalFramePreview.removeAttribute("src");
    extensionFinalFrameOpen.removeAttribute("href");
  }
}

function clearExtensionFinalFrame() {
  extensionForm.elements.finalFrameImage.value = "";
  showExtensionFinalFrame(null);
}

extensionForm.elements.finalFrameImage.onchange = () => {
  const file = extensionForm.elements.finalFrameImage.files[0] || null;
  showExtensionFinalFrame(file);
};

$("#clear-extension-final-frame").onclick = clearExtensionFinalFrame;

function clearCustomEndImage() {
  endImageInput.value = "";
  endImageName.textContent = "未選択なら、上で選んだ終了フレームの登録画像を使います。";
  showCustomEndImage(null);
}

function usesStartImage() {
  return ["image-to-video", "start-end-to-video"].includes(getMode());
}

compositionUploadInput.onchange = async () => {
  let files = [...compositionUploadInput.files];
  if (files.some(file => !isSupportedImage(file))) {
    alert("PNG、JPEG、WebP形式の画像を選択してください。");
    compositionUploadInput.value = "";
    return;
  }
  if (selectedCompositionImages.size + files.length > 6) {
    alert("合成元の画像は合計6枚までです。");
    compositionUploadInput.value = "";
    return;
  }
  try {
    files = await Promise.all(files.map(file => optimizeImageFile(file)));
  } catch (error) {
    alert(error.message);
    compositionUploadInput.value = "";
    return;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > 18 * 1024 * 1024) {
    alert("合成元画像の合計は18MB以内にしてください。");
    compositionUploadInput.value = "";
    return;
  }
  compositionUploadFiles = files;
  compositionUploadName.textContent = files.length
    ? `${files.length}枚の追加画像を選択中です。`
    : "登録画像と合わせて最大6枚、合計18MB以内です。";
  renderCompositionUploads();
  renderCompositionSourceLibrary();
};

compositionForm.elements.compositionModel.onchange = updateCompositionGenerateState;

compositionForm.onsubmit = async event => {
  event.preventDefault();
  $("#composition-error").textContent = "";
  const registeredImages = selectedRegisteredCompositionImages();
  const total = registeredImages.length + compositionUploadFiles.length;
  if (total < 2) {
    $("#composition-error").textContent = "合成元の画像を2枚以上選択してください。";
    return;
  }
  const button = $("#compose-image-button");
  button.disabled = true;
  button.textContent = "Seedreamで合成中…（少し時間がかかります）";
  const result = await api("/api/compositions", {
    method: "POST",
    body: {
      model: compositionForm.elements.compositionModel.value,
      aspectRatio: compositionForm.elements.compositionAspectRatio.value,
      prompt: compositionForm.elements.compositionPrompt.value,
      registeredImages: registeredImages.map(({ asset, image }) => ({ assetId: asset.id, imageName: image.name })),
      uploadedImages: await Promise.all(compositionUploadFiles.map(file => toDataUrl(file)))
    }
  });
  if (result.error) {
    $("#composition-error").textContent = result.error;
    updateCompositionGenerateState();
    await loadCostStatus();
    return;
  }
  imageCompositions = [result, ...imageCompositions.filter(item => item.id !== result.id)];
  showCompositionResult(result);
  await loadCostStatus();
  updateCompositionGenerateState();
};

$("#use-composition-button").onclick = () => {
  if (compositionResultRecord) useComposition(compositionResultRecord);
};

$("#idea-from-composition-button").onclick = () => {
  if (!compositionResultRecord) return;
  useComposition(compositionResultRecord);
  $("#prompt-idea-panel").open = true;
  $("#prompt-idea-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  promptIdeaStatus.className = "field-hint";
  promptIdeaStatus.textContent = "この合成画像を見て動きを考えます。モードと雰囲気を選んで「プロンプト作成」を押してください。";
};

$("#clear-composition-image").onclick = () => {
  activeComposition = null;
  renderActiveComposition();
  renderCreator();
  if (compositionResultRecord) showCompositionResult(compositionResultRecord);
};

generationForm.onchange = event => {
  if (event.target === generationForm.elements.mode) {
    selectDefaultProviderForMode(getMode());
    reconcileProviderSelection();
    renderProviderPicker();
    renderCreator();
  }
  if (event.target === generationForm.elements.duration) enforceVeoResolutionRule();
  refreshSharedOptions();
  updateModeUi();
  renderPromptIdeaSource();
};

generationForm.onsubmit = async event => {
  event.preventDefault();
  $("#generation-error").textContent = "";
  const data = new FormData(generationForm);
  const button = $("#generate-button");
  const mode = getMode();
  const startImageFile = startImageInput.files[0];
  const digitalAudioFile = digitalAudioInput.files[0];
  const referenceImages = mode === "reference-to-video" ? getSelectedReferenceImages() : [];
  const sourceImage = mode === "reference-to-video" ? referenceImages[0] || null : getSelectedSourceImage();
  const temporaryRegisteredImages = mode === "reference-to-video"
    ? temporaryRegisteredReferenceImages()
    : [];
  const referenceUploadImages = mode === "reference-to-video"
    ? await Promise.all([
      ...referenceUploadFiles.map(file => toDataUrl(file)),
      ...temporaryRegisteredImages.map(({ image }) => imageUrlToDataUrl(image.url))
    ])
    : [];
  const compositionId = !startImageFile && activeComposition
    && ["image-to-video", "start-end-to-video", "digital-human"].includes(mode)
    ? activeComposition.id
    : null;
  const providers = getSelectedProviderRequests();

  button.disabled = true;
  button.textContent = providers.length > 1 ? `${providers.length}サービスへ送信中…` : "生成サービスへ送信中…";

  let audioUrl = null;
  let audioObjectKey = null;
  let audioDuration = null;
  if (mode === "digital-human") {
    if (!digitalAudioFile) {
      $("#generation-error").textContent = "話させる音声ファイルを選択してください。";
      updateGenerateState();
      return;
    }
    const uploaded = await api("/api/uploads/audio", {
      method: "POST",
      body: { fileName: digitalAudioFile.name, dataUrl: await toDataUrl(digitalAudioFile) }
    });
    if (uploaded.error) {
      $("#generation-error").textContent = uploaded.error;
      updateGenerateState();
      return;
    }
    audioUrl = uploaded.url;
    audioObjectKey = uploaded.key;
    audioDuration = await mediaDuration(digitalAudioFile);
  }

  const result = await api("/api/generations", {
    method: "POST",
    body: {
      providers,
      mode,
      characterId: selected.id,
      sourceImageName: sourceImage?.name || null,
      compositionId,
      referenceImageNames: referenceImages.map(image => image.name),
      referenceUploadImages,
      prompt: data.get("prompt"),
      duration: Number(data.get("duration")),
      resolution: data.get("resolution"),
      aspectRatio: data.get("aspectRatio"),
      audio: data.get("audio") === "on",
      offPeak: data.get("offPeak") === "on",
      startImage: usesStartImage() && startImageFile ? await toDataUrl(startImageFile) : null,
      endImage: mode === "start-end-to-video" && endImageInput.files[0] ? await toDataUrl(endImageInput.files[0]) : null,
      endImageName: mode === "start-end-to-video" && !endImageInput.files[0] ? getSelectedEndImage()?.name || null : null,
      audioUrl,
      audioObjectKey,
      audioDuration
    }
  });

  await loadCostStatus();
  updateGenerateState();
  const errors = result.errors || (result.error ? [{ error: result.error }] : []);
  if (errors.length) {
    $("#generation-error").textContent = errors.map(item => `${item.name ? `${item.name}: ` : ""}${item.error}`).join(" / ");
  }
  if (!result.records?.length) return;

  generationForm.elements.prompt.value = "";
  savePromptDraft({ silent: true });
  promptDraftStatus.textContent = "生成に使用したため、下書きを空にしました。";
  if (mode === "reference-to-video") {
    referenceUploadFiles = [];
    referenceImagesInput.value = "";
    referenceImagesName.textContent = "登録画像と合わせて最大7枚、合計14MB以内です。";
  }
  if (usesStartImage()) {
    clearCustomStartImage();
    if (mode === "start-end-to-video") {
      clearCustomEndImage();
      selectedEndImageNames.delete(selected.id);
    }
    updateModeUi();
    renderCreator();
  }
  if (mode === "digital-human") {
    digitalAudioInput.value = "";
    digitalAudioDurationSeconds = null;
    digitalAudioName.textContent = "MP3、WAV、M4A、AAC、OGG、WMA（15MB以内）。Cloudflare R2へ一時保存し、24時間後に削除します。";
  }
  await loadHistory();
  startPolling();
};

function renderProviderPicker() {
  const mode = getMode();
  $("#provider-picker").replaceChildren(...providerSpecs.map(provider => {
    const compatibleModels = provider.models.filter(model => model.modes.includes(mode));
    const available = serverReady && provider.configured && compatibleModels.length > 0;
    if (!available) selectedProviderIds.delete(provider.id);
    let selectedModelId = selectedModels.get(provider.id);
    if (!compatibleModels.some(model => model.id === selectedModelId)) {
      selectedModelId = compatibleModels.find(model => model.default)?.id || compatibleModels[0]?.id;
      if (selectedModelId) selectedModels.set(provider.id, selectedModelId);
    }
    const card = document.createElement("article");
    card.className = `provider-card${selectedProviderIds.has(provider.id) ? " selected" : ""}${available ? "" : " unavailable"}`;
    const reason = !provider.configured
      ? `${provider.envKey || "APIキー"} 未設定`
      : !compatibleModels.length
        ? "この生成方式には未対応"
        : "利用可能";
    const selectedModel = compatibleModels.find(model => model.id === selectedModelId);
    card.innerHTML = `<label class="provider-check"><input type="checkbox"${selectedProviderIds.has(provider.id) ? " checked" : ""}${available ? "" : " disabled"}><span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(reason)}</small></span></label><label class="provider-model">モデル<select${available ? "" : " disabled"}>${compatibleModels.map(model => `<option value="${escapeHtml(model.id)}"${model.id === selectedModelId ? " selected" : ""}>${escapeHtml(model.label)}</option>`).join("")}</select></label>${modelInsight(selectedModel)}<p>${escapeHtml(provider.notes || "")}</p>`;
    const checkbox = card.querySelector("input");
    checkbox.onchange = () => {
      if (checkbox.checked) selectedProviderIds.add(provider.id);
      else selectedProviderIds.delete(provider.id);
      card.classList.toggle("selected", checkbox.checked);
      updateProviderSelectionSummary();
      refreshSharedOptions();
      updateGenerateState();
    };
    const modelSelect = card.querySelector("select");
    modelSelect.onchange = () => {
      selectedModels.set(provider.id, modelSelect.value);
      renderProviderPicker();
      refreshSharedOptions();
      updateGenerateState();
    };
    return card;
  }));
  updateProviderSelectionSummary();
}

function updateProviderSelectionSummary() {
  const summary = $("#provider-selection-summary");
  const selectedProviders = selectedProviderModels();
  if (!selectedProviders.length) {
    summary.textContent = "未選択";
    return;
  }
  summary.textContent = selectedProviders.length === 1
    ? `${selectedProviders[0].provider.name} / ${selectedProviders[0].model.label}`
    : `${selectedProviders.map(item => item.provider.name).join("・")}（${selectedProviders.length}サービス）`;
}

function reconcileProviderSelection() {
  const mode = getMode();
  for (const id of [...selectedProviderIds]) {
    const provider = providerSpecs.find(item => item.id === id);
    if (!provider?.configured || !provider.models.some(model => model.modes.includes(mode))) {
      selectedProviderIds.delete(id);
    }
  }
  if (!selectedProviderIds.size) {
    const fallback = providerSpecs.find(provider => provider.configured && provider.models.some(model => model.modes.includes(mode)));
    if (fallback) selectedProviderIds.add(fallback.id);
  }
}

function selectDefaultProviderForMode(mode) {
  if (mode !== "digital-human") return;
  const hedra = providerSpecs.find(provider => provider.id === "hedra"
    && provider.configured && provider.models.some(model => model.modes.includes(mode)));
  if (!hedra) return;
  selectedProviderIds.clear();
  selectedProviderIds.add(hedra.id);
}

function selectedProviderModels() {
  const mode = getMode();
  return [...selectedProviderIds].map(id => {
    const provider = providerSpecs.find(item => item.id === id);
    if (!provider) return null;
    const compatible = provider.models.filter(model => model.modes.includes(mode));
    let model = compatible.find(item => item.id === selectedModels.get(id));
    if (!model) model = compatible.find(item => item.default) || compatible[0];
    if (model) selectedModels.set(id, model.id);
    return model ? { provider, model } : null;
  }).filter(Boolean);
}

function getSelectedProviderRequests() {
  return selectedProviderModels().map(({ provider, model }) => ({ id: provider.id, model: model.id }));
}

function refreshSharedOptions() {
  const selectedModels = selectedProviderModels();
  const mode = getMode();
  const durations = intersection(selectedModels.map(({ model }) => modelDurations(model, mode)));
  const resolutions = intersection(selectedModels.map(({ model }) => model.resolutions));
  const ratios = intersection(selectedModels.map(({ model }) =>
    mode === "reference-to-video" ? model.referenceAspectRatios || model.aspectRatios : model.aspectRatios
  ));
  replaceOptions(generationForm.elements.duration, durations.length ? durations : [3, 4, 5, 6, 8, 10], value => `${value}秒`, 5);
  replaceOptions(generationForm.elements.resolution, resolutions.length ? resolutions : ["720p"], resolutionLabel, "720p");
  replaceOptions(generationForm.elements.aspectRatio, ratios.length ? ratios : ["16:9"], ratioLabel, "16:9");
  enforceVeoResolutionRule();
  updateCost();
}

function enforceVeoResolutionRule() {
  const hasVeo = selectedProviderIds.has("veo");
  const resolution = generationForm.elements.resolution.value;
  if (hasVeo && resolution !== "720p" && Number(generationForm.elements.duration.value) !== 8) {
    const option = [...generationForm.elements.duration.options].find(item => item.value === "8");
    if (option) generationForm.elements.duration.value = "8";
  }
}

function intersection(arrays) {
  if (!arrays.length) return [];
  return arrays[0].filter(value => arrays.every(array => array.includes(value)));
}

function modelDurations(model, mode) {
  if (mode === "start-end-to-video") return model.startEndDurations || model.durations;
  if (mode === "reference-to-video") return model.referenceDurations || model.durations;
  return model.durations;
}

function replaceOptions(select, values, label, fallback) {
  const previous = select.value;
  select.replaceChildren(...values.map(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label(value);
    return option;
  }));
  const desired = values.includes(coerceLike(values[0], previous))
    ? coerceLike(values[0], previous)
    : values.includes(fallback)
      ? fallback
      : values[0];
  select.value = desired;
}

function coerceLike(example, value) {
  return typeof example === "number" ? Number(value) : value;
}

function updateModeUi() {
  const mode = getMode();
  const isImageToVideo = mode === "image-to-video";
  const isStartEndToVideo = mode === "start-end-to-video";
  const isDigitalHuman = mode === "digital-human";
  const isReferenceToVideo = mode === "reference-to-video";
  const needsStartImage = isImageToVideo || isStartEndToVideo;
  const hasCustomStartImage = needsStartImage && Boolean(startImageInput.files[0]);
  const hasCompositeStartImage = needsStartImage && Boolean(activeComposition);
  startImageField.hidden = !needsStartImage;
  referenceImagesField.hidden = !isReferenceToVideo;
  endFrameFields.hidden = !isStartEndToVideo;
  digitalAudioField.hidden = !isDigitalHuman;
  $("#duration-field").hidden = isDigitalHuman;
  $("#aspect-ratio-field").hidden = false;
  $("#generated-audio-field").hidden = isDigitalHuman;
  $("#off-peak-field").hidden = isDigitalHuman;
  generationForm.elements.audio.disabled = isDigitalHuman;
  generationForm.elements.offPeak.disabled = isDigitalHuman;
  generationForm.elements.audio.checked = isDigitalHuman ? false : generationForm.elements.audio.checked;
  generationForm.elements.offPeak.checked = isDigitalHuman ? false : generationForm.elements.offPeak.checked;
  generationForm.elements.prompt.required = !isDigitalHuman;
  $("#prompt-label").firstChild.textContent = isDigitalHuman ? "映像の演出（任意）" : "どんな動画にしますか？";
  if (isDigitalHuman && !generationForm.elements.prompt.value.trim()) {
    generationForm.elements.prompt.value = "例：正面を見て自然に話す。落ち着いた表情で、上半身を中心に固定カメラ、自然なまばたきと小さなうなずき。";
  }
  customStartStatus.hidden = !hasCustomStartImage;
  renderActiveComposition();
  renderPromptIdeaStartFrame();
  customEndStatus.hidden = !isStartEndToVideo || !endImageInput.files[0];
  $("#source-image-selector").hidden = mode === "text-to-video";
  $("#source-image-title").textContent = needsStartImage
    ? hasCustomStartImage || hasCompositeStartImage ? "登録画像（別画像で上書き中）" : "最初のイメージを選択"
    : isReferenceToVideo ? "参照する画像を複数選択" : "参照する画像を選択";
  $("#source-image-hint").textContent = needsStartImage
    ? hasCustomStartImage
      ? "登録画像をクリックすると上書きを解除し、その画像を開始フレームに切り替えます。"
      : "クリックした登録画像を動画の開始フレームに使います。"
    : isReferenceToVideo
      ? "Vidu用に、登録画像と追加画像を合わせて最大7枚まで選択できます。複数枚の場合はViduだけを選択してください。"
      : "クリックした登録画像1枚だけをキャラクター参照として使います。";
  $("#image-notice").hidden = mode === "text-to-video" || (isReferenceToVideo
    ? Boolean(getSelectedReferenceImages().length || referenceUploadFiles.length)
    : Boolean(getSelectedSourceImage() || activeComposition));
  updateGenerateState();
}

function updateCost() {
  const isDigitalHuman = getMode() === "digital-human";
  const duration = isDigitalHuman
    ? Number(digitalAudioDurationSeconds || 5)
    : Number(generationForm.elements.duration.value || 5);
  const resolution = generationForm.elements.resolution.value || "720p";
  const aspectRatio = generationForm.elements.aspectRatio.value || "9:16";
  const audio = generationForm.elements.audio.checked;
  const offPeak = generationForm.elements.offPeak.checked;
  const costs = selectedProviderModels().map(({ provider, model }) => ({
    id: provider.id,
    name: provider.name,
    model,
    value: estimateCost(provider, model, { duration, resolution, audio, offPeak, mode: getMode() })
  }));
  const total = costs.reduce((sum, item) => sum + item.value, 0);
  const hasAfterGenerationCost = costs.some(item => item.model.price?.type === "after-generation");
  $("#cost-breakdown").innerHTML = costs.map(item => {
    if (item.model.price?.type === "after-generation") return `<span>${escapeHtml(item.name)} 生成後に実額表示</span>`;
    return `<span>${escapeHtml(item.name)} ${money(item.value)}</span>`;
  }).join("");
  $("#cost").textContent = hasAfterGenerationCost
    ? total > 0 ? `概算 ${money(total)} ＋ Vidu生成後実額` : "生成後にVidu実額を表示"
    : `${costs.length > 1 ? "合計" : "概算"} ${money(total)}`;
  $("#format-summary").textContent = isDigitalHuman && digitalAudioDurationSeconds
    ? `音声 約${duration}秒 / ${ratioLabel(aspectRatio)}`
    : ratioLabel(aspectRatio);
  const notes = selectedProviderModels().flatMap(({ provider }) => [
    provider.notes,
    getMode() === "reference-to-video" ? provider.referenceNotes : ""
  ]).filter(Boolean);
  if (getMode() === "reference-to-video" && temporaryReferenceImageCount() > 1
    && selectedProviderModels().some(({ provider }) => provider.id !== "vidu")) {
    notes.push("複数の参照画像を使う場合は、Viduだけを選択してください。");
  }
  for (const item of costs) {
    const budgetReason = providerBudgetBlockReason(item.id, item.value);
    if (budgetReason) notes.push(costs.length > 1 ? `${item.name}のみ送信停止: ${budgetReason}` : budgetReason);
  }
  $("#provider-warning").textContent = [...new Set(notes)].join(" ");
}

function estimateCost(provider, model, options) {
  const price = model.price || {};
  if (price.type === "runway-credits") return (options.duration * price.creditsPerSecond + (price.imageCredits || 0)) * 0.01;
  if (price.type === "per-second") return options.duration * (price.rates?.[options.resolution] || 0);
  if (price.type === "seedance-1.5") {
    const rate = { "480p": 0.012, "720p": 0.026, "1080p": 0.058 }[options.resolution] || 0.026;
    return options.duration * rate * (options.audio ? 2 : 1);
  }
  if (price.type === "seedance-2-mini") return options.duration * (options.resolution === "480p" ? 0.04 : 0.08);
  if (price.type === "vidu") {
    const high = model.id === "viduq3" || model.id === "viduq3-pro";
    let rate;
    if (options.mode !== "reference-to-video") {
      rate = high
        ? options.resolution === "540p" ? 0.045 : options.resolution === "1080p" ? 0.12 : 0.10
        : options.resolution === "540p" ? 0.035 : options.resolution === "1080p" ? 0.065 : 0.055;
    } else {
      rate = high
        ? options.resolution === "540p" ? 0.035 : options.resolution === "1080p" ? 0.075 : 0.06
        : options.resolution === "540p" ? 0.02 : options.resolution === "1080p" ? 0.065 : 0.05;
    }
    return options.duration * rate * (options.offPeak ? 0.5 : 1);
  }
  return 0;
}

function modelInsight(model) {
  if (!model?.summary) return "";
  const { cost, features, limits } = model.summary;
  return `<dl class="model-insight"><div><dt>目安コスト</dt><dd>${escapeHtml(cost)}</dd></div><div><dt>得意</dt><dd>${escapeHtml(features)}</dd></div>${limits ? `<div><dt>制約</dt><dd>${escapeHtml(limits)}</dd></div>` : ""}</dl>`;
}

function updateGenerateState() {
  const button = $("#generate-button");
  const mode = getMode();
  const hasStartImage = Boolean(startImageInput.files[0] || activeComposition);
  const hasSourceImage = Boolean(getSelectedSourceImage() || activeComposition);
  const referenceImageCount = temporaryReferenceImageCount();
  const hasEndImage = Boolean(endImageInput.files[0] || getSelectedEndImage());
  const hasDigitalAudio = Boolean(digitalAudioInput.files[0]);
  const selectedProviders = selectedProviderModels();
  const onlySelection = selectedProviders.length === 1 ? selectedProviders[0] : null;
  const onlyCost = onlySelection ? selectedProviderEstimate(onlySelection.provider.id) : null;
  const budgetReason = onlySelection && onlyCost !== null
    ? providerBudgetBlockReason(onlySelection.provider.id, onlyCost)
    : "";
  const onlyProviderBlocked = Boolean(onlySelection && budgetReason);
  const referenceUsesUnsupportedProvider = mode === "reference-to-video" && referenceImageCount > 1
    && selectedProviders.some(({ provider }) => provider.id !== "vidu");
  const audioLimitViolation = mode === "digital-human" && digitalAudioDurationSeconds
    ? selectedProviders.find(({ model }) => model.maxAudioDuration && digitalAudioDurationSeconds > model.maxAudioDuration)
    : null;
  button.disabled = !serverReady || !selected || !selectedProviders.length
    || (mode === "text-to-video" ? false : mode === "digital-human" ? !hasSourceImage || !hasDigitalAudio : mode === "start-end-to-video" ? ((!hasStartImage && !hasSourceImage) || !hasEndImage) : mode === "image-to-video" ? !hasStartImage && !hasSourceImage : !referenceImageCount)
    || referenceUsesUnsupportedProvider
    || Boolean(audioLimitViolation)
    || onlyProviderBlocked;
  button.textContent = selectedProviders.length > 1
    ? `${selectedProviders.length}サービスで比較生成`
    : selectedProviders.length === 1
      ? `${selectedProviders[0].provider.name}で動画を生成`
      : "生成サービスを選択してください";
  button.title = !serverReady
    ? "新しいサーバー機能を読み込むため再起動してください"
    : onlyProviderBlocked
      ? budgetReason
    : !selectedProviders.length
      ? "API設定済みの生成サービスを選択してください"
      : referenceUsesUnsupportedProvider
        ? "複数の参照画像はViduだけで生成できます"
      : audioLimitViolation
        ? `${audioLimitViolation.model.label}で使える音声は${audioLimitViolation.model.maxAudioDuration === 600 ? "10分" : `${audioLimitViolation.model.maxAudioDuration}秒`}以内です`
      : mode === "start-end-to-video" && !hasEndImage
        ? "終了フレーム画像を選択してください"
      : mode === "digital-human" && !hasDigitalAudio
        ? "話させる音声ファイルを選択してください"
      : mode !== "text-to-video" && !hasSourceImage && !hasStartImage
        ? "元画像を1枚登録して選択してください"
        : "";
  updateCost();
}

function selectedProviderEstimate(providerId) {
  const selectedProvider = selectedProviderModels().find(({ provider }) => provider.id === providerId);
  if (!selectedProvider) return null;
  return estimateCost(selectedProvider.provider, selectedProvider.model, {
    duration: getMode() === "digital-human"
      ? Number(digitalAudioDurationSeconds || 5)
      : Number(generationForm.elements.duration.value || 5),
    resolution: generationForm.elements.resolution.value || "720p",
    audio: generationForm.elements.audio.checked,
    offPeak: generationForm.elements.offPeak.checked,
    mode: getMode()
  });
}

function providerBudgetBlockReason(providerId, cost) {
  const provider = costStatus?.providers?.[providerId];
  if (!provider?.settings?.enabled) return "";
  const amount = Number(cost);
  if (amount > provider.settings.perRequest + 0.00001) {
    return `概算${money(amount)}が1回上限${money(provider.settings.perRequest)}を超えます。`;
  }
  if (provider.daily.committed + amount > provider.settings.daily + 0.00001) {
    return `本日分が1日上限${money(provider.settings.daily)}を超えます。`;
  }
  if (provider.monthly.committed + amount > provider.settings.monthly + 0.00001) {
    return `今月分が月額上限${money(provider.settings.monthly)}を超えます。`;
  }
  return "";
}

function extensionBadgeLabel(item, items) {
  const depth = Number(item.extensionDepth) || 1;
  const label = item.extensionKind === "pseudo" ? "疑似延長" : "続き";
  const siblings = items
    .filter(candidate => candidate.mode === "video-extension" && candidate.parentGenerationId === item.parentGenerationId)
    .sort((first, second) => String(first.createdAt || first.id).localeCompare(String(second.createdAt || second.id)));

  if (siblings.length < 2) return `${label} ${depth}`;

  const savedBranch = Number(item.extensionBranch);
  const branch = Number.isInteger(savedBranch) && savedBranch > 0
    ? savedBranch
    : siblings.findIndex(candidate => candidate.id === item.id) + 1;
  return `${label} ${depth}-${branch}`;
}

function isViduCreditInsufficient(item) {
  if (item?.provider !== "vidu") return false;
  const detail = [item.failureCode, item.failure, item.error].filter(Boolean).join(" ");
  return /credit[ _-]?insufficient|insufficient[ _-]?(?:credit|balance)|(?:credit|balance).*insufficient/i.test(detail);
}

function displayHistoryFailure(item) {
  return isViduCreditInsufficient(item)
    ? "Viduクレジット不足：クレジットを補充してから、もう一度生成してください。"
    : item.failure || "";
}

function refreshViduCreditAlert(items) {
  const latestFailure = items.find(isViduCreditInsufficient);
  if (!latestFailure || dismissedViduCreditFailureIds.has(latestFailure.id)) return;
  activeViduCreditFailureId = latestFailure.id;
  $("#vidu-credit-alert-message").textContent = `Viduがクレジット不足で生成を停止しました（${new Date(latestFailure.createdAt).toLocaleString("ja-JP")}）。クレジットを補充してから、もう一度生成してください。`;
  $("#vidu-credit-alert").hidden = false;
}

function setHistoryView(view) {
  historyView = view === "grid" ? "grid" : "list";
  localStorage.setItem("shortvideo:history-view", historyView);
  renderHistoryViewToggle();
  loadHistory();
}

function renderHistoryViewToggle() {
  $("#show-history-list").setAttribute("aria-pressed", String(historyView === "list"));
  $("#show-history-grid").setAttribute("aria-pressed", String(historyView === "grid"));
}

function compactHistoryTitle(item) {
  const title = String(historyTitles.get(item.id) || "動画生成");
  const dateOrTitle = title.includes("｜") ? title.split("｜", 1)[0].trim() : title;
  const extension = item.mode === "video-extension" ? extensionBadgeLabel(item, historyItems) : "";
  return extension ? `${extension} / ${dateOrTitle}` : dateOrTitle;
}

function renderGridHistoryCard(item) {
  const card = document.createElement("article");
  const title = compactHistoryTitle(item);
  card.className = `history-grid-card provider-${item.provider || "vidu"}`;
  card.dataset.generationId = item.id;
  const favoriteMark = item.favorite === true
    ? "<span class=\"history-grid-favorite active\" aria-label=\"Fav済み\" title=\"Fav済み\">♥</span>"
    : "<span class=\"history-grid-favorite\" aria-label=\"Favではありません\" title=\"Favではありません\">♡</span>";
  card.innerHTML = item.localUrl
    ? `<button type="button" class="history-grid-video" aria-label="${escapeHtml(title)}を再生"><video src="${item.localUrl}" muted playsinline preload="metadata"></video>${favoriteMark}</button><button type="button" class="history-grid-title" title="設定詳細を表示">${escapeHtml(title)}</button>`
    : `<div class="history-grid-placeholder" aria-hidden="true">${favoriteMark}</div><button type="button" class="history-grid-title" title="設定詳細を表示">${escapeHtml(title)}</button>`;
  const mediaButton = card.querySelector(".history-grid-video");
  if (mediaButton) mediaButton.onclick = () => openVideo(item.localUrl, item.id);
  card.querySelector(".history-grid-title").onclick = () => openGenerationDetails(item);
  return card;
}

async function loadHistory() {
  const items = await api("/api/generations");
  historyItems = Array.isArray(items) ? items : [];
  refreshViduCreditAlert(historyItems);
  historyTitles = createHistoryTitles(historyItems);
  renderHistoryViewToggle();
  $("#history").classList.toggle("history-grid", historyView === "grid");
  const filteredItems = historyFilter === "favorites"
    ? historyItems.filter(item => item.favorite === true)
    : historyFilter === "non-favorites"
      ? historyItems.filter(item => item.favorite !== true)
      : historyItems;
  const pageSize = historyView === "grid" ? gridHistoryPageSize : historyPageSize;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  historyPage = Math.min(historyPage, totalPages);
  const pageStart = (historyPage - 1) * pageSize;
  const visibleItems = filteredItems.slice(pageStart, pageStart + pageSize);
  const currentIds = new Set(historyItems.map(item => item.id));
  for (const id of selectedHistoryIds) if (!currentIds.has(id)) selectedHistoryIds.delete(id);
  if (!items.length || !filteredItems.length) {
    selectedHistoryIds.clear();
    updateHistoryDeleteControls();
    $("#history").innerHTML = historyFilter === "favorites"
      ? '<p class="muted">Favを付けた動画はまだありません。</p>'
      : historyFilter === "non-favorites"
        ? '<p class="muted">Fav以外の動画はありません。</p>'
        : '<p class="muted">まだ動画は生成されていません。</p>';
    renderHistoryPagination(0, 0, 0);
    return;
  }
  if (historyView === "grid") {
    $("#history").replaceChildren(...visibleItems.map(renderGridHistoryCard));
    updateHistoryDeleteControls();
    renderHistoryPagination(filteredItems.length, totalPages, pageStart, pageSize);
    return;
  }
  $("#history").replaceChildren(...visibleItems.map(item => {
    const card = document.createElement("article");
    const canDelete = ["success", "failed", "cancelled"].includes(item.state);
    const isSelectedForDeletion = selectedHistoryIds.has(item.id);
    const provider = providerSpecs.find(candidate => candidate.id === (item.provider || "vidu"));
    const canCancel = (provider?.cancelStates || ["created", "queueing"]).includes(item.state);
    const canExtend = item.state === "success" && providerCanExtendItem(provider, item);
    const isLooping = loopingHistoryIds.has(item.id);
    const isFavorite = item.favorite === true;
    card.className = `history-card provider-${item.provider || "vidu"}${isSelectedForDeletion ? " selected-for-deletion" : ""}`;
    card.dataset.generationId = item.id;
    const sourceRole = item.mode === "image-to-video" ? "開始フレーム" : "送信した参照画像";
    const sourceRecord = item.mode === "video-extension"
      ? `<p class="source-record">元動画 ${Number(item.sourceDuration) || "?"}秒から ${Number(item.extensionDuration) || "?"}秒延長</p>`
      : item.startImageSource === "composition" && item.sourceImageUrl
        ? `<p class="source-record"><img src="${item.sourceImageUrl}" alt="">${sourceRole} · Seedream合成画像</p>`
      : item.startImageSource === "upload"
        ? `<p class="source-record">${sourceRole} · 別画像アップロード</p>`
        : item.sourceImageUrl
          ? `<p class="source-record"><img src="${item.sourceImageUrl}" alt="">${sourceRole} · 登録画像1枚</p>`
          : "";
    const comparison = item.comparisonGroupId ? '<span class="comparison-badge">比較生成</span>' : "";
    const extensionBadge = item.mode === "video-extension"
      ? `<span class="extension-badge">${extensionBadgeLabel(item, historyItems)}</span>`
      : "";
    const hasViduCredits = item.provider === "vidu" && item.credits !== null && item.credits !== undefined;
    const hasActualCost = item.actualCost !== null && item.actualCost !== undefined;
    const recordedCost = item.actualCost ?? (
      hasViduCredits
        ? Number(item.credits) * 0.005
        : item.estimatedCost
    );
    const cost = recordedCost !== null && recordedCost !== undefined && Number.isFinite(Number(recordedCost))
      ? ` / ${hasActualCost || hasViduCredits ? "" : "約"}${money(Number(recordedCost))}`
      : "";
    const failureText = displayHistoryFailure(item);
    const failure = failureText ? `<p class="failure">${escapeHtml(failureText)}</p>` : "";
    const displayedPrompt = item.userPrompt ?? item.prompt;
    const prompt = displayedPrompt
      ? `<button type="button" class="history-prompt" title="クリックして全文と設定を表示">${escapeHtml(displayedPrompt)}</button>`
      : '<button type="button" class="muted history-prompt">続きの指示なし</button>';
    const title = historyTitles.get(item.id) || "動画生成";
    const canReuse = ["image-to-video", "reference-to-video", "text-to-video", "start-end-to-video", "digital-human", "video-extension"].includes(item.mode);
    card.innerHTML = `${item.localUrl ? `<div class="video-thumbnail"><video src="${item.localUrl}" controls playsinline${isLooping ? " loop" : ""}></video><button type="button" class="expand-video" data-video-url="${item.localUrl}" aria-label="動画を拡大表示" title="拡大表示">⛶</button></div>` : `<div class="video-placeholder"></div>`}<div>${comparison}${extensionBadge}<h3 class="generation-title" title="クリックしてタイトルを編集">${escapeHtml(title)}</h3>${prompt}${sourceRecord}${failure}<p class="history-meta">${providerLabel(item.provider || "vidu")} / ${modeLabel(item.mode)} / ${escapeHtml(item.model)} / ${item.aspectRatio || "9:16"} / ${item.resolution}${cost}</p></div><div class="history-actions"><button type="button" class="favorite-generation${isFavorite ? " active" : ""}" aria-pressed="${isFavorite}" title="${isFavorite ? "Favを外す" : "Favに追加"}">${isFavorite ? "★ Fav" : "☆ Fav"}</button><span class="state ${item.state}">${stateLabel(item.state)}</span>${canReuse ? '<button type="button" class="reuse-generation">この設定を再利用</button>' : ""}${item.localUrl ? `<label class="loop-video-toggle"><input type="checkbox"${isLooping ? " checked" : ""}><span>↻ ループ再生</span></label>` : ""}${canExtend ? '<button type="button" class="extend-generation">続きを生成</button>' : ""}${canCancel ? '<button type="button" class="cancel-generation">キャンセル</button>' : ""}<label class="history-select"><input type="checkbox" class="history-checkbox"${isSelectedForDeletion ? " checked" : ""}${canDelete ? "" : " disabled"}><span class="history-selection-label">${canDelete ? "選択" : "処理中"}</span></label></div>`;
    const titleHeading = card.querySelector(".generation-title");
    titleHeading.onclick = () => editGenerationTitle(item, titleHeading);
    card.querySelector(".history-prompt").onclick = () => openGenerationDetails(item);
    const inlineVideo = card.querySelector(".video-thumbnail video");
    const loopCheckbox = card.querySelector(".loop-video-toggle input");
    if (loopCheckbox) loopCheckbox.onchange = () => {
      setVideoLooping(item.id, loopCheckbox.checked);
      inlineVideo.loop = loopCheckbox.checked;
    };
    const expandButton = card.querySelector(".expand-video");
    if (expandButton) expandButton.onclick = () => openVideo(expandButton.dataset.videoUrl, item.id);
    const favoriteButton = card.querySelector(".favorite-generation");
    favoriteButton.onclick = async () => {
      favoriteButton.disabled = true;
      const result = await api(`/api/generations/${encodeURIComponent(item.id)}/favorite`, {
        method: "PUT",
        body: { favorite: !isFavorite }
      });
      if (result.error) {
        favoriteButton.disabled = false;
        return alert(result.error);
      }
      await loadHistory();
    };
    const reuseButton = card.querySelector(".reuse-generation");
    if (reuseButton) reuseButton.onclick = async () => {
      reuseButton.disabled = true;
      if (item.mode === "video-extension") await reuseExtensionSettings(item);
      else await reuseGenerationSettings(item);
      reuseButton.disabled = false;
    };
    const extendButton = card.querySelector(".extend-generation");
    if (extendButton) extendButton.onclick = () => openExtensionDialog(item, provider);
    const cancelButton = card.querySelector(".cancel-generation");
    if (cancelButton) cancelButton.onclick = async () => {
      if (!confirm("この動画生成をキャンセルしますか？")) return;
      cancelButton.disabled = true;
      cancelButton.textContent = "キャンセル中…";
      const result = await api(`/api/generations/${encodeURIComponent(item.id)}/cancel`, { method: "POST" });
      if (result.error) {
        alert(result.error);
        cancelButton.disabled = false;
        cancelButton.textContent = "キャンセル";
        return;
      }
      await loadHistory();
      await loadCostStatus();
    };
    const historyCheckbox = card.querySelector(".history-checkbox");
    historyCheckbox.onchange = () => {
      if (historyCheckbox.checked) selectedHistoryIds.add(item.id);
      else selectedHistoryIds.delete(item.id);
      card.classList.toggle("selected-for-deletion", historyCheckbox.checked);
      updateHistoryDeleteControls();
      refreshHistorySelectionLabels();
    };
    return card;
  }));
  updateHistoryDeleteControls();
  refreshHistorySelectionLabels();
  renderHistoryPagination(filteredItems.length, totalPages, pageStart, pageSize);
}

function renderHistoryPagination(totalItems, totalPages, pageStart, pageSize = historyPageSize) {
  for (const selector of ["#history-pagination-top", "#history-pagination"]) {
    renderHistoryPaginationInto(document.querySelector(selector), totalItems, totalPages, pageStart, pageSize);
  }
}

function renderHistoryPaginationInto(pagination, totalItems, totalPages, pageStart, pageSize) {
  pagination.replaceChildren();
  pagination.hidden = totalPages <= 1;
  if (totalPages <= 1) return;

  const summary = document.createElement("span");
  const pageEnd = Math.min(pageStart + pageSize, totalItems);
  summary.textContent = `${totalItems}件中 ${pageStart + 1}〜${pageEnd}件を表示`;
  pagination.append(summary, createHistoryPageButton("‹", historyPage - 1, "前のページ", historyPage === 1));

  for (const page of historyPageNumbers(totalPages, historyPage)) {
    if (page === "…") {
      const ellipsis = document.createElement("span");
      ellipsis.textContent = page;
      pagination.append(ellipsis);
      continue;
    }
    pagination.append(createHistoryPageButton(String(page), page, `${page}ページ目`, false, page === historyPage));
  }
  pagination.append(createHistoryPageButton("›", historyPage + 1, "次のページ", historyPage === totalPages));
}

function historyPageNumbers(totalPages, currentPage) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const sorted = [...pages].filter(page => page > 0 && page <= totalPages).sort((first, second) => first - second);
  return sorted.flatMap((page, index) => index && page - sorted[index - 1] > 1 ? ["…", page] : [page]);
}

function createHistoryPageButton(label, page, ariaLabel, disabled, current = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.setAttribute("aria-label", ariaLabel);
  if (current) button.setAttribute("aria-current", "page");
  button.onclick = async () => {
    historyPage = page;
    await loadHistory();
    $("#history").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return button;
}

function createHistoryTitles(items) {
  const titles = new Map();
  const order = new Map(items.map((item, index) => [item.id, index]));
  const sorted = [...items].sort((a, b) => {
    const difference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return difference || order.get(a.id) - order.get(b.id);
  });
  const dailyCounts = new Map();
  for (const item of sorted) {
    const date = generationDateKey(item.createdAt);
    const sequence = (dailyCounts.get(date) || 0) + 1;
    dailyCounts.set(date, sequence);
    const subject = String(item.userPrompt || item.prompt || "動画生成").replace(/\s+/g, " ").trim();
    const automatic = `${date}-${String(sequence).padStart(2, "0")}｜${subject.slice(0, 30)}${subject.length > 30 ? "…" : ""}`;
    titles.set(item.id, item.title || automatic);
  }
  return titles;
}

function generationDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value || Date.now()));
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function editGenerationTitle(item, heading) {
  if (heading.querySelector("input")) return;
  const previousTitle = historyTitles.get(item.id) || heading.textContent;
  const input = document.createElement("input");
  input.className = "generation-title-input";
  input.value = previousTitle;
  input.maxLength = 120;
  input.setAttribute("aria-label", "動画タイトル");
  heading.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    const title = input.value.trim().replace(/\s+/g, " ");
    if (!save || title === previousTitle) {
      heading.textContent = previousTitle;
      return;
    }
    const result = await api(`/api/generations/${encodeURIComponent(item.id)}/title`, {
      method: "PUT",
      body: { title }
    });
    if (result.error) {
      alert(result.error);
      heading.textContent = previousTitle;
      return;
    }
    item.title = result.title;
    historyTitles.set(item.id, result.title);
    heading.textContent = result.title;
  };
  input.onkeydown = event => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  input.onblur = () => finish(true);
}

function setHistoryFilter(filter) {
  historyFilter = filter;
  historyPage = 1;
  $("#show-all-history").setAttribute("aria-pressed", String(filter === "all"));
  $("#show-favorites-history").setAttribute("aria-pressed", String(filter === "favorites"));
  $("#show-non-favorites-history").setAttribute("aria-pressed", String(filter === "non-favorites"));
  loadHistory();
}

async function reuseExtensionSettings(item) {
  const parent = historyItems.find(candidate => candidate.id === item.parentGenerationId);
  if (!parent) {
    alert("この延長履歴の元動画が削除されているため、設定を再利用できません。");
    return;
  }
  const provider = providerSpecs.find(candidate => candidate.id === item.provider);
  if (!provider?.configured || !provider.extension) {
    alert(providerLabel(item.provider) + "の延長機能は現在利用できません。");
    return;
  }
  if (!providerCanExtendItem(provider, parent)) {
    alert(providerLabel(item.provider) + "では、元動画のモデル・長さ・解像度を現在の仕様で延長できません。");
    return;
  }

  openExtensionDialog(parent, provider);
  $("#extension-dialog-title").textContent = `${provider.name}の延長設定を再利用`;
  extensionForm.elements.prompt.value = item.userPrompt ?? item.prompt ?? "";
  setReusableSelectValue(extensionForm.elements.model, item.model);
  setReusableSelectValue(extensionForm.elements.duration, item.extensionDuration);
  setReusableSelectValue(extensionForm.elements.resolution, item.resolution);

  if (Number(item.providerImageCount) > 0) {
    if (item.finalFrameImageUrl) {
      try {
        const file = await imageUrlToFile(item.finalFrameImageUrl, item.finalFrameImageName || "reused-extension-final-frame");
        replaceInputFiles(extensionForm.elements.finalFrameImage, [file]);
        showExtensionFinalFrame(file, item.finalFrameImageName || "保存済みの最終フレーム");
      } catch (error) {
        $("#extension-error").textContent = error.message;
      }
    } else {
      $("#extension-error").textContent = "この履歴は保存対応前に作られたため、最終フレーム画像だけ選び直してください。";
    }
  }
  updateExtensionBudgetNote();
}

async function reuseGenerationSettings(item) {
  let targetCharacter = characters.find(character => character.id === item.characterId);
  if (!targetCharacter && item.characterId) {
    const hiddenCharacter = await api(`/api/characters/${encodeURIComponent(item.characterId)}`);
    if (!hiddenCharacter.error) targetCharacter = hiddenCharacter;
  }
  if (!targetCharacter) {
    alert("この履歴のキャラクターは削除されているため、設定を再利用できません。");
    return;
  }
  const provider = providerSpecs.find(candidate => candidate.id === item.provider);
  const modelIsAvailable = provider?.configured && provider.models.some(model => model.id === item.model && model.modes.includes(item.mode));
  if (!modelIsAvailable) {
    alert(providerLabel(item.provider) + "のこのモデルは現在利用できないため、設定を再利用できません。");
    return;
  }

  savePromptDraft({ silent: true });
  selected = targetCharacter;
  generationForm.elements.mode.value = item.mode;
  selectedProviderIds.clear();
  selectedProviderIds.add(item.provider);
  selectedModels.set(item.provider, item.model);
  clearCustomStartImage();
  activeComposition = null;
  clearCustomEndImage();
  selectedEndImageNames.delete(targetCharacter.id);
  referenceUploadFiles = [];
  referenceImagesInput.value = "";
  selectedReferenceImageNames.delete(targetCharacter.id);
  if (item.sourceImageName && targetCharacter.images.some(image => image.name === item.sourceImageName)) {
    if (item.mode === "reference-to-video") selectedReferenceImageNames.set(targetCharacter.id, new Set([item.sourceImageName]));
    else selectedImageNames.set(targetCharacter.id, item.sourceImageName);
  }
  if (item.endImageSource === "registered" && item.endImageName && targetCharacter.images.some(image => image.name === item.endImageName)) {
    selectedEndImageNames.set(targetCharacter.id, item.endImageName);
  }
  if (item.compositionId) activeComposition = imageCompositions.find(record => record.id === item.compositionId) || null;

  const warnings = [];
  if (item.startImageSource === "upload") {
    if (item.startImageUrl) {
      try {
        const file = await imageUrlToFile(item.startImageUrl, "reused-start-frame");
        replaceInputFiles(startImageInput, [file]);
        promptIdeaStartFrameFile = file;
        startImageName.textContent = file.name;
        showCustomStartImage(file);
        renderPromptIdeaStartFrame();
      } catch (error) {
        warnings.push(error.message);
      }
    } else {
      warnings.push("この履歴は変更前に作られたため、開始フレームのアップロード画像を選び直してください。");
    }
  }
  if (item.mode === "start-end-to-video" && item.endImageSource === "upload") {
    if (item.endImageUrl) {
      try {
        const file = await imageUrlToFile(item.endImageUrl, "reused-end-frame");
        replaceInputFiles(endImageInput, [file]);
        endImageName.textContent = file.name;
        showCustomEndImage(file);
      } catch (error) {
        warnings.push(error.message);
      }
    } else {
      warnings.push("この履歴は変更前に作られたため、終了フレームのアップロード画像を選び直してください。");
    }
  }
  if (item.mode === "digital-human") warnings.push("音声ファイルは保存されないため、選び直してください。");

  reconcileProviderSelection();
  renderProviderPicker();
  refreshSharedOptions();
  setReusableSelectValue(generationForm.elements.duration, item.duration);
  setReusableSelectValue(generationForm.elements.resolution, item.resolution);
  setReusableSelectValue(generationForm.elements.aspectRatio, item.aspectRatio);
  generationForm.elements.audio.checked = Boolean(item.audio);
  generationForm.elements.offPeak.checked = Boolean(item.offPeak);
  renderCharacters();
  renderCreator();
  generationForm.elements.prompt.value = item.userPrompt ?? item.prompt ?? "";
  updateModeUi();
  refreshSharedOptions();
  document.querySelector("#generation-error").textContent = warnings.length
    ? "設定を再利用しました。" + warnings.join(" ")
    : "開始・終了画像を含む設定を再利用しました。内容を確認してから動画を生成してください。";
  document.querySelector("#creator").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setReusableSelectValue(select, value) {
  const expected = String(value ?? "");
  if ([...select.options].some(option => option.value === expected)) select.value = expected;
}

function openExtensionDialog(item, provider) {
  extensionParent = item;
  extensionProvider = provider;
  extensionForm.reset();
  clearExtensionFinalFrame();
  $("#extension-error").textContent = "";
  $("#extension-provider-label").textContent = `${provider.name.toUpperCase()} VIDEO EXTENSION`;
  $("#extension-dialog-title").textContent = `${provider.name}で続きを生成`;
  const specification = provider.extension;
  const durations = specification.maxOutputDuration
    ? specification.durations.filter(value => Number(item.duration) + value <= specification.maxOutputDuration)
    : specification.durations;
  const durationText = durations.length === 1
    ? `${durations[0]}秒`
    : `${durations[0]}〜${durations.at(-1)}秒`;
  $("#extension-source-summary").textContent = `${item.characterName}の${item.duration}秒動画に、${durationText}の続きを追加します。`;
  $("#extension-provider-note").textContent = specification.note || "";
  $("#extension-final-frame-field").hidden = !specification.supportsFinalFrame;
  replaceOptions(extensionForm.elements.model, specification.models.map(model => model.id), id => {
    return specification.models.find(model => model.id === id)?.label || id;
  }, specification.models.some(model => model.id === item.model)
    ? item.model
    : specification.models.find(model => model.default)?.id || specification.models[0]?.id);
  replaceOptions(extensionForm.elements.duration, durations, value => `${value}秒`, durations.includes(5) ? 5 : durations[0]);
  replaceOptions(extensionForm.elements.resolution, specification.resolutions, resolutionLabel,
    specification.resolutions.includes(item.resolution) ? item.resolution : "720p");
  $("#extend-submit-button").textContent = `${provider.name}で続きを生成`;
  updateExtensionBudgetNote();
  extensionDialog.showModal();
}

function providerCanExtendItem(provider, item) {
  const specification = provider?.extension;
  if (!provider?.configured || !specification) return false;
  if (specification.sourceModels?.length && !specification.sourceModels.includes(item.model)) return false;
  if (specification.sourceResolutions?.length && !specification.sourceResolutions.includes(item.resolution)) return false;
  if (specification.sourceAspectRatios?.length && !specification.sourceAspectRatios.includes(item.aspectRatio)) return false;
  if (specification.maxSourceDuration && Number(item.duration) > specification.maxSourceDuration) return false;
  if (specification.maxOutputDuration && Number(item.duration) >= specification.maxOutputDuration) return false;
  if (specification.maxExtensions && (Number(item.extensionDepth) || 0) >= specification.maxExtensions) return false;
  return true;
}

extensionForm.onchange = updateExtensionBudgetNote;

function updateExtensionBudgetNote() {
  const note = $("#extension-budget-note");
  const button = $("#extend-submit-button");
  if (!extensionParent || !extensionProvider) {
    note.textContent = "";
    note.classList.remove("blocked");
    if (extensionDialog.open) button.disabled = false;
    return;
  }
  const cost = estimateExtensionCost(
    extensionProvider.id,
    extensionForm.elements.model.value,
    Number(extensionForm.elements.duration.value || 0),
    extensionForm.elements.resolution.value || "720p"
  );
  const reason = providerBudgetBlockReason(extensionProvider.id, cost);
  const limitState = costStatus?.providers?.[extensionProvider.id]?.settings?.enabled
    ? "利用上限へ加算されます"
    : "上限停止はOFFです";
  note.textContent = reason
    ? `送信停止: ${reason}`
    : `${extensionProvider.name}延長の概算 ${money(cost)}。${limitState}。`;
  note.classList.toggle("blocked", Boolean(reason));
  button.disabled = Boolean(reason);
}

function estimateExtensionCost(providerId, model, duration, resolution) {
  if (providerId === "runway") return duration * 0.12;
  if (providerId === "veo") {
    const rate = model === "veo-3.1-generate-preview" ? 0.40 : 0.10;
    return duration * rate;
  }
  if (providerId === "seedance") {
    const outputDuration = Number(extensionParent?.duration || 0) + duration;
    return outputDuration * (resolution === "480p" ? 0.04 : 0.08);
  }
  if (providerId === "vidu") {
    const prices = model === "viduq2-pro"
      ? { "540p": [0.075, 0.025], "720p": [0.15, 0.05], "1080p": [0.30, 0.075] }
      : { "540p": [0.05, 0.01], "720p": [0.075, 0.025], "1080p": [0.20, 0.05] };
    const [start, additional] = prices[resolution] || [0, 0];
    return start + Math.max(0, duration - 1) * additional;
  }
  return 0;
}

extensionForm.onsubmit = async event => {
  event.preventDefault();
  if (!extensionParent) return;
  const data = new FormData(extensionForm);
  let finalFrameFile = extensionForm.elements.finalFrameImage.files[0];
  if (finalFrameFile) try {
    finalFrameFile = await optimizeImageFile(finalFrameFile);
    replaceInputFiles(extensionForm.elements.finalFrameImage, [finalFrameFile]);
    showExtensionFinalFrame(finalFrameFile, extensionFinalFrameOriginalName || finalFrameFile.name);
  } catch (error) {
    $("#extension-error").textContent = error.message;
    return;
  }
  const button = $("#extend-submit-button");
  button.disabled = true;
  button.textContent = `${extensionProvider?.name || "生成サービス"}へ送信中…`;
  $("#extension-error").textContent = "";
  const result = await api(`/api/generations/${encodeURIComponent(extensionParent.id)}/extend`, {
    method: "POST",
    body: {
      prompt: data.get("prompt"),
      model: data.get("model"),
      duration: Number(data.get("duration")),
      resolution: data.get("resolution"),
      finalFrameImage: finalFrameFile ? await toDataUrl(finalFrameFile) : null,
      finalFrameImageName: finalFrameFile ? extensionFinalFrameOriginalName || finalFrameFile.name : null
    }
  });
  await loadCostStatus();
  button.textContent = `${extensionProvider?.name || ""}で続きを生成`;
  if (result.error) {
    $("#extension-error").textContent = result.error;
    updateExtensionBudgetNote();
    return;
  }
  extensionDialog.close();
  extensionParent = null;
  extensionProvider = null;
  await loadHistory();
  startPolling();
};

function updateHistoryDeleteControls() {
  const count = selectedHistoryIds.size;
  const selectedItems = historyItems.filter(item => selectedHistoryIds.has(item.id));
  const canConcat = count >= 2 && count <= 10 && selectedItems.length === count
    && selectedItems.every(item => item.state === "success" && item.localUrl);
  const canDownload = count >= 1 && count <= 20 && selectedItems.length === count
    && selectedItems.every(item => item.state === "success" && item.localUrl);
  $("#history-selection-count").textContent = `${count}件選択`;
  $("#delete-selected-history").disabled = count === 0;
  $("#concat-selected-history").disabled = !canConcat;
  $("#download-selected-history").disabled = !canDownload;
}

function refreshHistorySelectionLabels() {
  const orderedIds = [...selectedHistoryIds];
  for (const card of document.querySelectorAll(".history-card")) {
    const label = card.querySelector(".history-selection-label");
    if (!label || !card.dataset.generationId) continue;
    const index = orderedIds.indexOf(card.dataset.generationId);
    label.textContent = index < 0 ? "選択" : `結合 ${index + 1}`;
  }
}

$("#concat-selected-history").onclick = async () => {
  const ids = [...selectedHistoryIds];
  if (ids.length < 2 || ids.length > 10) return;
  const button = $("#concat-selected-history");
  button.disabled = true;
  button.textContent = "結合中…";
  const result = await api("/api/generations/concat", { method: "POST", body: { ids } });
  button.textContent = "選択した動画を結合";
  if (result.error) {
    alert(result.error);
    updateHistoryDeleteControls();
    return;
  }
  selectedHistoryIds.clear();
  await loadHistory();
};

$("#download-selected-history").onclick = async () => {
  const ids = [...selectedHistoryIds];
  if (!ids.length) return;
  const button = $("#download-selected-history");
  button.disabled = true;
  button.textContent = "ZIPを準備中…";
  try {
    const response = await fetch("/api/generations/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      alert(result.error || "ZIPファイルを作成できませんでした。");
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "shortvideo-videos.zip";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    alert("ZIPファイルをダウンロードできませんでした。");
  } finally {
    button.textContent = "選択した動画をダウンロード";
    updateHistoryDeleteControls();
  }
};

$("#delete-selected-history").onclick = async () => {
  const ids = [...selectedHistoryIds];
  if (!ids.length) return;
  if (!confirm(`選択した${ids.length}件の生成履歴と保存済み動画を完全に削除しますか？`)) return;
  const button = $("#delete-selected-history");
  button.disabled = true;
  button.textContent = "削除中…";
  const result = await api("/api/generations", { method: "DELETE", body: { ids } });
  button.textContent = "選択した履歴を削除";
  if (result.error) {
    alert(result.error);
    updateHistoryDeleteControls();
    return;
  }
  for (const id of result.deletedIds || []) selectedHistoryIds.delete(id);
  for (const id of result.deletedIds || []) loopingHistoryIds.delete(id);
  await loadHistory();
};

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const items = await api("/api/generations");
    const pending = items.filter(item => ["created", "queueing", "processing"].includes(item.state));
    if (!pending.length) {
      clearInterval(pollTimer);
      return loadHistory();
    }
    await Promise.all(pending.slice(0, 8).map(item => api(`/api/generations/${encodeURIComponent(item.id)}`)));
    await loadHistory();
    await loadCostStatus();
  }, 6000);
}

const generationDetailDialog = document.querySelector("#generation-detail-dialog");
const generationDetailPrompt = document.querySelector("#generation-detail-prompt");
const generationDetailSentPromptSection = document.querySelector("#generation-detail-sent-prompt-section");
const generationDetailSentPrompt = document.querySelector("#generation-detail-sent-prompt");
const generationDetailImages = document.querySelector("#generation-detail-images");
const generationDetailSettings = document.querySelector("#generation-detail-settings");

document.querySelector("#close-generation-detail-dialog").onclick = () => generationDetailDialog.close();
generationDetailDialog.onclick = event => {
  if (event.target === generationDetailDialog) generationDetailDialog.close();
};

function openGenerationDetails(item) {
  document.querySelector("#generation-detail-title").textContent = historyTitles.get(item.id) || "生成設定";
  const displayedPrompt = item.userPrompt ?? item.prompt ?? "続きの指示なし";
  generationDetailPrompt.textContent = displayedPrompt;
  const sentPromptIsDifferent = Boolean(item.prompt && item.prompt !== displayedPrompt);
  generationDetailSentPromptSection.hidden = !sentPromptIsDifferent;
  generationDetailSentPrompt.textContent = sentPromptIsDifferent ? item.prompt : "";

  const inputImages = [];
  const startUrl = item.startImageUrl || item.sourceImageUrl;
  if (startUrl) inputImages.push({ label: item.mode === "reference-to-video" ? "参照画像" : "開始フレーム", url: startUrl });
  if (item.endImageUrl) inputImages.push({ label: "終了フレーム", url: item.endImageUrl });
  if (item.finalFrameImageUrl) inputImages.push({ label: "延長時の最終フレーム", url: item.finalFrameImageUrl });
  generationDetailImages.replaceChildren(...inputImages.map(input => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const caption = document.createElement("figcaption");
    image.src = input.url;
    image.alt = input.label;
    caption.textContent = input.label;
    figure.append(image, caption);
    return figure;
  }));
  generationDetailImages.hidden = !inputImages.length;

  const recordedCost = item.actualCost ?? item.estimatedCost;
  const rows = [
    ["生成サービス", providerLabel(item.provider || "vidu")],
    ["生成方式", modeLabel(item.mode)],
    ["モデル", item.model || "—"],
    ["長さ", Number(item.duration) ? String(item.duration) + "秒" : "—"],
    ["解像度", item.resolution || "—"],
    ["画面比率", item.aspectRatio || "—"],
    ["音声・効果音", item.audio ? "あり" : "なし"],
    ["オフピーク", item.offPeak ? "使用" : "不使用"],
    ["開始フレーム", imageSourceLabel(item.startImageSource)],
    ["終了フレーム", imageSourceLabel(item.endImageSource)],
    ["状態", stateLabel(item.state)],
    ["費用", recordedCost === null || recordedCost === undefined ? "—" : (item.actualCost === null || item.actualCost === undefined ? "概算 " : "実額 ") + money(Number(recordedCost))],
    ["素材", item.characterName || "—"],
    ["生成日時", new Date(item.createdAt).toLocaleString("ja-JP")],
    ["履歴ID", item.id || "—"],
    ["APIタスクID", item.providerTaskId || "—"]
  ];
  generationDetailSettings.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    return row;
  }));
  generationDetailDialog.showModal();
}

function imageSourceLabel(source) {
  if (source === "upload") return "別画像アップロード";
  if (source === "registered") return "登録画像";
  if (source === "composition") return "Seedream合成画像";
  return "—";
}

const videoDialog = $("#video-dialog");
const expandedVideo = $("#expanded-video");
const expandedVideoLoop = $("#expanded-video-loop");
const expandedVideoTitle = $("#expanded-video-title");
const expandedVideoMeta = $("#expanded-video-meta");

function openVideo(url, generationId) {
  const looping = loopingHistoryIds.has(generationId);
  const item = historyItems.find(candidate => candidate.id === generationId);
  videoDialog.dataset.generationId = generationId;
  expandedVideoTitle.textContent = item ? (historyTitles.get(item.id) || "動画生成") : "動画を拡大表示";
  expandedVideoMeta.textContent = item
    ? `${providerLabel(item.provider || "vidu")} / ${modeLabel(item.mode)} / ${item.model} / ${item.aspectRatio || "9:16"} / ${item.resolution}`
    : "";
  expandedVideo.src = url;
  expandedVideo.loop = looping;
  expandedVideoLoop.checked = looping;
  videoDialog.showModal();
  expandedVideo.play().catch(() => {});
}

expandedVideoLoop.onchange = () => {
  const generationId = videoDialog.dataset.generationId;
  if (!generationId) return;
  setVideoLooping(generationId, expandedVideoLoop.checked);
  expandedVideo.loop = expandedVideoLoop.checked;
  const card = [...document.querySelectorAll(".history-card")]
    .find(candidate => candidate.dataset.generationId === generationId);
  const inlineVideo = card?.querySelector(".video-thumbnail video");
  const inlineCheckbox = card?.querySelector(".loop-video-toggle input");
  if (inlineVideo) inlineVideo.loop = expandedVideoLoop.checked;
  if (inlineCheckbox) inlineCheckbox.checked = expandedVideoLoop.checked;
};

function setVideoLooping(generationId, looping) {
  if (looping) loopingHistoryIds.add(generationId);
  else loopingHistoryIds.delete(generationId);
  if (videoDialog.dataset.generationId === generationId) {
    expandedVideo.loop = looping;
    expandedVideoLoop.checked = looping;
  }
}

function closeVideo() {
  expandedVideo.pause();
  expandedVideo.loop = false;
  expandedVideoLoop.checked = false;
  expandedVideo.removeAttribute("src");
  expandedVideo.load();
  expandedVideoTitle.textContent = "";
  expandedVideoMeta.textContent = "";
  delete videoDialog.dataset.generationId;
  videoDialog.close();
}

$("#close-video-dialog").onclick = closeVideo;
videoDialog.onclick = event => {
  if (event.target === videoDialog) closeVideo();
};
videoDialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeVideo();
});

async function api(url, options = {}) {
  const init = { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
  if (options.body && typeof options.body !== "string") init.body = JSON.stringify(options.body);
  try {
    const response = await fetch(url, init);
    return await response.json();
  } catch {
    return { error: "サーバーへ接続できませんでした。" };
  }
}

function getMode() {
  return generationForm.elements.mode?.value || "image-to-video";
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageUrlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("登録画像を読み込めませんでした。もう一度選択してください。");
  return toDataUrl(await response.blob());
}

async function imageUrlToFile(url, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("保存済みの入力画像を読み込めませんでした。");
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? ".png" : blob.type === "image/webp" ? ".webp" : ".jpg";
  const baseName = String(fallbackName || "input").replace(/\.(?:png|jpe?g|webp)$/i, "");
  return new File([blob], baseName + extension, { type: blob.type || "image/jpeg" });
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl).split(",", 2)[1] || "";
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

function isSupportedImage(file) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file?.type);
}

function replaceInputFiles(input, files) {
  const transfer = new DataTransfer();
  files.forEach(file => transfer.items.add(file));
  input.files = transfer.files;
}

async function optimizeImageFile(file, maxBytes = 8 * 1024 * 1024) {
  if (file.size <= maxBytes) return file;
  if (!isSupportedImage(file)) throw new Error("PNG、JPEG、WebP形式の画像を選択してください。");

  const source = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const webpName = `${file.name.replace(/\.[^.]+$/, "") || "image"}.webp`;
  try {
    for (let scale = 1; scale >= 0.35; scale *= 0.82) {
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.76, 0.68, 0.6, 0.52]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.size <= maxBytes) {
          return new File([blob], webpName, { type: "image/webp", lastModified: file.lastModified });
        }
      }
    }
  } finally {
    source.close();
  }
  throw new Error("画像を十分に圧縮できませんでした。より小さい画像を選択してください。");
}

function mediaDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const finish = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onloadedmetadata = finish;
    audio.onerror = finish;
    audio.src = objectUrl;
  });
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value, fractionDigits = 2) {
  return `${dollars(value, fractionDigits)}（約${yen(value)}）`;
}

function dollars(value, fractionDigits = 2) {
  return `$${Number(value || 0).toFixed(fractionDigits)}`;
}

function yen(value) {
  return `¥${Math.round(Number(value || 0) * 166).toLocaleString("ja-JP")}`;
}

function stateLabel(state) {
  return ({ created: "受付済み", queueing: "待機中", processing: "生成中", success: "完成", failed: "失敗", cancelled: "キャンセル済み" })[state] || state;
}

function modeLabel(mode) {
  return ({ "image-to-video": "Image to Video", "reference-to-video": "Reference to Video", "text-to-video": "Text to Video", "start-end-to-video": "Start End to Video", "digital-human": "Lip Sync", "video-extension": "Video Extension", "video-concat": "動画結合" })[mode] || "旧形式";
}

function providerLabel(id) {
  return providerSpecs.find(provider => provider.id === id)?.name || ({ vidu: "Vidu", runway: "Runway", seedance: "Seedance", seedream: "Seedream", veo: "Veo", omni: "Gemini Omni", hedra: "Hedra", local: "ローカル" })[id] || id;
}

function ratioLabel(value) {
  return ({ "16:9": "YouTube・映画向け 16:9", "1:1": "正方形 1:1", "9:16": "TikTok・Shorts向け 9:16" })[value] || value;
}

function resolutionLabel(value) {
  return ({ "480p": "480p（低コスト）", "540p": "540p（低コスト）", "720p": "720p（標準）", "1080p": "1080p（高画質）", "4k": "4K（最高画質）" })[value] || value;
}

const health = await api("/api/health");
serverReady = health.capabilities?.multiProvider === true && health.capabilities?.comparisonGeneration === true;
imageCompositionConfigured = health.imageComposition?.configured === true;
promptIdeasConfigured = health.promptIdeas?.configured === true;
providerSpecs = Array.isArray(health.providers) ? health.providers : [];
const defaultProvider = providerSpecs.find(provider => provider.id === "vidu" && provider.configured)
  || providerSpecs.find(provider => provider.configured);
if (defaultProvider) selectedProviderIds.add(defaultProvider.id);
for (const provider of providerSpecs) {
  const defaultModel = provider.models.find(model => model.default) || provider.models[0];
  if (defaultModel) selectedModels.set(provider.id, defaultModel.id);
}
const configuredCount = providerSpecs.filter(provider => provider.configured).length;
$("#api-status").textContent = !serverReady
  ? "サーバー再起動が必要"
  : configuredCount
    ? `${configuredCount}/${providerSpecs.length} API 設定済み`
    : "動画API 未設定";
$("#api-status").classList.toggle("ready", serverReady && configuredCount > 0);
reconcileProviderSelection();
renderProviderPicker();
refreshSharedOptions();
await loadCostStatus();
await loadCharacters();
await loadImageCompositions();
updateCompositionGenerateState();
updatePromptIdeaState();
updateModeUi();
await loadHistory();
startPolling();
