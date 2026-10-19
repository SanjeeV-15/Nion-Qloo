// Asks the real Nion (real Claude, real Qloo) a handful of questions and checks the answers.
//
//   npm run check:taste             runs every group
//   npm run check:taste -- memory   runs only the taste-memory group (slice 3)
//   npm run check:taste -- basics   runs only the recommendation basics (slice 2)
//   npm run check:taste -- location runs only the location group (slice 5)
//   npm run check:taste -- open     runs only the "open now" question
//   npm run check:taste -- memory 5 runs only the fifth question of that group
//
// THIS SPENDS ANTHROPIC CREDIT: about eight questions on Haiku 5.5 is a couple of cents.
// It prints an estimate at the end. It also uses a few of Qloo's 10,000 monthly calls.
// It prints no keys and saves nothing.

import { askNion } from "../server/brain.js";
import { geocodePlace, describePlace } from "../server/place.js";

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

// For the location group: how far (in km) a pick must be from a place to count as "near" it.
const km = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

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
    expect: "goes straight to ramen places and says it based them on the ramen taste (no confirmation first)",
    qloo: "any>0", needPicks: true, mustMatch: /ramen/i,
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
    expect: "takes the no gracefully and asks what they want instead; 'not today' is not a dislike, so nothing is saved", question: true, notLearned: /^dislike/i,
  },
  {
    group: "memory", taste: [], say: "What do you know about my taste?",
    expect: "honestly says it doesn't know yet, invents nothing", qloo: 0, mustMatch: /(don't|do not|haven't|not yet|nothing)/i, mustNotMatch: /ramen|radiohead|jazz|sushi|tacos/i,
  },
  {
    group: "memory", taste: DEMO, say: "What do you know about my taste?",
    expect: "repeats exactly the demo items, nothing extra", qloo: 0, mustMatch: /ramen/i, mustNotMatch: /sushi|tacos|pizza|coffee/i,
  },

  // ----- later improvements -----
  {
    group: "open", taste: [], say: "I love tacos and I need somewhere open right now.",
    expect: "taco places that are open now come first, and it says when one closes",
    qloo: "any>0", needPicks: true, needHours: true,
  },

  // The follow-up that went wrong in a demo: after picks with hours, "Thank you" made Nion say it had not checked
  // the hours. Claude cannot see the earlier Qloo results on a later turn, only its own sentence.
  {
    group: "open", taste: DEMO,
    messages: [
      { role: "user", content: "I like Radiohead and Blade Runner. What would suit me in Denver?" },
      { role: "assistant", content: "Since you like Radiohead and Blade Runner, try the Clyfford Still Museum, which closes at 5 pm, or the Cathedral Basilica, open until 7 pm. Want more, or something narrower?" },
      { role: "user", content: "Thank you." },
    ],
    expect: "just replies to the thanks; never says it didn't check the hours or corrects itself", qloo: 0,
    mustNotMatch: /(didn't|did not|haven't|never)( actually)? (check|verif)|correct myself|I should (correct|clarify)|confirm (those|the) (opening )?hours/i,
  },

  // ----- slice 5: a city the person says, and looking somewhere else -----
  // `city` means the person said where they are, so the server would have found it on the map.
  {
    group: "location", city: "Lisbon", taste: [], say: "I love ramen. Where can I eat around here?",
    expect: "ramen places in Lisbon, and no walking times or distances (only the city's middle is known)",
    qloo: "any>0", needPicks: true, nearCity: { lat: 38.72, lon: -9.14, withinKm: 15 }, mustNotMatch: /\d+\s*(minutes?|min)\b[^.]*\b(foot|walk)|minutes? (on foot|walk)|\b\d+(\.\d+)?\s*(miles?|km|kilomet)/i,
  },
  {
    group: "location", city: "Miami", taste: [], say: "Any good tacos near me?",
    expect: "taco places in Miami, no distances", qloo: "any>0", needPicks: true, nearCity: { lat: 25.77, lon: -80.19, withinKm: 25 },
    mustNotMatch: /\d+\s*(minutes?|min)\b[^.]*\b(foot|walk)|minutes? (on foot|walk)|\b\d+(\.\d+)?\s*(miles?|km|kilomet)/i,
  },
  {
    group: "location", taste: [], say: "I love ramen. What's good to eat if I go to Tokyo next month?",
    expect: "uses 'near Tokyo' even though the person is in Denver", qloo: "any>0", needPicks: true, nearCity: { lat: 35.68, lon: 139.76, withinKm: 25 },
  },
];

const only = process.argv[2];
const inGroup = only ? cases.filter((c) => c.group === only) : cases;
const number = Number(process.argv[3]);
const chosen = Number.isInteger(number) && number >= 1 ? inGroup.slice(number - 1, number) : inGroup;
if (chosen.length === 0) {
  console.log(`No group called "${only}". Use basics, memory, location or open.`);
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
  // The person is in Denver (exact GPS), unless the case says they named a city.
  let where = { context: baseContext, location, coords: denver, coordsFrom: "gps", placeLabel: undefined };
  if (c.city) {
    const found = await geocodePlace(c.city);
    if (!found) { failed += 1; console.log(`\n"${c.say}"\n  FAILED: could not find ${c.city} on the map`); continue; }
    const { lat, lon, ...place } = found;
    where = {
      context: { ...baseContext, place: describePlace(place) },
      location: { city: place.city, region: place.region, country: place.country },
      coords: { lat, lon },
      coordsFrom: "named",
      placeLabel: [place.area, place.city].filter(Boolean).join(", "),
    };
  }
  let result;
  try {
    result = await askNion({
      messages,
      context: { ...where.context, taste: c.taste ?? [], isNewConversation: messages.length === 1 },
      location: where.location,
      coords: where.coords,
      coordsFrom: where.coordsFrom,
      placeLabel: where.placeLabel,
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
  if (c.notLearned && learned.some((l) => c.notLearned.test(l))) issues.push(`should not have saved ${learned.filter((l) => c.notLearned.test(l)).join(", ")}`);
  if (c.qloo === "any>0" && result.suggestions.length > 3) issues.push(`named ${result.suggestions.length} picks, expected at most 3`);
  if (c.qloo === "any>0" && words(result.reply) > 75) issues.push(`too long to listen to (${words(result.reply)} words)`);
  if (c.needHours && !result.suggestions.some((p) => p.hours)) issues.push("no pick showed opening hours");
  if (c.needHours && result.suggestions.length > 1) {
    const firstClosed = result.suggestions.findIndex((p) => p.open === false);
    if (firstClosed >= 0 && result.suggestions.slice(firstClosed).some((p) => p.open === true)) issues.push("an open place was listed after a closed one");
  }
  if (c.needPicks && result.suggestions.length === 0) issues.push("named places but none were listed on screen");
  if (c.nearCity) {
    const first = result.suggestions.find((p) => p.location);
    if (!first) issues.push("no pick with a position to check");
    else if (km(first.location, c.nearCity) > c.nearCity.withinKm) issues.push(`first pick is ${Math.round(km(first.location, c.nearCity))} km from where it should be`);
  }
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
