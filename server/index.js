// The small server. It does two jobs:
//   1. Serves the Nion page (everything in the public/ folder) to your browser.
//   2. Answers POST /api/chat: takes what the person said, asks Claude, and
//      returns Nion's reply. This is the only place your API keys are used.
//
// When it is online for anyone to use, it also protects your credit: limits per visitor, a daily
// and a total spending guard, and a cap on questions at once (see limits.js). When a limit is
// reached it says so politely, and the page has Nion say "I'm resting" out loud.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Stop early with a clear message if the key is missing (instead of failing later).
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nNion can't start: ANTHROPIC_API_KEY is missing.\n" +
      "Open the .env file in this folder and put your Claude API key after ANTHROPIC_API_KEY=\n" +
      "(see .env.example and the README).\n"
  );
  process.exit(1);
}
if (!process.env.QLOO_API_KEY) {
  console.error(
    "\nNion can't start: QLOO_API_KEY is missing.\n" +
      "Open the .env file in this folder and put your Qloo hackathon key after QLOO_API_KEY=\n" +
      "(see .env.example and the README).\n"
  );
  process.exit(1);
}

// Loaded after the key checks so a missing key gives the messages above.
const { createBrain, currentModel } = await import("./brain.js");
const { createQloo } = await import("./qloo.js");
const { resolvePlace, geocodePlace, describePlace, cleanPlacePart } = await import("./place.js");
const { cleanTaste } = await import("./taste.js");
const { classifyFailure } = await import("./failure.js");
const { warmUp } = await import("./warmup.js");
const { estimateCostUsd, createVisitorLimiter, createBudget, createGate, numberFromEnv, cleanVisitorId } = await import("./limits.js");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const claude = new Anthropic();
// Made here (not inside the brain) so the server can see how much of Qloo's monthly allowance is left.
const qloo = createQloo({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL || undefined });
const askNion = createBrain({ client: claude, qloo });

// ---------- protecting your credit when Nion is online ----------
// All of these can be changed with settings (see .env.example). They live in memory and start
// fresh when the server restarts; the prepaid balance on the Claude account is the final backstop.
const budget = createBudget({
  dailyUsd: numberFromEnv(process.env.NION_DAILY_BUDGET_USD, 2),
  totalUsd: numberFromEnv(process.env.NION_TOTAL_BUDGET_USD, 8),
});
const visitors = createVisitorLimiter({
  perMinute: numberFromEnv(process.env.NION_VISITOR_PER_MINUTE, 6),
  perHour: numberFromEnv(process.env.NION_VISITOR_PER_HOUR, 40),
});
// A looser limit by network address, in case someone skips the page and calls the server directly.
const addresses = createVisitorLimiter({ perMinute: 60, perHour: numberFromEnv(process.env.NION_IP_PER_HOUR, 300) });
const gate = createGate(numberFromEnv(process.env.NION_MAX_IN_FLIGHT, 6));
const QLOO_RESERVE = numberFromEnv(process.env.NION_QLOO_RESERVE, 150); // stop asking Qloo when this few calls are left in the month
let restingUntil = 0; // set when Claude reports that the credit has run out or the key is rejected
setInterval(() => {
  visitors.sweep();
  addresses.sweep();
}, 10 * 60_000).unref();

// Why Nion is "resting" right now, or null if it is not.
function restingReason() {
  if (Date.now() < restingUntil) return "budget";
  if (!budget.check().ok) return "budget";
  const left = qloo.quota().monthRemaining;
  if (left !== undefined && left < QLOO_RESERVE) return "quota";
  return null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind a host's proxy (Render, for example) the visitor's address is in a header. How many
// proxies to trust depends on the host, and a wrong number lets one visitor look like many (or
// everyone look like one), so it is a setting. 0 means "no proxy": use the direct connection.
const proxyHops = Math.floor(numberFromEnv(process.env.TRUST_PROXY_HOPS, 0));
if (proxyHops > 0) app.set("trust proxy", proxyHops);

// Safe defaults for a public page. Nion's page loads only its own scripts and styles, and only
// talks to its own server, so this costs nothing and shuts off whole classes of attack.
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "microphone=(self), geolocation=(self), camera=(), payment=()",
  });
  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(here, "..", "public")));

// A quick "are you alive?" check, used by tests and later by the phone check.
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// For finding out how many proxies sit in front of the server on a host (set NION_IP_DEBUG=1, visit
// /api/whoami, then turn it off). It shows only the caller's own connection details.
if (process.env.NION_IP_DEBUG === "1") {
  app.get("/api/whoami", (req, res) => {
    res.json({
      trustProxyHops: proxyHops,
      ip: req.ip,
      ips: req.ips,
      forwardedFor: req.get("x-forwarded-for") ?? null,
      connection: req.socket.remoteAddress,
    });
  });
}

// The context comes from the browser, so treat it as untrusted: keep only the
// fields we expect, cap their length, and allow only letters in the name (so a
// made-up "name" can't smuggle instructions into Nion's prompt).
function cleanContext(raw = {}) {
  const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);
  // A name is at most three short words made of letters.
  const name = typeof raw.userName === "string"
    ? raw.userName
        .replace(/[^\p{L}\p{M}' -]/gu, "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ")
        .slice(0, 30)
    : "";
  return {
    nowISO: text(raw.nowISO, 40),
    timeZone: text(raw.timeZone, 60),
    localDateTime: text(raw.localDateTime, 80),
    userName: name || undefined,
    isNewConversation: raw.isNewConversation === true,
    // What the person has said they like. Checked item by item, because it ends up in Nion's instructions.
    taste: cleanTaste(raw.taste),
  };
}

// The person's location arrives either as GPS numbers ({ lat, lon }) or as a place
// they said out loud ({ text: "Brickell, Miami" }). Either way, work out a place
// to use, or return null if there isn't one.
async function resolveLocation(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
    const place = await resolvePlace(claude, raw.lat, raw.lon);
    // Keep the numbers too: Qloo needs them to find things near the person.
    return place
      ? { ...place, text: describePlace(place), fromGps: true, coords: { lat: raw.lat, lon: raw.lon } }
      : { failed: true };
  }

  if (typeof raw.text === "string") {
    // Something the person said, so keep only letters, numbers and a few marks.
    const text = raw.text.replace(/[^\p{L}\p{N}\p{M}\s,.'#&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) return null;
    // Find it on the map, so Qloo can look near it. If it cannot be found, the words alone
    // still work for web search, as before.
    const found = await geocodePlace(text);
    if (!found) return { text };
    const { lat, lon, ...place } = found;
    return { ...place, text: describePlace(place), coords: { lat, lon }, fromName: true };
  }
  return null;
}

app.post("/api/chat", async (req, res) => {
  const { messages, context, location } = req.body ?? {};

  // Check the request looks right before spending money on it.
  const valid =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 40 &&
    messages.every(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0 &&
        m.content.length <= 4000
    ) &&
    messages[messages.length - 1].role === "user";

  if (!valid) {
    return res.status(400).json({ error: "Bad request: send a list of messages ending with a user message." });
  }

  // Nion is "resting": the spending guard or Qloo's monthly allowance says no more for now.
  const resting = restingReason();
  if (resting) {
    res.set("Retry-After", "600");
    return res.status(503).json({ error: "Nion is resting for now.", reason: resting });
  }

  // One visitor asking too much. The page gives each browser a random id; without one (a script),
  // the network address stands in for it.
  const visitor = cleanVisitorId(req.get("x-nion-visitor")) ?? `ip:${req.ip}`;
  const turn = visitors.take(visitor);
  const byAddress = turn.ok ? addresses.take(req.ip) : turn;
  if (!byAddress.ok) {
    res.set("Retry-After", String(byAddress.retryAfterSec));
    return res.status(429).json({ error: "Slow down a little.", reason: "slow-down", retryAfterSec: byAddress.retryAfterSec });
  }

  // Too many questions being answered at once (this also protects Qloo's five calls a second).
  if (!gate.enter()) {
    res.set("Retry-After", "5");
    return res.status(503).json({ error: "Busy right now.", reason: "full" });
  }

  try {
    const place = await resolveLocation(location);
    if (place?.failed) return res.json({ needsLocation: true, locationFailed: true });

    const { reply, sources, suggestions, about, made, learned, usage, needsLocation } = await askNion({
      messages,
      context: { ...cleanContext(context), place: place?.text },
      location: place && !place.failed && place.city ? { city: place.city, region: place.region, country: place.country } : undefined,
      coords: place?.coords,
      coordsFrom: place?.fromGps ? "gps" : place?.fromName ? "named" : undefined,
      placeLabel: place?.fromName ? [place.area, place.city].filter(Boolean).join(", ") : undefined,
    });
    // A line per question, so you can see how much searching and Qloo asking is going on and what
    // it is costing (an estimate; each web search is about a cent; Qloo allows 10,000 calls a month).
    const cost = estimateCostUsd(currentModel(), usage);
    budget.add(cost);
    const spent = budget.snapshot();
    console.log(
      `Answered: ${usage.searches} search(es), ${usage.qlooCalls} Qloo ask(s), ${usage.inputTokens} tokens in, ${usage.outputTokens} out` +
        `, about ${(cost * 100).toFixed(2)} cents (today ${(spent.today * 100).toFixed(1)} of ${(spent.dailyUsd * 100).toFixed(0)}, ` +
        `total ${(spent.total * 100).toFixed(1)} of ${(spent.totalUsd * 100).toFixed(0)})` +
        (usage.searchErrors.length ? `, search errors: ${usage.searchErrors.join(", ")}` : "")
    );
    if (needsLocation) return res.json({ needsLocation: true });
    // Tell the page which place was worked out from GPS, so it can say it and use it next time.
    res.json({ reply, sources, suggestions, about, made, learned, place: place?.fromGps ? place.text : undefined });
  } catch (error) {
    console.error("Claude request failed:", error?.status ?? "", error?.message ?? error);
    const reason = classifyFailure(error);
    // No credit, or the key is rejected: every question would fail the same way and cost a call
    // to find out, so rest for a while instead of trying again for each visitor.
    if (reason === "credit" || reason === "key") restingUntil = Date.now() + 10 * 60_000;
    res.status(502).json({ error: "I'm having trouble reaching my sources.", reason });
  } finally {
    gate.leave();
  }
});

const port = Number(process.env.PORT) || 3000;
// (Express 5 also calls this when listening fails, with the error, so check for it.)
const server = app.listen(port, (error) => {
  if (error) return;
  console.log(`Nion is running. Open http://localhost:${port} in Chrome.`);
});

// A moment after starting, look up the few things a first visitor is likely to use, so their first question is
// quicker. It stops the instant a real question arrives, so it never slows anyone down.
if (process.env.NION_WARMUP !== "0") {
  setTimeout(async () => {
    const made = await warmUp({ qloo, geocode: geocodePlace, keepGoing: () => gate.count() === 0 });
    console.log(`Warmed up ${made} lookups for the demo path.`);
  }, 3000).unref();
}

// If the port is taken (often by another copy of Nion, or another project), say so plainly
// instead of looking as if it started.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\nNion can't start: port ${port} is already in use, probably by another program (or another copy of Nion).\n` +
        `Use a different port, for example:  PORT=${port + 10} npm start\n`
    );
  } else {
    console.error("\nNion can't start:", error.message, "\n");
  }
  process.exit(1);
});
