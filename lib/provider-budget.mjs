export const providerIds = Object.freeze(["vidu", "runway", "seedance", "seedream", "veo", "omni", "hedra"]);

export const defaultProviderBudgetSettings = Object.freeze({
  timeZone: "Asia/Tokyo",
  providers: {
    vidu: { enabled: false, perRequest: 2, daily: 10, monthly: 50 },
    runway: { enabled: false, perRequest: 2, daily: 10, monthly: 50 },
    seedance: { enabled: true, perRequest: 1, daily: 3, monthly: 20 },
    seedream: { enabled: true, perRequest: 0.5, daily: 3, monthly: 20 },
    veo: { enabled: false, perRequest: 5, daily: 15, monthly: 50 },
    omni: { enabled: false, perRequest: 5, daily: 15, monthly: 50 },
    hedra: { enabled: false, perRequest: 5, daily: 15, monthly: 50 }
  }
});

const pendingStates = new Set(["reserving", "created", "queueing", "processing"]);
const excludedStates = new Set(["failed", "cancelled"]);

export function normalizeProviderBudgetSettings(value = {}) {
  const result = {
    timeZone: defaultProviderBudgetSettings.timeZone,
    providers: {}
  };
  for (const id of providerIds) {
    result.providers[id] = normalizeProviderSetting(
      value.providers?.[id] || value[id] || {},
      defaultProviderBudgetSettings.providers[id],
      id
    );
  }
  return result;
}

export function updateProviderBudgetSetting(settings, providerId, value) {
  if (!providerIds.includes(providerId)) throw budgetError(`未対応の生成サービスです: ${providerId}`, 404);
  const normalized = normalizeProviderBudgetSettings(settings);
  normalized.providers[providerId] = normalizeProviderSetting(
    value,
    normalized.providers[providerId],
    providerId
  );
  return normalized;
}

export function summarizeProviderCosts(entries = [], settings = defaultProviderBudgetSettings, now = new Date()) {
  const normalizedSettings = normalizeProviderBudgetSettings(settings);
  const current = calendarKeys(now, normalizedSettings.timeZone);
  const providers = Object.fromEntries(providerIds.map(id => [id, {
    settings: normalizedSettings.providers[id],
    daily: emptyPeriod(normalizedSettings.providers[id].daily),
    monthly: emptyPeriod(normalizedSettings.providers[id].monthly)
  }]));

  for (const entry of entries) {
    if (!providers[entry.provider] || excludedStates.has(entry.state)) continue;
    const createdAt = new Date(entry.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    const keys = calendarKeys(createdAt, normalizedSettings.timeZone);
    const amount = entryAmount(entry);
    if (amount <= 0) continue;
    const bucket = pendingStates.has(entry.state) ? "reserved" : "spent";
    if (keys.month === current.month) providers[entry.provider].monthly[bucket] += amount;
    if (keys.day === current.day) providers[entry.provider].daily[bucket] += amount;
  }

  const totals = {
    daily: emptyPeriod(null),
    monthly: emptyPeriod(null)
  };
  for (const provider of Object.values(providers)) {
    for (const period of ["daily", "monthly"]) {
      finalizePeriod(provider[period], provider.settings[period]);
      totals[period].spent += provider[period].spent;
      totals[period].reserved += provider[period].reserved;
    }
  }
  for (const period of ["daily", "monthly"]) finalizePeriod(totals[period], null);

  return {
    dayKey: current.day,
    monthKey: current.month,
    timeZone: normalizedSettings.timeZone,
    providers,
    totals
  };
}

export function summarizeProviderMonthlyHistory(entries = [], settings = defaultProviderBudgetSettings) {
  const normalizedSettings = normalizeProviderBudgetSettings(settings);
  const months = new Map();

  for (const entry of entries) {
    if (!providerIds.includes(entry.provider) || excludedStates.has(entry.state)) continue;
    const createdAt = new Date(entry.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    const amount = entryAmount(entry);
    if (amount <= 0) continue;
    const monthKey = calendarKeys(createdAt, normalizedSettings.timeZone).month;
    if (!months.has(monthKey)) {
      months.set(monthKey, {
        monthKey,
        providers: Object.fromEntries(providerIds.map(id => [id, emptyPeriod(null)])),
        total: emptyPeriod(null)
      });
    }
    const summary = months.get(monthKey);
    const bucket = pendingStates.has(entry.state) ? "reserved" : "spent";
    summary.providers[entry.provider][bucket] += amount;
    summary.total[bucket] += amount;
  }

  return [...months.values()]
    .map(summary => {
      Object.values(summary.providers).forEach(period => finalizePeriod(period, null));
      finalizePeriod(summary.total, null);
      return summary;
    })
    .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
}

export function assertProviderBudgetAllows(providerId, providerName, estimatedCost, summary) {
  const provider = summary.providers?.[providerId];
  if (!provider?.settings?.enabled) return true;
  if (estimatedCost === null || estimatedCost === undefined || estimatedCost === "") {
    throw budgetError(`${providerName}の概算料金を計算できませんでした。`);
  }
  const cost = roundMoney(Number(estimatedCost));
  if (!Number.isFinite(cost) || cost < 0) throw budgetError(`${providerName}の概算料金を計算できませんでした。`);
  if (cost > provider.settings.perRequest) {
    throw budgetError(
      `${providerName}の概算${currency(cost)}が、1回あたり上限${currency(provider.settings.perRequest)}を超えます。`
    );
  }
  if (roundMoney(provider.daily.committed + cost) > provider.settings.daily) {
    throw budgetError(
      `${providerName}の本日分が1日上限${currency(provider.settings.daily)}を超えるため、送信を停止しました。`
    );
  }
  if (roundMoney(provider.monthly.committed + cost) > provider.settings.monthly) {
    throw budgetError(
      `${providerName}の今月分が月額上限${currency(provider.settings.monthly)}を超えるため、送信を停止しました。`
    );
  }
  return true;
}

export function entryAmount(entry) {
  const actual = Number(entry.actualCost);
  if (entry.state === "success" && entry.actualCost !== null && entry.actualCost !== undefined
    && Number.isFinite(actual) && actual >= 0) {
    return roundMoney(actual);
  }
  const estimated = Number(entry.estimatedCost);
  return Number.isFinite(estimated) && estimated >= 0 ? roundMoney(estimated) : 0;
}

function normalizeProviderSetting(value, fallback, providerId) {
  const setting = {
    enabled: value.enabled === undefined ? Boolean(fallback.enabled) : Boolean(value.enabled),
    perRequest: normalizeMoney(value.perRequest, fallback.perRequest, `${providerId}の1回あたり上限`),
    daily: normalizeMoney(value.daily, fallback.daily, `${providerId}の1日上限`),
    monthly: normalizeMoney(value.monthly, fallback.monthly, `${providerId}の月額上限`)
  };
  if (setting.perRequest > setting.daily) throw budgetError(`${providerId}の1日上限は、1回あたり上限以上にしてください。`);
  if (setting.daily > setting.monthly) throw budgetError(`${providerId}の月額上限は、1日上限以上にしてください。`);
  return setting;
}

function emptyPeriod(limit) {
  return { spent: 0, reserved: 0, committed: 0, remaining: limit };
}

function finalizePeriod(period, limit) {
  period.spent = roundMoney(period.spent);
  period.reserved = roundMoney(period.reserved);
  period.committed = roundMoney(period.spent + period.reserved);
  period.remaining = limit === null ? null : roundMoney(Math.max(0, limit - period.committed));
}

function calendarKeys(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    month: `${values.year}-${values.month}`
  };
}

function normalizeMoney(value, fallback, label) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0.01 || number > 100000) {
    throw budgetError(`${label}は$0.01（約¥2）〜$100,000（約¥16,600,000）で入力してください。`);
  }
  return roundMoney(number);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function money(value) {
  return Number(value).toFixed(2);
}

function currency(value) {
  return `$${money(value)}（約¥${Math.round(Number(value) * 166).toLocaleString("ja-JP")}）`;
}

function budgetError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
