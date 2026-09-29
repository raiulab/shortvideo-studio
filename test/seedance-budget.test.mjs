import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSeedanceBudgetAllows,
  normalizeSeedanceBudgetSettings,
  summarizeSeedanceBudget
} from "../lib/seedance-budget.mjs";
import { seedanceProvider } from "../providers/seedance.mjs";

test("Seedance利用上限の初期値と大小関係を検証する", () => {
  assert.deepEqual(normalizeSeedanceBudgetSettings({}), {
    perRequest: 1,
    daily: 3,
    monthly: 20,
    timeZone: "Asia/Tokyo"
  });
  assert.throws(
    () => normalizeSeedanceBudgetSettings({ perRequest: 4, daily: 3, monthly: 20 }),
    /1日上限/
  );
  assert.throws(
    () => normalizeSeedanceBudgetSettings({ perRequest: 1, daily: 21, monthly: 20 }),
    /月額上限/
  );
});

test("成功分と待機中の予約額を日本時間の日・月単位で集計する", () => {
  const entries = [
    { state: "success", estimatedCost: 0.4, actualCost: 0.3, createdAt: "2026-07-25T00:00:00Z" },
    { state: "processing", estimatedCost: 0.5, createdAt: "2026-07-25T02:00:00Z" },
    { state: "failed", estimatedCost: 0.9, createdAt: "2026-07-25T01:00:00Z" },
    { state: "cancelled", estimatedCost: 0.8, createdAt: "2026-07-25T01:30:00Z" },
    { state: "success", estimatedCost: 0.4, createdAt: "2026-07-24T14:59:59Z" }
  ];
  const summary = summarizeSeedanceBudget(
    entries,
    { perRequest: 1, daily: 3, monthly: 20 },
    new Date("2026-07-25T03:00:00Z")
  );
  assert.equal(summary.daily.spent, 0.3);
  assert.equal(summary.daily.reserved, 0.5);
  assert.equal(summary.daily.committed, 0.8);
  assert.equal(summary.monthly.committed, 1.2);
  assert.equal(summary.daily.remaining, 2.2);
});

test("1回・1日・月額のいずれかを超えるSeedance送信を止める", () => {
  const base = summarizeSeedanceBudget([], { perRequest: 1, daily: 3, monthly: 20 });
  assert.equal(assertSeedanceBudgetAllows(1, base), true);
  assert.throws(() => assertSeedanceBudgetAllows(1.01, base), /1回あたり上限/);

  const daily = { ...base, daily: { ...base.daily, committed: 2.5 } };
  assert.equal(assertSeedanceBudgetAllows(0.5, daily), true);
  assert.throws(() => assertSeedanceBudgetAllows(0.51, daily), /1日上限/);

  const monthly = { ...base, monthly: { ...base.monthly, committed: 19.5 } };
  assert.throws(() => assertSeedanceBudgetAllows(0.51, monthly), /月額上限/);
});

test("Seedanceの返却トークンから成功時の実額を計算する", () => {
  assert.equal(seedanceProvider.actualCost({
    model: "seedance-1-5-pro-251215",
    credits: 100000,
    audio: false,
    mode: "image-to-video"
  }), 0.12);
  assert.equal(seedanceProvider.actualCost({
    model: "dreamina-seedance-2-0-mini-260615",
    credits: 100000,
    mode: "video-extension"
  }), 0.21);
});
