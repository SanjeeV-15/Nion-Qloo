// A speed check: asks the same five questions to two Claude models, a couple of
// times each, and reports how long each answer took and how long it was. This is
// to decide which model feels better for Nion. It calls Claude for real, so it
// costs a small amount (a search is about a cent).
//
// Run it with:  npm run check:speed

import { askNion } from "../server/brain.js";

const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const RUNS = 2;

const now = new Date();
const context = {
  nowISO: now.toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  localDateTime: now.toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }),
  userName: "Sanjeev",
  isNewConversation: false,
};

const place = "Brickell, Miami, Florida, US";
const questions = [
  { name: "A plain question", ask: "What is the capital of Australia?" },
  { name: "The date", ask: "What is today's date?" },
  { name: "Time in another city", ask: "What time is it in Mumbai right now?" },
  { name: "A news search", ask: "What's the latest world news?" },
  { name: "A local search", ask: "What are some good places to eat near me?", place, location: { city: "Miami", region: "Florida", country: "US" } },
];

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const words = (text) => text.split(/\s+/).filter(Boolean).length;

const results = {}; // model -> question -> { seconds: [], words: [], reply }
for (const model of MODELS) {
  results[model] = {};
  for (const question of questions) {
    results[model][question.name] = { seconds: [], words: [], reply: "" };
    for (let run = 0; run < RUNS; run++) {
      const started = Date.now();
      const result = await askNion({
        messages: [{ role: "user", content: question.ask }],
        context: { ...context, place: question.place },
        location: question.location,
        model,
      });
      const entry = results[model][question.name];
      entry.seconds.push((Date.now() - started) / 1000);
      entry.words.push(words(result.reply));
      entry.reply = result.needsLocation ? "(asked where the person is)" : result.reply;
    }
  }
}

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nMedian seconds to get a complete answer (${RUNS} runs each):\n`);
console.log(pad("", 24) + MODELS.map((m) => pad(m.replace("claude-", ""), 18)).join(""));
for (const question of questions) {
  const row = MODELS.map((m) => pad(`${median(results[m][question.name].seconds).toFixed(1)}s  (${Math.round(median(results[m][question.name].words))} words)`, 18));
  console.log(pad(question.name, 24) + row.join(""));
}
const totals = MODELS.map((m) => questions.reduce((sum, q) => sum + median(results[m][q.name].seconds), 0));
console.log(pad("All five added up", 24) + totals.map((t) => pad(`${t.toFixed(1)}s`, 18)).join(""));

console.log("\nWhat each model said to the news question and the plain question:");
for (const model of MODELS) {
  console.log(`\n${model}:`);
  for (const name of ["A plain question", "A news search"]) console.log(`  [${name}] ${results[model][name].reply}`);
}
