// Guards for a public demo. Anyone with the link can ask Nion questions, and every question
// costs real money (Claude) and uses a limited allowance (Qloo). These keep one visitor, a
// script, or a crowd from using it all up, and let Nion say so politely when it is "resting".
//
// Nothing here is stored: it all lives in memory and starts fresh when the server restarts.
// The prepaid balance on the Claude account is the final backstop; these make sure it is
// rarely, if ever, reached.
//
// Everything takes the clock as a parameter, so the tests can run a whole day in a moment.

// What a million tokens cost, in US dollars, as listed in October 2026 (check Anthropic's
// pricing page). A model that is not listed is priced like the dearest one, so the guard errs
// on the side of caution.
export const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
const SEARCH_USD = 0.01; // each web search

/** About what one answer cost, from the tokens and searches it used. An estimate, not a bill. */
export function estimateCostUsd(model, usage = {}) {
  const price = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  const tokens = (Number(usage.inputTokens) || 0) * price.input + (Number(usage.outputTokens) || 0) * price.output;
  return tokens / 1_000_000 + (Number(usage.searches) || 0) * SEARCH_USD;
}

/**
 * Limits how often one visitor can ask: at most `perMinute` in any minute and `perHour` in any
 * hour. `take(key)` records a question and says whether it is allowed.
 */
export function createVisitorLimiter({ perMinute = 6, perHour = 40, maxVisitors = 10_000, now = Date.now } = {}) {
  const asked = new Map(); // visitor -> times (ms) of recent questions, oldest first

  function prune(times, at) {
    while (times.length && at - times[0] >= 3_600_000) times.shift();
  }

  return {
    take(key) {
      const at = now();
      const times = asked.get(key) ?? [];
      prune(times, at);

      const lastMinute = times.filter((t) => at - t < 60_000);
      if (lastMinute.length >= perMinute) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((lastMinute[0] + 60_000 - at) / 1000)) };
      }
      if (times.length >= perHour) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((times[0] + 3_600_000 - at) / 1000)) };
      }

      times.push(at);
      if (!asked.has(key) && asked.size >= maxVisitors) asked.delete(asked.keys().next().value); // never grow without limit
      asked.set(key, times);
      return { ok: true };
    },
    /** Forget visitors who have been quiet for an hour. Run now and then. */
    sweep() {
      const at = now();
      for (const [key, times] of asked) {
        prune(times, at);
        if (times.length === 0) asked.delete(key);
      }
    },
    size: () => asked.size,
  };
}

/**
 * A spending guard. `dailyUsd` resets at midnight UTC; `totalUsd` is for as long as the server
 * runs. `check()` says whether there is room; `add(usd)` records what an answer cost.
 */
export function createBudget({ dailyUsd = 2, totalUsd = 8, now = Date.now } = {}) {
  const day = () => Math.floor(now() / 86_400_000);
  let today = 0;
  let total = 0;
  let current = day();

  function roll() {
    if (day() !== current) {
      current = day();
      today = 0;
    }
  }

  return {
    check() {
      roll();
      if (total >= totalUsd) return { ok: false, reason: "total" };
      if (today >= dailyUsd) return { ok: false, reason: "daily" };
      return { ok: true };
    },
    add(usd) {
      roll();
      const amount = Number.isFinite(usd) && usd > 0 ? usd : 0;
      today += amount;
      total += amount;
    },
    snapshot() {
      roll();
      return { today, total, dailyUsd, totalUsd };
    },
  };
}

/** Caps how many questions are being answered at once. */
export function createGate(max = 6) {
  let inFlight = 0;
  return {
    enter() {
      if (inFlight >= max) return false;
      inFlight += 1;
      return true;
    },
    leave() {
      inFlight = Math.max(0, inFlight - 1);
    },
    count: () => inFlight,
  };
}

/** A number from a setting such as NION_DAILY_BUDGET_USD, or the default if it is missing or not a sensible number. */
export function numberFromEnv(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A visitor's anonymous id, as the page makes it, or null if it is not one. */
export function cleanVisitorId(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value) ? value.toLowerCase() : null;
}
