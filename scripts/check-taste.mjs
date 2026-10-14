// Asks the real Nion (real Claude, real Qloo) a handful of questions and checks the answers
// (npm run check:taste).
//
// THIS SPENDS ANTHROPIC CREDIT: about eight questions on Haiku 5.5, a few cents in all. The
// script prints an estimate at the end. It also uses a few of Qloo's 10,000 monthly calls.
// It prints no keys and saves nothing.

import { askNion } from "../server/brain.js";

const denver = { lat: 39.7392, lon: -104.9903 };
const now = new Date();
const context = {
  nowISO: now.toISOString(),
  timeZone: "America/Denver",
  localDateTime: now.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "full", timeStyle: "short" }),
  userName: "Sanjeev",
  isNewConversation: true,
  place: "Denver, Colorado, US",
};
const location = { city: "Denver", region: "Colorado", country: "US" };

// What each question should do. `qloo` is how many Qloo asks to expect: a number, or "any>0".
const cases = [
  { say: "I'm hungry.", expect: "one short taste question, no Qloo yet", qloo: 0, question: true },
  { say: "I love ramen and I'm hungry. What's near me?", expect: "ramen places, a reason each", qloo: "any>0" },
  { say: "Find me music like Radiohead.", expect: "artists from Qloo", qloo: "any>0" },
  { say: "I loved Blade Runner 2049. What should I watch next?", expect: "films from Qloo", qloo: "any>0" },
  { say: "I love Radiohead. Where in the world would I love to travel?", expect: "destinations from Qloo", qloo: "any>0" },
  { say: "I like jazz and ramen. Any place near me that fits both?", expect: "a mix of tastes", qloo: "any>0" },
  { say: "What's the latest world news?", expect: "one web search, no Qloo", qloo: 0, search: true },
  { say: "What time is it in Tokyo?", expect: "no tools at all", qloo: 0 },
];

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const problems = (reply) => {
  const found = [];
  if (words(reply) > 85) found.push(`too long (${words(reply)} words)`);
  if (/[*#`_]|https?:\/\/|www\./.test(reply)) found.push("markdown or a link");
  if (/\b0\.\d\d\b|\b\d{2,3}%/.test(reply)) found.push("reads out a score");
  return found;
};

let inputTokens = 0, outputTokens = 0, searches = 0, qlooCalls = 0, failed = 0;

for (const c of cases) {
  const started = Date.now();
  let result;
  try {
    result = await askNion({ messages: [{ role: "user", content: c.say }], context, location, coords: denver });
  } catch (error) {
    failed += 1;
    console.log(`\n"${c.say}"\n  FAILED: ${error?.status ?? ""} ${error?.message ?? error}`);
    continue;
  }
  const u = result.usage;
  inputTokens += u.inputTokens; outputTokens += u.outputTokens; searches += u.searches; qlooCalls += u.qlooCalls;

  const issues = problems(result.reply);
  if (c.qloo === 0 && u.qlooCalls !== 0) issues.push(`asked Qloo ${u.qlooCalls}x, expected none`);
  if (c.qloo === "any>0" && u.qlooCalls === 0) issues.push("never asked Qloo");
  if (c.search && u.searches !== 1) issues.push(`searched ${u.searches}x, expected 1`);
  if (c.question && !/\?\s*$/.test(result.reply)) issues.push("did not end with a question");
  if (c.question && (result.reply.match(/\?/g) ?? []).length > 1) issues.push("asked more than one question");
  if (issues.length) failed += 1;

  console.log(`\n"${c.say}"  -> expected: ${c.expect}`);
  console.log(`  Nion: ${result.reply}`);
  console.log(`  ${words(result.reply)} words | ${u.qlooCalls} Qloo ask(s) | ${u.searches} search(es) | ${result.suggestions.length} on screen | ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(issues.length ? `  PROBLEMS: ${issues.join("; ")}` : "  ok");
}

// Haiku 5.5: $0.10 in and $0.50 out per million tokens (as listed in October 2026; check
// Anthropic's pricing page), plus about a cent per web search.
const estimate = (inputTokens * 0.1 + outputTokens * 0.5) / 1_000_000 + searches * 0.01;
console.log(
  `\nTotals: ${inputTokens} tokens in, ${outputTokens} out, ${searches} search(es), ${qlooCalls} Qloo ask(s). ` +
    `Estimated Anthropic cost: about ${(estimate * 100).toFixed(1)} cents.`
);
console.log(failed ? `${failed} question(s) had problems.` : "All questions looked right.");
process.exit(failed ? 1 : 0);
