// Asks the real Nion (real Claude, real Qloo) a handful of questions and checks the answers.
//
//   npm run check:taste             runs every group
//   npm run check:taste -- memory   runs only the taste-memory group (slice 3)
//   npm run check:taste -- basics   runs only the recommendation basics (slice 2)
//
// THIS SPENDS ANTHROPIC CREDIT: about eight questions on Haiku 5.5 is a couple of cents.
// It prints an estimate at the end. It also uses a few of Qloo's 10,000 monthly calls.
// It prints no keys and saves nothing.

import { askNion } from "../server/brain.js";

const denver = { lat: 39.7392, lon: -104.9903 };
const now = new Date();
const baseContext = {
  nowISO: now.toISOString(),
  timeZone: "America/Denver",
  localDateTime: now.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "full", timeStyle: "short" }),
  userName: "Sanjeev",
  isNewConversation: true,
  place: "Denver, Colorado, US",
};
const location = { city: "Denver", region: "Colorado", country: "US" };

// The demo taste the page offers (the same four things as public/js/taste.js).
const DEMO = [
  { name: "ramen", kind: "food", opinion: "like" },
  { name: "Radiohead", kind: "artist", opinion: "like" },
  { name: "Blade Runner 2049", kind: "movie", opinion: "like" },
  { name: "jazz", kind: "genre", opinion: "like" },
];

// What each question should do. `qloo` is how many Qloo asks to expect: a number, or "any>0".
// `learned` is a regex that must match one learned taste written as "like ramen"; `noLearned` means none.
const cases = [
  // ----- slice 2: recommendations -----
  { group: "basics", say: "I'm hungry.", expect: "one short taste question, no Qloo yet", qloo: 0, question: true },
  { group: "basics", say: "I love ramen and I'm hungry. What's near me?", expect: "ramen places, a reason each", qloo: "any>0" },
  { group: "basics", say: "Find me music like Radiohead.", expect: "artists from Qloo", qloo: "any>0" },
  { group: "basics", say: "I loved Blade Runner 2049. What should I watch next?", expect: "films from Qloo", qloo: "any>0" },
  { group: "basics", say: "I love Radiohead. Where in the world would I love to travel?", expect: "destinations from Qloo", qloo: "any>0" },
  { group: "basics", say: "What's the latest world news?", expect: "one web search, no Qloo", qloo: 0, search: true },
  { group: "basics", say: "What time is it in Tokyo?", expect: "no tools at all", qloo: 0 },

  // ----- slice 3: Nion remembers what the person says about their taste -----
  {
    group: "memory", taste: DEMO, say: "I'm hungry.",
    expect: "says it knows they like ramen and asks a yes or no, no Qloo yet",
    qloo: 0, question: true, mustMatch: /ramen/i,
  },
  {
    group: "memory", taste: DEMO,
    messages: [
      { role: "user", content: "I'm hungry." },
      { role: "assistant", content: "You like ramen. Want ramen places near you?" },
      { role: "user", content: "Yes please." },
    ],
    expect: "a yes: goes ahead with ramen places", qloo: "any>0", mustMatch: /ramen|noodle/i,
  },
  {
    group: "memory", taste: [], say: "I love tacos. Where can I eat around here?",
    expect: "taco places, and saves 'like tacos'", qloo: "any>0", learned: /^like .*taco/i,
  },
  {
    group: "memory", taste: [], say: "I really don't like sushi, so not that. Where should I eat?",
    expect: "saves 'dislike sushi'; either asks what they do like or suggests something", learned: /^dislike .*sushi/i, noSushi: true,
  },
  {
    group: "memory", taste: DEMO,
    messages: [
      { role: "user", content: "I'm hungry." },
      { role: "assistant", content: "You like ramen. Want ramen places near you?" },
      { role: "user", content: "No, not ramen today." },
    ],
    expect: "takes the no gracefully, saves 'dislike ramen' or asks what they want instead", question: true, learned: /^dislike .*ramen/i,
  },
  {
    group: "memory", taste: [], say: "What do you know about my taste?",
    expect: "honestly says it doesn't know yet, invents nothing", qloo: 0, mustMatch: /(don't|do not|haven't|not yet|nothing)/i, mustNotMatch: /ramen|radiohead|jazz|sushi|tacos/i,
  },
  {
    group: "memory", taste: DEMO, say: "What do you know about my taste?",
    expect: "repeats exactly the demo items, nothing extra", qloo: 0, mustMatch: /ramen/i, mustNotMatch: /sushi|tacos|pizza|coffee/i,
  },
];

const only = process.argv[2];
const chosen = only ? cases.filter((c) => c.group === only) : cases;
if (chosen.length === 0) {
  console.log(`No group called "${only}". Use basics or memory.`);
  process.exit(1);
}

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const problems = (reply) => {
  const found = [];
  if (words(reply) > 85) found.push(`too long (${words(reply)} words)`);
  if (/[*#`_]|https?:\/\/|www\./.test(reply)) found.push("markdown or a link");
  if (/\b0\.\d\d\b|\b\d{2,3}%/.test(reply)) found.push("reads out a score");
  return found;
};

let inputTokens = 0, outputTokens = 0, searches = 0, qlooCalls = 0, failed = 0;

for (const c of chosen) {
  const started = Date.now();
  const messages = c.messages ?? [{ role: "user", content: c.say }];
  const asked = messages.at(-1).content;
  let result;
  try {
    result = await askNion({
      messages,
      context: { ...baseContext, taste: c.taste ?? [], isNewConversation: messages.length === 1 },
      location,
      coords: denver,
    });
  } catch (error) {
    failed += 1;
    console.log(`\n"${asked}"\n  FAILED: ${error?.status ?? ""} ${error?.message ?? error}`);
    continue;
  }
  const u = result.usage;
  inputTokens += u.inputTokens; outputTokens += u.outputTokens; searches += u.searches; qlooCalls += u.qlooCalls;

  const learned = (result.learned ?? []).map((t) => `${t.opinion} ${t.name}`);
  const issues = problems(result.reply);
  if (c.qloo === 0 && u.qlooCalls !== 0) issues.push(`asked Qloo ${u.qlooCalls}x, expected none`);
  if (c.qloo === "any>0" && u.qlooCalls === 0) issues.push("never asked Qloo");
  if (c.search && u.searches !== 1) issues.push(`searched ${u.searches}x, expected 1`);
  if (c.question && !/\?\s*$/.test(result.reply)) issues.push("did not end with a question");
  if (c.question && (result.reply.match(/\?/g) ?? []).length > 1) issues.push("asked more than one question");
  if (c.mustMatch && !c.mustMatch.test(result.reply)) issues.push(`reply should match ${c.mustMatch}`);
  if (c.mustNotMatch && c.mustNotMatch.test(result.reply)) issues.push(`reply should not match ${c.mustNotMatch}`);
  if (c.learned && !learned.some((l) => c.learned.test(l))) issues.push(`should have saved something like ${c.learned}`);
  if (c.noSushi && result.suggestions.some((s) => /sushi/i.test(`${s.name} ${(s.tags ?? []).join(" ")}`))) issues.push("suggested a sushi place after 'no sushi'");
  if (issues.length) failed += 1;

  console.log(`\n"${asked}"${c.taste ? `  [${c.taste.length ? "demo taste" : "no taste yet"}]` : ""}  -> expected: ${c.expect}`);
  console.log(`  Nion: ${result.reply}`);
  console.log(
    `  ${words(result.reply)} words | ${u.qlooCalls} Qloo ask(s) | ${u.searches} search(es) | ${result.suggestions.length} on screen | ` +
      `saved: ${learned.length ? learned.join(", ") : "nothing"} | ${((Date.now() - started) / 1000).toFixed(1)} s`
  );
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
