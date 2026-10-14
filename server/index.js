// The small server. It does two jobs:
//   1. Serves the Nion page (everything in the public/ folder) to your browser.
//   2. Answers POST /api/chat: takes what the person said, asks Claude, and
//      returns Nion's reply. This is the only place your API key is used.

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

// Loaded after the key check so a missing key gives the message above.
const { askNion } = await import("./brain.js");
const { resolvePlace, describePlace, cleanPlacePart } = await import("./place.js");
const { classifyFailure } = await import("./failure.js");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const claude = new Anthropic();

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(here, "..", "public")));

// A quick "are you alive?" check, used by tests and later by the phone check.
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

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
  };
}

// The person's location arrives either as GPS numbers ({ lat, lon }) or as a place
// they said out loud ({ text: "Brickell, Miami" }). Either way, work out a place
// to use, or return null if there isn't one.
async function resolveLocation(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
    const place = await resolvePlace(claude, raw.lat, raw.lon);
    return place ? { ...place, text: describePlace(place), fromGps: true } : { failed: true };
  }

  if (typeof raw.text === "string") {
    // Something the person said, so keep only letters, numbers and a few marks.
    const text = raw.text.replace(/[^\p{L}\p{N}\p{M}\s,.'#&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
    return text ? { text } : null;
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

  try {
    const place = await resolveLocation(location);
    if (place?.failed) return res.json({ needsLocation: true, locationFailed: true });

    const { reply, sources, usage, needsLocation } = await askNion({
      messages,
      context: { ...cleanContext(context), place: place?.text },
      location: place && !place.failed ? { city: place.city, region: place.region, country: place.country } : undefined,
    });
    // A line per question, so you can see how much searching is going on (each
    // search costs about a cent).
    console.log(
      `Answered: ${usage.searches} search(es), ${usage.inputTokens} tokens in, ${usage.outputTokens} out` +
        (usage.searchErrors.length ? `, search errors: ${usage.searchErrors.join(", ")}` : "")
    );
    if (needsLocation) return res.json({ needsLocation: true });
    // Tell the page which place was worked out from GPS, so it can say it and use it next time.
    res.json({ reply, sources, place: place?.fromGps ? place.text : undefined });
  } catch (error) {
    console.error("Claude request failed:", error?.status ?? "", error?.message ?? error);
    res.status(502).json({ error: "I'm having trouble reaching my sources.", reason: classifyFailure(error) });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Nion is running. Open http://localhost:${port} in Chrome.`);
});
