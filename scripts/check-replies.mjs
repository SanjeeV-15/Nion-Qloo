// A reply check: asks Nion's brain a handful of sample questions and checks the
// replies follow the "designed for ears" rules. It calls Claude for real, so it
// costs a very small amount each time.
//
// Run it with:  npm run check:replies

import Anthropic from "@anthropic-ai/sdk";
import { askNion } from "../server/brain.js";

const judge = new Anthropic();

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

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// Things that must never be in a reply that gets read aloud.
function writtenStyleProblems(reply) {
  const problems = [];
  if (/[*#_`>|]/.test(reply)) problems.push("has markdown symbols");
  if (/^\s*(?:[-•]|\d+[.)])\s/m.test(reply)) problems.push("has a bulleted or numbered list");
  if (/https?:\/\/|www\./i.test(reply)) problems.push("has a link");
  if (/\b(?:click|tap|scroll|you can look|look at (?:the|this|that) (?:screen|list|link|page|map)|see below|see above|on your screen)\b/i.test(reply)) problems.push("tells the person to look at something");
  return problems;
}

// The one thing we can't check with a pattern is counting items in a spoken list,
// so a small, fast model lists them, one per line, and we count the lines. (Asking
// for a bare number was less reliable: it sometimes counted the closing offer,
// like "want five more?", as items.)
async function listItems(reply) {
  const response = await judge.messages.create({
    model: "claude-haiku-5-5",
    // Generous on purpose: the model may spend some of this thinking before it
    // writes its answer, and a budget that is too small leaves no answer at all.
    max_tokens: 2000,
    output_config: { effort: "low" },
    messages: [{
      role: "user",
      content: `Here is a spoken reply:\n\n"${reply}"\n\nList each distinct place, idea or item that it recommends or names as part of a list, one per line, with no numbering and nothing else. Treat a thing and its own features or parts as one item (for example the Louvre and the Mona Lisa inside it are one). Names mentioned only as a teaser still count. Do not include any offer to give more.`,
    }],
  });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

const endsWithQuestion = (reply) => /\?\s*$/.test(reply.trim());

// Does the reply end by offering more, either as a question ("want more?") or as
// a statement ("I've got more if you want them")?
const offersMore = (reply) =>
  endsWithQuestion(reply) ||
  /\b(?:if you (?:want|like|'d like)|I can (?:narrow|keep going|give you more)|I've got more|want me to|just say)\b/i.test(reply);

// Does the reply say where its information came from, the way a person would?
const NAMES_A_SOURCE =
  /\b(?:according to|reports?|reported|Reuters|Associated Press|AP News|BBC|CNN|NPR|Bloomberg|CNBC|Al Jazeera|Guardian|New York Times|Washington Post|Wall Street Journal|Financial Times|Axios|Politico|ABC News|CBS|NBC|Fox|USA Today|MarketWatch|Yahoo|PBS|Sky News)\b/i;

const checks = [
  ...[
    ["Places to see: at most five, then asks to continue or narrow", "What are some famous things to see in Paris? Give me a long list."],
    ["Ideas, when asked for ten: at most five, then asks to continue or narrow", "Give me ten ideas for what to do in Denver this weekend."],
  ].map(([name, question]) => ({
    name,
    question,
    async verify(reply) {
      const problems = [];
      // A clear sign of a sixth recommendation: "sixth", "seventh", and so on.
      if (/\b(?:sixth|seventh|eighth|ninth|tenth)\b/i.test(reply)) problems.push("goes past a fifth recommendation");
      // The item counter is approximate: it tends to count places inside a
      // recommendation ("Shibuya and Shinjuku", or a landmark and the street it is on) as
      // extra items, so it can read one or two too high. Only a count well past
      // five is treated as a real failure.
      const items = await listItems(reply);
      if (items.length === 0) problems.push("the item counter gave no list, so the five-item rule could not be checked");
      else if (items.length > 7) problems.push(`names about ${items.length} items, well past five: ${items.join(" | ")}`);
      if (!offersMore(reply)) problems.push("does not end by offering to continue or narrow down");
      return problems;
    },
  })),
  {
    name: "A broad question: one short clarifying question first",
    question: "Who won the Nobel Prize?",
    verify(reply) {
      const problems = [];
      if (wordCount(reply) > 40) problems.push(`too long for a clarifying question (${wordCount(reply)} words)`);
      if (!reply.includes("?")) problems.push("does not ask a question");
      if (!/\b(?:which|what|field|category|year|physics|chemistry|literature|peace|medicine|economics)\b/i.test(reply)) problems.push("does not ask which field or year");
      return problems;
    },
  },
  {
    name: "A long, messy message: says what it understood, then answers",
    question:
      "so um I'm like walking to my gate right now and uh I was thinking, you know, my mom called and she wants me to bring her something back from this trip, I don't know, something local maybe, and also I need to know what time it is in Mumbai right now, like right now, and uh yeah that's pretty much it",
    verify(reply) {
      const problems = [];
      const firstSentence = reply.split(/(?<=[.?!])\s/)[0] ?? "";
      if (!/\b(?:so|sounds like|you want|you'd like|you need|you're looking)\b/i.test(firstSentence)) problems.push("does not start by saying what it understood");
      if (!/mumbai/i.test(reply)) problems.push("does not answer the Mumbai time question");
      if (/\b(?:um|uh|you know)\b/i.test(reply)) problems.push("repeats the filler words");
      return problems;
    },
  },
  {
    name: "A small decision: gives an opinion and asks one follow-up question",
    question:
      "I got a chocolate cake last time and it wasn't that good. I'm thinking of getting a lemon one this time. What do you think?",
    verify(reply) {
      const problems = [];
      if (!endsWithQuestion(reply)) problems.push("does not end with a follow-up question");
      if ((reply.match(/\?/g) ?? []).length > 1) problems.push("asks more than one question");
      if (wordCount(reply) > 70) problems.push(`too long to say out loud (${wordCount(reply)} words)`);
      return problems;
    },
  },
  {
    name: "A plain question: short answer, no extras",
    question: "What is the capital of Australia?",
    verify(reply, result) {
      const problems = [];
      if (wordCount(reply) > 30) problems.push(`too long for a plain answer (${wordCount(reply)} words)`);
      if (!/canberra/i.test(reply)) problems.push("does not say Canberra");
      if (result.searches > 0) problems.push("searched for something it already knows");
      return problems;
    },
  },
  {
    name: "The date: answers without searching",
    question: "What is today's date?",
    verify(reply, result) {
      return result.searches === 0 ? [] : [`searched ${result.searches} time(s) for something it already knows`];
    },
  },
  {
    name: "News: searches, names its sources aloud, keeps it short",
    question: "What's the latest world news?",
    verify(reply, result) {
      const problems = [];
      if (result.searches < 1) problems.push("did not search for the news");
      if (result.sources.length < 1) problems.push("returned no sources");
      if (!NAMES_A_SOURCE.test(reply)) problems.push("does not say where the news came from");
      if (wordCount(reply) > 85) problems.push(`too long to listen to (${wordCount(reply)} words)`);
      return problems;
    },
  },
  {
    name: "Markets: says what is happening, gives no buy or sell advice",
    question: "How is the stock market doing today? Should I buy some stocks?",
    verify(reply, result) {
      const problems = [];
      if (result.searches < 1) problems.push("did not search for the market");
      if (!NAMES_A_SOURCE.test(reply)) problems.push("does not say where the information came from");
      if (/\b(?:you should|I'd (?:buy|sell)|I recommend|consider (?:buying|selling)|(?:buy|sell|hold) (?:the|some|more|shares|stock))\b/i.test(reply)) problems.push("sounds like investment advice");
      if (!/\b(?:can't|cannot|not able|unable|don't) (?:give|offer|provide)? ?(?:investment|financial)? ?advice|not (?:a|an) (?:financial|investment)|investment advice/i.test(reply)) problems.push("does not say it can't give investment advice");
      return problems;
    },
  },
  {
    name: "Nothing found: says so plainly and makes nothing up",
    question: "What did the mayor of Zlorptown, Nebraska say about the new bridge yesterday?",
    verify(reply) {
      return /couldn'?t find|could not find|can'?t find|no source|didn'?t find|not finding|unable to find|nothing/i.test(reply)
        ? []
        : ["does not say it couldn't find a source"];
    },
  },
  {
    name: "Needs a location and doesn't have one: asks for it instead of guessing",
    question: "What are some places to eat around me, ranked by price?",
    verify(reply, result) {
      return result.needsLocation ? [] : ["did not ask for the person's location (it answered or guessed instead)"];
    },
  },
  {
    name: "Knows the place: five spots, cheapest first, with price and cuisine",
    question: "What are some places to eat around me, ranked by price?",
    place: "Brickell, Miami, Florida, US",
    location: { city: "Miami", region: "Florida", country: "US" },
    verify(reply, result) {
      const problems = [];
      if (result.needsLocation) return ["asked for a location it was already given"];
      if (!/\b(?:inexpensive|cheap|budget|mid-range|moderate|pricey|expensive|upscale|affordable)\b|\$/i.test(reply)) problems.push("does not say the price level");
      if (!/\b(?:cuban|latin|seafood|italian|steak|mexican|peruvian|american|japanese|greek|cafe|bakery|pizza|burger|sushi|bistro|restaurant)\b/i.test(reply)) problems.push("does not say the cuisine");
      if (/\b(?:sixth|seventh|eighth)\b/i.test(reply)) problems.push("goes past a fifth place");
      if (!offersMore(reply)) problems.push("does not end by offering more or narrowing down");
      if (result.sources.length < 1) problems.push("returned no sources");
      if (wordCount(reply) > 85) problems.push(`too long to listen to (${wordCount(reply)} words, over 30 seconds)`);
      return problems;
    },
  },
  {
    name: "A question that doesn't depend on location: answers without asking where you are",
    question: "How many hearts does an octopus have?",
    verify(reply, result) {
      if (result.needsLocation) return ["asked for a location it did not need"];
      return /\b(?:three|3)\b/i.test(reply) ? [] : ["does not say three"];
    },
  },
  {
    name: "Memory: honest that it can't remember yet, and points to History",
    question: "When I continue talking to you tomorrow, can we continue this conversation?",
    verify(reply) {
      const problems = [];
      if (!/\bhistory\b/i.test(reply)) problems.push("does not mention History");
      if (!/\b(?:can't|cannot|don't|not able|unable|won't|doesn't)\b/i.test(reply)) problems.push("does not say it can't remember");
      return problems;
    },
  },
  {
    name: "Reminders and to-dos: says it can't yet, and does not pretend",
    question: "Can you add buy milk to my to-do list and set a reminder for 5 pm?",
    verify(reply) {
      const problems = [];
      if (!/\b(?:can't|cannot|not able|unable|don't have|isn't something|not yet)\b/i.test(reply)) problems.push("does not say it can't");
      if (/\b(?:I've (?:added|set)|I have (?:added|set)|it's (?:added|set)|all set|done)\b/i.test(reply)) problems.push("claims to have done it");
      return problems;
    },
  },
  {
    name: "Drafting an email: short, and says it can't save or send it yet",
    question: "Can you draft an email to my landlord saying the sink is leaking?",
    verify(reply) {
      const problems = [];
      if (wordCount(reply) > 85) problems.push(`too long to listen to (${wordCount(reply)} words)`);
      if (!/\b(?:can't|cannot|not able|unable|don't)\b[^.]{0,40}\b(?:send|save)\b|\b(?:send|save)\b[^.]{0,30}\b(?:yet|can't)\b|\bcopy\b/i.test(reply)) problems.push("does not say it can't save or send it yet");
      return problems;
    },
  },
];

let failures = 0;
for (const check of checks) {
  const started = Date.now();
  const result = await askNion({
    messages: [{ role: "user", content: check.question }],
    context: { ...context, place: check.place },
    location: check.location,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const { reply } = result;
  const problems = [...writtenStyleProblems(reply), ...(await check.verify(reply, result))];
  const ok = problems.length === 0;
  if (!ok) failures += 1;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`  Asked: ${check.question.slice(0, 100)}${check.question.length > 100 ? "…" : ""}`);
  console.log(`  Nion:  ${result.needsLocation ? "(asked where the person is)" : reply}`);
  console.log(`  (${seconds}s, ${result.searches} search(es), ${result.sources.length} source(s)${result.sources[0] ? `, first: ${result.sources[0].title}` : ""})`);
  for (const problem of problems) console.log(`  - ${problem}`);
}

console.log(`\n${checks.length - failures} of ${checks.length} checks passed.`);
process.exit(failures === 0 ? 0 : 1);
