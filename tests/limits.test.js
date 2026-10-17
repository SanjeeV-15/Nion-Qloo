import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCostUsd, createVisitorLimiter, createBudget, createGate, numberFromEnv, cleanVisitorId,
} from "../server/limits.js";

// A clock the tests can move.
function clock(start = 1_000_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("an answer's cost is worked out from its tokens and searches", () => {
  // The real 17-question check used 200,401 tokens in and 6,541 out and one search: about 3.3 cents.
  const cost = estimateCostUsd("claude-haiku-5-5", { inputTokens: 200_401, outputTokens: 6_541, searches: 1 });
  assert.ok(cost > 0.03 && cost < 0.035, `expected about $0.033, got ${cost}`);
  assert.equal(estimateCostUsd("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 0, searches: 0 }), 0.1);
});

test("a model that is not listed is priced like the dearest one, to be safe", () => {
  const unknown = estimateCostUsd("some-new-model", { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(unknown, estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 }));
  assert.equal(estimateCostUsd("claude-haiku-5-5", undefined), 0);
  assert.equal(estimateCostUsd("claude-haiku-5-5", { inputTokens: "x", outputTokens: NaN }), 0);
});

test("a visitor can ask a few times a minute, then has to wait", () => {
  const c = clock();
  const limiter = createVisitorLimiter({ perMinute: 3, perHour: 100, now: c.now });
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  c.advance(20_000);
  const blocked = limiter.take("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 40, "the first of the three was 20 seconds ago, so 40 more");
  c.advance(41_000);
  assert.equal(limiter.take("a").ok, true, "a minute after the first, there is room again");
});

test("an hourly limit holds even when each minute is quiet", () => {
  const c = clock();
  const limiter = createVisitorLimiter({ perMinute: 100, perHour: 5, now: c.now });
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.take("a").ok, true);
    c.advance(10 * 60_000);
  }
  // Five questions in the last 50 minutes: the sixth waits for the first to be an hour old.
  const blocked = limiter.take("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 600);
});

test("one visitor's limit does not affect another's", () => {
  const limiter = createVisitorLimiter({ perMinute: 1, perHour: 10, now: clock().now });
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, false);
  assert.equal(limiter.take("b").ok, true);
});

test("a refused question does not count against the visitor", () => {
  const c = clock();
  const limiter = createVisitorLimiter({ perMinute: 2, perHour: 10, now: c.now });
  limiter.take("a");
  limiter.take("a");
  for (let i = 0; i < 20; i++) limiter.take("a"); // hammering while blocked
  c.advance(61_000);
  assert.equal(limiter.take("a").ok, true, "waiting a minute is enough; hammering did not extend it");
});

test("quiet visitors are forgotten, and the list can never grow without limit", () => {
  const c = clock();
  const limiter = createVisitorLimiter({ perMinute: 5, perHour: 50, maxVisitors: 3, now: c.now });
  for (const id of ["a", "b", "c", "d", "e"]) limiter.take(id);
  assert.equal(limiter.size(), 3, "the oldest were dropped");
  c.advance(3_700_000);
  limiter.sweep();
  assert.equal(limiter.size(), 0, "an hour of quiet clears everyone");
});

test("the daily budget stops spending and starts again the next day", () => {
  const c = clock(Date.UTC(2026, 9, 20, 12, 0, 0));
  const budget = createBudget({ dailyUsd: 1, totalUsd: 100, now: c.now });
  assert.equal(budget.check().ok, true);
  budget.add(0.6);
  assert.equal(budget.check().ok, true);
  budget.add(0.5);
  assert.deepEqual(budget.check(), { ok: false, reason: "daily" });

  c.advance(13 * 3_600_000); // past midnight UTC
  assert.equal(budget.check().ok, true, "a new day");
  assert.ok(Math.abs(budget.snapshot().total - 1.1) < 1e-9, "the total keeps counting");
});

test("the total budget does not reset with the day", () => {
  const c = clock(Date.UTC(2026, 9, 20, 12, 0, 0));
  const budget = createBudget({ dailyUsd: 5, totalUsd: 2, now: c.now });
  budget.add(2.5);
  assert.deepEqual(budget.check(), { ok: false, reason: "total" });
  c.advance(48 * 3_600_000);
  assert.deepEqual(budget.check(), { ok: false, reason: "total" });
});

test("nonsense amounts add nothing", () => {
  const budget = createBudget({ dailyUsd: 1, totalUsd: 1, now: clock().now });
  for (const amount of [NaN, -5, undefined, "3", Infinity * 0]) budget.add(amount);
  assert.equal(budget.snapshot().total, 0);
});

test("only so many questions are answered at once", () => {
  const gate = createGate(2);
  assert.equal(gate.enter(), true);
  assert.equal(gate.enter(), true);
  assert.equal(gate.enter(), false);
  gate.leave();
  assert.equal(gate.enter(), true);
  gate.leave();
  gate.leave();
  gate.leave(); // too many leaves never goes below zero
  assert.equal(gate.count(), 0);
});

test("settings are read as numbers, with a sensible fallback", () => {
  assert.equal(numberFromEnv("2.5", 1), 2.5);
  assert.equal(numberFromEnv("0", 1), 0);
  assert.equal(numberFromEnv(undefined, 1), 1);
  assert.equal(numberFromEnv("", 1), 1);
  assert.equal(numberFromEnv("lots", 1), 1);
  assert.equal(numberFromEnv("-3", 1), 1);
});

test("a visitor id must look like the one the page makes", () => {
  assert.equal(cleanVisitorId("3f2b8c1e-5d6a-4e7b-9c0d-1a2b3c4d5e6f"), "3f2b8c1e-5d6a-4e7b-9c0d-1a2b3c4d5e6f");
  assert.equal(cleanVisitorId("3F2B8C1E-5D6A-4E7B-9C0D-1A2B3C4D5E6F"), "3f2b8c1e-5d6a-4e7b-9c0d-1a2b3c4d5e6f");
  for (const bad of ["", "abc", "x".repeat(36), "../../etc/passwd", undefined, 42, null]) assert.equal(cleanVisitorId(bad), null);
});
