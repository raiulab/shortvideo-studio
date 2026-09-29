import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProviderBudgetAllows,
  normalizeProviderBudgetSettings,
  summarizeProviderCosts,
  summarizeProviderMonthlyHistory,
  updateProviderBudgetSetting
} from "../lib/provider-budget.mjs";

const now = new Date("2026-07-25T03:00:00Z");

test("全サービスの費用を日別・月別・総額で集計する", () => {
  const summary = summarizeProviderCosts([
    { provider: "vidu", state: "success", actualCost: 0.5, estimatedCost: 0.7, createdAt: "2026-07-25T01:00:00Z" },
    { provider: "veo", state: "processing", estimatedCost: 0.8, createdAt: "2026-07-25T02:00:00Z" },
    { provider: "runway", state: "failed", estimatedCost: 0.6, createdAt: "2026-07-25T02:30:00Z" },
    { provider: "seedance", state: "success", actualCost: 0.3, createdAt: "2026-07-24T14:59:59Z" }
  ], normalizeProviderBudgetSettings({}), now);

  assert.equal(summary.providers.vidu.daily.spent, 0.5);
  assert.equal(summary.providers.veo.daily.reserved, 0.8);
  assert.equal(summary.providers.runway.daily.committed, 0);
  assert.equal(summary.providers.seedance.daily.committed, 0);
  assert.equal(summary.totals.daily.committed, 1.3);
  assert.equal(summary.totals.monthly.committed, 1.6);
});

test("過去月を含むサービス別費用を月単位で集計する", () => {
  const history = summarizeProviderMonthlyHistory([
    { provider: "vidu", state: "success", actualCost: 1.2, createdAt: "2026-06-30T14:59:59Z" },
    { provider: "veo", state: "success", actualCost: 0.8, createdAt: "2026-07-01T00:00:00Z" },
    { provider: "seedance", state: "processing", estimatedCost: 0.3, createdAt: "2026-06-15T00:00:00Z" },
    { provider: "runway", state: "failed", estimatedCost: 9, createdAt: "2026-06-15T00:00:00Z" }
  ], normalizeProviderBudgetSettings({}));

  assert.deepEqual(history.map(item => item.monthKey), ["2026-07", "2026-06"]);
  assert.equal(history[0].providers.veo.spent, 0.8);
  assert.equal(history[1].providers.vidu.spent, 1.2);
  assert.equal(history[1].providers.seedance.reserved, 0.3);
  assert.equal(history[1].total.committed, 1.5);
});

test("上限停止はサービスごとにON・OFFできる", () => {
  const defaults = normalizeProviderBudgetSettings({});
  const summary = summarizeProviderCosts([], defaults, now);
  assert.equal(summary.providers.seedance.settings.enabled, true);
  assert.equal(summary.providers.seedream.settings.enabled, true);
  assert.equal(summary.providers.veo.settings.enabled, false);
  assert.equal(assertProviderBudgetAllows("veo", "Veo", 999, summary), true);
  assert.throws(
    () => assertProviderBudgetAllows("seedance", "Seedance", 1.01, summary),
    /1回あたり上限/
  );

  const enabled = updateProviderBudgetSetting(defaults, "veo", {
    enabled: true,
    perRequest: 1,
    daily: 3,
    monthly: 20
  });
  const enabledSummary = summarizeProviderCosts([], enabled, now);
  assert.throws(
    () => assertProviderBudgetAllows("veo", "Veo", 1.01, enabledSummary),
    /Veo.*1回あたり上限/
  );
});

test("設定値は1回・1日・月額の順序を検証する", () => {
  const settings = normalizeProviderBudgetSettings({});
  assert.throws(
    () => updateProviderBudgetSetting(settings, "vidu", {
      enabled: true,
      perRequest: 4,
      daily: 3,
      monthly: 20
    }),
    /1日上限/
  );
  assert.throws(
    () => updateProviderBudgetSetting(settings, "veo", {
      enabled: true,
      perRequest: 1,
      daily: 21,
      monthly: 20
    }),
    /月額上限/
  );
});
