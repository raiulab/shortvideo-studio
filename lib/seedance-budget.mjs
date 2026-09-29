export const defaultSeedanceBudgetSettings = Object.freeze({
  perRequest: 1,
  daily: 3,
  monthly: 20,
  timeZone: "Asia/Tokyo"
});

const pendingStates = new Set(["reserving", "created", "queueing", "processing"]);
const excludedStates = new Set(["failed", "cancelled"]);

export function normalizeSeedanceBudgetSettings(value = {}) {
  const settings = {
    perRequest: normalizeMoney(value.perRequest, defaultSeedanceBudgetSettings.perRequest, "1回あたり上限"),
    daily: normalizeMoney(value.daily, defaultSeedanceBudgetSettings.daily, "1日上限"),
    monthly: normalizeMoney(value.monthly, defaultSeedanceBudgetSettings.monthly, "月額上限"),
    timeZone: defaultSeedanceBudgetSettings.timeZone
  };
  if (settings.perRequest > settings.daily) {
    throw budgetError("1日上限は、1回あたり上限以上にしてください。");
  }
  if (settings.daily > settings.monthly) {
    throw budgetError("月額上限は、1日上限以上にしてください。");
  }
  return settings;
}

export function summarizeSeedanceBudget(entries = [], settings = defaultSeedanceBudgetSettings, now = new Date()) {
  const normalizedSettings = normalizeSeedanceBudgetSettings(settings);
  const current = calendarKeys(now, normalizedSettings.timeZone);
  const summary = {
    settings: normalizedSettings,
    dayKey: current.day,
    monthKey: current.month,
    daily: { spent: 0, reserved: 0, committed: 0, remaining: normalizedSettings.daily },
    monthly: { spent: 0, reserved: 0, committed: 0, remaining: normalizedSettings.monthly }
  };

  for (const entry of entries) {
    if (excludedStates.has(entry.state)) continue;
    const createdAt = new Date(entry.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    const keys = calendarKeys(createdAt, normalizedSettings.timeZone);
    const amount = entryAmount(entry);
    if (amount <= 0) continue;
    const bucket = pendingStates.has(entry.state) ? "reserved" : "spent";
    if (keys.month === current.month) summary.monthly[bucket] += amount;
    if (keys.day === current.day) summary.daily[bucket] += amount;
  }

  for (const period of ["daily", "monthly"]) {
    const values = summary[period];
    values.spent = roundMoney(values.spent);
    values.reserved = roundMoney(values.reserved);
    values.committed = roundMoney(values.spent + values.reserved);
    values.remaining = roundMoney(Math.max(0, normalizedSettings[period] - values.committed));
  }
  return summary;
}

export function assertSeedanceBudgetAllows(estimatedCost, summary) {
  if (estimatedCost === null || estimatedCost === undefined || estimatedCost === "") {
    throw budgetError("Seedanceの概算料金を計算できませんでした。");
  }
  const cost = roundMoney(Number(estimatedCost));
  if (!Number.isFinite(cost) || cost < 0) throw budgetError("Seedanceの概算料金を計算できませんでした。");
  if (cost > summary.settings.perRequest) {
    throw budgetError(
      `Seedanceの概算${currency(cost)}が、1回あたり上限${currency(summary.settings.perRequest)}を超えます。`
    );
  }
  if (roundMoney(summary.daily.committed + cost) > summary.settings.daily) {
    throw budgetError(
      `Seedanceの本日分が1日上限${currency(summary.settings.daily)}を超えるため、送信を停止しました。`
    );
  }
  if (roundMoney(summary.monthly.committed + cost) > summary.settings.monthly) {
    throw budgetError(
      `Seedanceの今月分が月額上限${currency(summary.settings.monthly)}を超えるため、送信を停止しました。`
    );
  }
  return true;
}

export function entryAmount(entry) {
  const actual = Number(entry.actualCost);
  if (entry.state === "success" && Number.isFinite(actual) && actual >= 0) return roundMoney(actual);
  const estimated = Number(entry.estimatedCost);
  return Number.isFinite(estimated) && estimated >= 0 ? roundMoney(estimated) : 0;
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

function budgetError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
