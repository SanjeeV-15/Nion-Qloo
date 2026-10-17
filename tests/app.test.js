// Tests the controller (public/js/app.js) with a pretend microphone, a pretend
// voice and a pretend server, so we can check conversations without audio.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- Pretend browser pieces ---------------------------------------------------

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
// The app waits in places (8 seconds for a question, 15 for a follow-up). These
// timers don't hold the test process open, and a test can fire one on demand.
const scheduled = new Set();
globalThis.setTimeout = (fn, ms, ...args) => {
  const entry = { fn, ms };
  entry.timer = realSetTimeout(() => {
    scheduled.delete(entry);
    fn(...args);
  }, ms);
  entry.timer.unref();
  scheduled.add(entry);
  return entry.timer;
};
globalThis.clearTimeout = (timer) => {
  for (const entry of scheduled) if (entry.timer === timer) scheduled.delete(entry);
  realClearTimeout(timer);
};
// Pretend `ms` milliseconds have passed for any timer waiting that long.
function firePending(ms) {
  for (const entry of [...scheduled]) {
    if (entry.ms !== ms) continue;
    scheduled.delete(entry);
    realClearTimeout(entry.timer);
    entry.fn();
  }
}
const tick = () => new Promise((resolve) => realSetTimeout(resolve, 5));

class FakeRecognition {
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  abort() {}
}

let storage, elements, spoken, pending, fetches;
let pageHandlers = {}; // things the page listens for, such as a key press

// A pretend location feature. Tests set what the browser says about permission,
// and whether getting the position works.
let locationPermission = "prompt"; // "granted" | "denied" | "prompt"
let locationWorks = true;
let locationRequests = 0;
let locationCallbacks = null; // set while the pretend browser is waiting for the person to click Allow
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    permissions: { query: async () => ({ state: locationPermission }) },
    geolocation: {
      getCurrentPosition(success, failure) {
        locationRequests += 1;
        if (locationWorks === "later") locationCallbacks = { success, failure };
        else if (locationWorks) success({ coords: { latitude: 25.7617, longitude: -80.1918 } });
        else failure(new Error("User denied Geolocation"));
      },
    },
  },
});

globalThis.window = globalThis;
globalThis.SpeechRecognition = FakeRecognition;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
globalThis.speechSynthesis = {
  getVoices: () => [{ name: "Samantha", lang: "en-US", localService: true }],
  speak(utterance) {
    spoken.push(utterance.text);
    pending.push(utterance);
  },
  cancel() {
    const cancelled = pending;
    pending = [];
    cancelled.forEach((u) => u.onerror?.({}));
  },
};
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.fetch = (url, options) =>
  new Promise((resolve, reject) => {
    const respond = (data) => resolve({ ok: true, json: async () => data });
    const call = {
      body: JSON.parse(options.body),
      headers: options.headers ?? {},
      aborted: false,
      reply: (text) => respond({ reply: text }),
      respond,
      needLocation: () => respond({ needsLocation: true }),
      // The server had a problem (for example it could not reach Claude).
      serverError: (reason) => resolve({ ok: false, status: 502, json: async () => ({ error: "trouble", reason }) }),
    };
    options.signal?.addEventListener("abort", () => {
      call.aborted = true;
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
    fetches.push(call);
  });

function makeElement() {
  return {
    textContent: "",
    hidden: false,
    dataset: {},
    children: [],
    setAttribute() {},
    handlers: {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    click() {
      return this.handlers.click();
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren() {
      this.children = [];
    },
  };
}

let appVersion = 0;
async function startApp({ name, search = "", voice = true, hostname } = {}) {
  for (const entry of scheduled) realClearTimeout(entry.timer); // timers of an earlier test
  scheduled.clear();
  storage = new Map();
  if (name) storage.set("nion.name", name);
  elements = {};
  pageHandlers = {};
  spoken = [];
  pending = [];
  fetches = [];
  locationPermission = "prompt";
  locationWorks = true;
  locationRequests = 0;
  locationCallbacks = null;
  globalThis.location = { search, hostname };
  globalThis.document = {
    getElementById: (id) => (elements[id] ??= makeElement()),
    createElement: () => makeElement(),
    addEventListener: (type, handler) => (pageHandlers[type] = handler),
  };
  // A fresh copy of the app each time (the ?number makes Node load it again).
  await import(`../public/js/app.js?run=${++appVersion}`);
  // Don't wait for the click to finish: Nion starts speaking, and the pretend
  // voice only finishes when a test says so.
  // With voice: false the person never taps "Turn on Nion", so only typing is available.
  if (voice) elements.start.click();
  await tick();
}

// Pretend the person typed a question into the box and pressed Send.
async function typeIn(text) {
  elements["typed-input"].value = text;
  elements.typed.handlers.submit({ preventDefault() {} });
  await tick();
}

// Pretend the person said something. Chrome reports half-heard words (interim)
// first, then the finished phrase (final).
async function hear(text, { final = true } = {}) {
  const result = [{ transcript: text }];
  result.isFinal = final;
  FakeRecognition.last.onresult({ resultIndex: 0, results: [result] });
  await tick();
}

// Pretend the voice finished reading everything it was given.
async function finishSpeaking() {
  const finished = pending;
  pending = [];
  finished.forEach((u) => u.onend?.());
  await tick();
}

const status = () => elements.status.textContent;
// Nion reads one sentence at a time, so check everything said so far as one text.
const saidSoFar = () => spoken.join(" ");

// --- The tests ----------------------------------------------------------------

test("first use: Nion asks for a name and remembers it", async () => {
  await startApp();
  assert.match(saidSoFar(), /What should I call you/);
  await finishSpeaking();
  assert.match(status(), /Listening for your name/);

  await hear("Sanjeev");
  assert.equal(storage.get("nion.name"), "Sanjeev");
  assert.match(saidSoFar(), /Nice to meet you, Sanjeev/);
});

test("a question gets a spoken answer, greeting the person by name", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what time is it in Denver");

  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].body.context.userName, "Sanjeev");
  assert.equal(fetches[0].body.context.isNewConversation, true);

  fetches[0].reply("Hey Sanjeev, it's one seventeen in Denver right now.");
  await tick();
  assert.match(spoken.at(-1), /one seventeen/);
  assert.match(status(), /Speaking/);
});

test("interrupting while Nion speaks stops it and listens", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what time is it in Denver");
  fetches[0].reply("It's one seventeen in Denver right now.");
  await tick();
  assert.equal(pending.length, 1, "Nion is speaking");

  // Nion's own voice coming back through the microphone is not an interruption.
  await hear("one seventeen in Denver", { final: false });
  assert.equal(pending.length, 1, "still speaking after hearing its own voice");

  // Someone actually talking is.
  await hear("wait actually", { final: false });
  assert.equal(pending.length, 0, "Nion stopped talking");
  assert.match(status(), /Listening/);

  // What they say next is treated as the question, with no wake phrase needed.
  await hear("what about Mumbai");
  assert.equal(fetches.length, 2);
  assert.equal(fetches[1].body.messages.at(-1).content, "what about Mumbai");
});

test("interrupting while Nion is thinking cancels the request", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the weather like");
  assert.match(status(), /Thinking/);

  await hear("never mind", { final: false });
  assert.equal(fetches[0].aborted, true, "the request was cancelled");
  assert.match(status(), /Listening/);

  // The answer to the cancelled question must not be spoken.
  const spokenBefore = spoken.length;
  fetches[0].reply("It's sunny.");
  await tick();
  assert.equal(spoken.length, spokenBefore);
});

test("in a conversation, follow-ups need no wake phrase and it can be ended by voice", async () => {
  await startApp({ name: "Sanjeev" });

  await hear("hey nion let's start a conversation");
  assert.match(saidSoFar(), /Hey Sanjeev, I'm listening/);
  await finishSpeaking();
  assert.match(status(), /In a conversation/);

  await hear("what is the time in Denver");
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].body.context.isNewConversation, false, "already greeted, so no new greeting");
  fetches[0].reply("It's one seventeen in the afternoon.");
  await tick();
  await finishSpeaking();

  await hear("and in Mumbai");
  assert.equal(fetches.length, 2);
  assert.equal(fetches[1].body.messages.length, 3, "Claude gets the earlier turns too");
  fetches[1].reply("It's just before one in the morning.");
  await tick();
  await finishSpeaking();

  await hear("I just want to end the conversation");
  // Check everything Nion said, not just its last sentence: a goodbye can be more than one.
  assert.match(saidSoFar(), /talk soon/);
  await finishSpeaking();
  assert.match(status(), /Waiting\. Say/);

  // Outside a conversation, speech without the wake phrase is ignored again.
  await hear("what time is it");
  assert.equal(fetches.length, 2);
});

test("after an answer there is a 15 second window for a follow-up with no wake phrase", async () => {
  await startApp({ name: "Sanjeev" });

  await hear("hey nion what is the time in Denver");
  fetches[0].reply("Hey Sanjeev, it's one seventeen in Denver right now.");
  await tick();
  await finishSpeaking();
  assert.match(status(), /follow-up/i);

  // No "Hey Nion" this time, and Claude gets the earlier turns too.
  await hear("and in Mumbai");
  assert.equal(fetches.length, 2);
  assert.equal(fetches[1].body.messages.length, 3);
  assert.equal(fetches[1].body.context.isNewConversation, false, "no second greeting");
  fetches[1].reply("It's just before one in the morning.");
  await tick();
  await finishSpeaking();

  // After 15 quiet seconds the window closes and the wake phrase is needed again.
  firePending(15000);
  await tick();
  assert.match(status(), /Waiting\. Say/);
  await hear("what time is it");
  assert.equal(fetches.length, 2, "ignored, because the window had closed");

  // And a fresh question after that is a new conversation with a greeting.
  await hear("hey nion what is the date");
  assert.equal(fetches.length, 3);
  assert.equal(fetches[2].body.context.isNewConversation, true);
  assert.equal(fetches[2].body.messages.length, 1, "starts again with no earlier turns");
});

test("talking during the window keeps it open", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the time in Denver");
  fetches[0].reply("It's one seventeen in Denver right now.");
  await tick();
  await finishSpeaking();

  const waitingForClose = () => [...scheduled].filter((e) => e.ms === 15000).length;
  assert.equal(waitingForClose(), 1, "one 15 second timer is running");
  await hear("and in", { final: false }); // you start talking
  assert.equal(waitingForClose(), 1, "restarted, not duplicated");
});

test("the listening icon shows as soon as someone talks to Nion, and goes away if it wasn't for Nion", async () => {
  await startApp({ name: "Sanjeev" });
  assert.match(status(), /Waiting\. Say/);

  // Chatter that isn't for Nion does not flash the listening icon.
  await hear("so anyway I told him that", { final: false });
  assert.match(status(), /Waiting\. Say/);

  // The wake phrase being heard does, even before the sentence is finished.
  await hear("hey nion what is", { final: false });
  assert.match(status(), /Listening/);

  // ...and if the finished sentence turns out not to be for Nion, it goes back to waiting.
  await hear("so anyway I was saying");
  assert.match(status(), /Waiting\. Say/);
  assert.equal(fetches.length, 0);
});

test("in the follow-up window, any speech shows the listening icon", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the time in Denver");
  fetches[0].reply("It's one seventeen in Denver right now.");
  await tick();
  await finishSpeaking();
  assert.match(status(), /follow-up/i);

  await hear("and in", { final: false });
  assert.match(status(), /Listening/);
});

const FILLER = /One moment|Let me check|Checking on that|Just a second/;

test("a slow answer gets a short 'one moment' first, and the answer waits for it to finish", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  assert.equal(fetches.length, 1);

  // Two seconds pass and Claude is still searching.
  firePending(2200);
  await tick();
  assert.match(saidSoFar(), FILLER);

  // The answer arrives while "one moment" is still being spoken: it must wait.
  fetches[0].reply("According to Reuters, talks resumed today.");
  await tick();
  assert.doesNotMatch(saidSoFar(), /Reuters/);

  await finishSpeaking(); // "one moment" ends
  await tick();
  assert.match(saidSoFar(), /According to Reuters/);
});

test("a quick answer gets no 'one moment'", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the capital of Australia");
  fetches[0].reply("It's Canberra.");
  await tick();
  assert.doesNotMatch(saidSoFar(), FILLER);
  assert.match(saidSoFar(), /Canberra/);

  // The "one moment" timer was cancelled, so it can't fire late.
  firePending(2200);
  await tick();
  assert.doesNotMatch(saidSoFar(), FILLER);
});

test("interrupting during 'one moment' cancels the request", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  firePending(2200);
  await tick();
  assert.match(saidSoFar(), FILLER);

  await hear("wait actually", { final: false });
  assert.equal(fetches[0].aborted, true);
  assert.equal(pending.length, 0, "the 'one moment' stopped too");
});

const PLACES_QUESTION = "hey nion what are some places to eat around me";

test("a question that needs a location: Nion asks out loud, then answers once told where", async () => {
  await startApp({ name: "Sanjeev" });
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();

  assert.match(saidSoFar(), /use my location/i);
  assert.match(saidSoFar(), /tell me where you are/i);
  await finishSpeaking();
  assert.match(status(), /where you are/i);

  await hear("I'm in Brickell, Miami");
  assert.equal(fetches.length, 2, "the question was asked again");
  assert.equal(fetches[1].body.messages.at(-1).content, "what are some places to eat around me");
  assert.deepEqual(fetches[1].body.location, { text: "Brickell, Miami" });
  assert.equal(fetches[1].body.messages.length, 1, "the unanswered question is not counted twice");

  fetches[1].reply("Here are five places, cheapest first.");
  await tick();
  assert.match(saidSoFar(), /five places/);
  await finishSpeaking();

  // The place is remembered, so the next question doesn't need asking again.
  await hear("and where is good for coffee");
  assert.deepEqual(fetches[2].body.location, { text: "Brickell, Miami" });
});

test("saying 'use my location' shares the device location, and the place it worked out is remembered", async () => {
  await startApp({ name: "Sanjeev" });
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();
  await finishSpeaking();

  await hear("use my location");
  await tick();
  assert.equal(locationRequests, 1);
  assert.equal(fetches.length, 2);
  assert.deepEqual(fetches[1].body.location, { lat: 25.7617, lon: -80.1918 });

  fetches[1].respond({ reply: "Here are five places.", place: "Brickell, Miami, Florida, US" });
  await tick();
  await finishSpeaking();

  // Follow-ups keep sending the exact position, so they still get real walking times.
  await hear("and where is good for coffee");
  assert.deepEqual(fetches[2].body.location, { lat: 25.7617, lon: -80.1918 });
});

test("if the person has already allowed location, Nion just uses it without asking", async () => {
  await startApp({ name: "Sanjeev" });
  locationPermission = "granted";
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();

  assert.equal(locationRequests, 1);
  assert.equal(fetches.length, 2);
  assert.deepEqual(fetches[1].body.location, { lat: 25.7617, lon: -80.1918 });
  assert.doesNotMatch(saidSoFar(), /use my location/i, "it did not ask out loud");
});

test("if location is denied, Nion asks them to say where they are instead", async () => {
  await startApp({ name: "Sanjeev" });
  locationWorks = false;
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();
  await finishSpeaking();

  await hear("use my location");
  await tick();
  assert.match(saidSoFar(), /couldn't get your location/i);
  await finishSpeaking();

  await hear("Denver");
  assert.deepEqual(fetches[1].body.location, { text: "Denver" });
});

test("after two answers that aren't a place, Nion gives up on the location", async () => {
  await startApp({ name: "Sanjeev" });
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();
  await finishSpeaking();

  await hear("what time is it");
  assert.match(saidSoFar(), /Which city are you in/);
  await finishSpeaking();

  await hear("what time is it");
  assert.match(saidSoFar(), /skip the location/);
  assert.equal(fetches.length, 1, "the waiting question was dropped");
});

const saved = () => JSON.parse(storage.get("nion.conversations") ?? "[]");

test("answered questions are saved for History; follow-ups join the same conversation", async () => {
  await startApp({ name: "Sanjeev" });
  assert.equal(saved().length, 0);

  await hear("hey nion what is the time in Denver");
  assert.equal(saved().length, 0, "nothing is saved until the question is answered");
  fetches[0].respond({ reply: "It's one in Denver.", sources: [{ title: "Time.is", url: "https://time.is" }] });
  await tick();
  await finishSpeaking();
  assert.equal(saved().length, 1);
  assert.deepEqual(saved()[0].turns.map((t) => t.text), ["what is the time in Denver", "It's one in Denver."]);
  assert.equal(saved()[0].turns[1].sources[0].title, "Time.is");

  // A follow-up in the window is part of the same conversation.
  await hear("and in Mumbai");
  fetches[1].reply("It's midnight.");
  await tick();
  await finishSpeaking();
  assert.equal(saved().length, 1);
  assert.equal(saved()[0].turns.length, 4);

  // Once the window has closed, a new question starts a new conversation.
  firePending(15000);
  await tick();
  await hear("hey nion what is the date");
  fetches[2].reply("It's Sunday.");
  await tick();
  assert.equal(saved().length, 2);
});

test("a question that was interrupted before it was answered is not saved", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  await hear("wait actually", { final: false });
  assert.equal(fetches[0].aborted, true);
  assert.equal(saved().length, 0);
});

test("when the server has a problem, Nion says so out loud and nothing is saved", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  fetches[0].serverError();
  await tick();

  assert.match(saidSoFar(), /having trouble reaching my sources/i);
  assert.match(elements.problem.textContent, /couldn't get an answer/i);
  assert.equal(saved().length, 0);
  await finishSpeaking();
  assert.match(status(), /Waiting\. Say/, "back to waiting, not stuck on thinking");
});

test("an answer that takes more than 25 seconds is given up on, out loud", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  assert.match(status(), /Thinking/);

  firePending(25000);
  await tick();
  assert.equal(fetches[0].aborted, true, "the slow request was cancelled");
  assert.match(saidSoFar(), /having trouble reaching my sources/i);
});

test("a 'one moment' that was already being spoken finishes before the trouble message", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  firePending(2200);
  await tick();
  assert.match(saidSoFar(), FILLER);

  fetches[0].serverError();
  await tick();
  assert.doesNotMatch(saidSoFar(), /trouble/, "waits for the filler to end");
  await finishSpeaking();
  await tick();
  assert.match(saidSoFar(), /trouble/);
});

test("when the API credit has run out, the owner's screen says so, and Nion tells a listener it is resting", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  fetches[0].serverError("credit");
  await tick();

  assert.match(elements.problem.textContent, /credit has run out/i);
  assert.match(elements.problem.textContent, /Plans & Billing/);
  assert.match(saidSoFar(), /I'm resting for now/i);
  assert.doesNotMatch(saidSoFar(), /credit|billing|key/i, "billing details are not read out to a listener");
});

test("on a public address, a visitor never sees billing details, only that Nion is resting", async () => {
  await startApp({ name: "Sanjeev", hostname: "nion.example.com" });
  await hear("hey nion what is the latest news");
  fetches[0].serverError("credit");
  await tick();
  assert.equal(elements.problem.textContent, "");
  assert.equal(elements.reply.textContent, "I'm resting for now. This demo has reached its limit for today, so please try again later.");
});

test("each limit the server reports has its own polite line", async () => {
  const lines = {
    "slow-down": /Give me a minute/,
    full: /lot of questions right now/,
    budget: /reached its limit for today/,
    quota: /recommendation service has reached its limit/,
  };
  for (const [reason, pattern] of Object.entries(lines)) {
    await startApp({ voice: false, hostname: "nion.example.com" });
    await typeIn("anything");
    fetches[0].serverError(reason);
    await tick();
    assert.match(elements.reply.textContent, pattern, reason);
  }
});

test("every question carries the browser's anonymous visitor id, the same one each time", async () => {
  await startApp({ voice: false });
  await typeIn("first");
  fetches[0].reply("One.");
  await tick();
  await typeIn("second");
  const ids = fetches.map((call) => call.headers["X-Nion-Visitor"]);
  assert.match(ids[0], /^[a-f0-9-]{36}$/i);
  assert.equal(ids[0], ids[1]);
});

test("a rejected API key is explained on screen", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  fetches[0].serverError("key");
  await tick();
  assert.match(elements.problem.textContent, /ANTHROPIC_API_KEY/);
});

test("pressing Escape stops Nion while it is speaking, and then it listens", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what time is it in Denver");
  fetches[0].reply("It's one seventeen in Denver right now, and the weather there is clear.");
  await tick();
  assert.equal(pending.length, 1, "Nion is speaking");

  pageHandlers.keydown({ key: "Escape" });
  await tick();
  assert.equal(pending.length, 0, "stopped");
  assert.match(status(), /Listening/);
});

test("tapping the circle stops Nion, and Escape does nothing when Nion is idle", async () => {
  await startApp({ name: "Sanjeev" });
  pageHandlers.keydown({ key: "Escape" }); // nothing is happening: no effect
  await tick();
  assert.match(status(), /Waiting\. Say/);

  await hear("hey nion what is the latest news");
  assert.match(status(), /Thinking/);
  elements.orb.click();
  await tick();
  assert.equal(fetches[0].aborted, true, "the request was cancelled");
  assert.match(status(), /Listening/);
});

test("the live 'what Chrome heard' line is hidden unless ?debug is in the address", async () => {
  await startApp({ name: "Sanjeev" });
  assert.equal(elements.heard.hidden, true);
  await hear("hey nion what is the date", { final: false });
  assert.equal(elements.heard.textContent, "", "nothing is shown to viewers");

  await startApp({ name: "Sanjeev", search: "?debug" });
  assert.equal(elements.heard.hidden, false);
  await hear("hey nion what is the date", { final: false });
  assert.match(elements.heard.textContent, /what is the date/);
});

test("?reset forgets the name and clears History, so a demo starts fresh", async () => {
  storage = new Map([["nion.conversations", JSON.stringify([{ id: "c1", startedAt: 1, turns: [] }])]]);
  elements = {};
  pageHandlers = {};
  spoken = [];
  pending = [];
  fetches = [];
  globalThis.location = { search: "?reset" };
  storage.set("nion.name", "Sanjeev Neon");
  globalThis.document = { getElementById: (id) => (elements[id] ??= makeElement()), addEventListener: () => {} };
  await import(`../public/js/app.js?run=${++appVersion}`);
  assert.equal(storage.get("nion.name"), undefined);
  assert.equal(storage.get("nion.conversations"), undefined);
});

test("a single stray word heard while Nion is talking does not cut it off", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what are some places to eat near me");
  fetches[0].reply("Here are five places. Mizumi Ramen is affordable Japanese. Cafe Rio is cheap Mexican.");
  await tick();
  const speakingBefore = pending.length;
  assert.ok(speakingBefore > 0, "Nion is speaking");

  // Chrome mishears one word of Nion's own voice, as the finished phrase.
  await hear("Brett");
  assert.equal(pending.length, speakingBefore, "still speaking");
  assert.equal(fetches.length, 1, "nothing was asked");
  assert.match(status(), /Speaking/);

  // A real interruption (a stop word, or a real phrase) still works.
  await hear("what about Mumbai");
  assert.equal(pending.length, 0, "stopped");
  assert.equal(fetches.length, 2);
});

// The person clicks "Allow" in the browser's location pop-up.
const clickAllow = () => locationCallbacks.success({ coords: { latitude: 25.7617, longitude: -80.1918 } });

test("while the browser is asking for location permission, whatever is heard is ignored and the question is asked once", async () => {
  await startApp({ name: "Sanjeev" });
  locationWorks = "later"; // the pop-up is open and the person hasn't clicked yet
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();
  await finishSpeaking();

  await hear("use my location");
  await tick();
  assert.equal(locationRequests, 1);

  // The person talks while the pop-up is open (or Nion's own voice is heard).
  await hear("I turned on my location");
  await hear("sure one moment");
  assert.equal(fetches.length, 1, "nothing new was asked while waiting for the pop-up");

  clickAllow();
  await tick();
  assert.equal(fetches.length, 2, "the waiting question was asked, once");
  assert.deepEqual(fetches[1].body.location, { lat: 25.7617, lon: -80.1918 });
});

test("stopping Nion while the location pop-up is open drops the question", async () => {
  await startApp({ name: "Sanjeev" });
  locationWorks = "later";
  await hear(PLACES_QUESTION);
  fetches[0].needLocation();
  await tick();
  await finishSpeaking();
  await hear("use my location");
  await tick();

  pageHandlers.keydown({ key: "Escape" });
  await tick();
  clickAllow();
  await tick();
  assert.equal(fetches.length, 1, "the question was dropped, not asked after all");
});

test("an answer is not held up for ever if the 'one moment' never finishes", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  firePending(2200);
  await tick();
  assert.match(saidSoFar(), FILLER);
  // (the pretend voice never reports that "one moment" ended)

  fetches[0].reply("According to Reuters, talks resumed.");
  await tick();
  assert.doesNotMatch(saidSoFar(), /Reuters/, "still giving the filler a moment to finish");

  firePending(3000); // it has waited long enough
  await tick();
  assert.match(saidSoFar(), /According to Reuters/);
});

test("Nion's own 'one moment', written into the same phrase as yours, is not taken as input", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what is the latest news");
  firePending(2200);
  await tick();
  const filler = saidSoFar().match(FILLER)[0];

  await hear(`${filler.toLowerCase()} sure`);
  assert.equal(fetches.length, 1, "no new question, and the waiting one was not cancelled");
  fetches[0].reply("According to Reuters, talks resumed.");
  await tick();
  await finishSpeaking();
  await tick();
  assert.match(saidSoFar(), /According to Reuters/);
});

// ---------- typing to Nion ----------

const iconState = () => elements.orb.dataset.state;
const picksShown = () => elements.picks.hidden === false && elements["picks-list"].children.length;

test("typing works with voice off: the answer appears as text, nothing is spoken", async () => {
  await startApp({ name: "Sanjeev", voice: false });
  assert.match(status(), /Type a question below/);

  await typeIn("what time is it in Denver");
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].body.messages.at(-1).content, "what time is it in Denver");
  assert.equal(fetches[0].body.context.isNewConversation, true);
  assert.equal(iconState(), "thinking");
  assert.equal(elements["you-said"].textContent, "You: what time is it in Denver");

  fetches[0].reply("Hey Sanjeev, it's one seventeen in Denver.");
  await tick();
  assert.equal(elements.reply.textContent, "Hey Sanjeev, it's one seventeen in Denver.");
  assert.equal(elements["reply-card"].hidden, false);
  assert.deepEqual(spoken, [], "nothing is read aloud when voice is off");
  assert.equal(iconState(), "off", "the icon goes back to resting");
});

test("typing with voice on is answered in text and out loud", async () => {
  await startApp({ name: "Sanjeev" });
  await finishSpeaking();
  await typeIn("what time is it in Denver");
  fetches[0].reply("It's one seventeen.");
  await tick();
  assert.equal(elements.reply.textContent, "It's one seventeen.");
  assert.match(spoken.at(-1), /one seventeen/);
});

test("typed follow-ups carry on the same conversation, and it is not wiped after the voice window", async () => {
  await startApp({ name: "Sanjeev", voice: false });
  await typeIn("I love ramen. Where should I eat?");
  fetches[0].reply("Try Sample Bar.");
  await tick();

  firePending(15000); // the voice follow-up window would close now, but there is no voice
  await typeIn("and for dessert?");
  assert.equal(fetches.length, 2);
  assert.equal(fetches[1].body.context.isNewConversation, false);
  assert.deepEqual(
    fetches[1].body.messages.map((m) => m.role),
    ["user", "assistant", "user"]
  );
});

test("what Nion suggested is listed under the answer, and cleared by the next question", async () => {
  await startApp({ voice: false });
  await typeIn("music like Radiohead");
  fetches[0].respond({
    reply: "Try Sample Artist One and Sample Artist Two.",
    suggestions: [{ name: "Sample Artist One", fit: "an excellent fit" }, { name: "Sample Artist Two" }],
    about: { kind: "artist", likes: ["Radiohead"], only: [] },
  });
  await tick();
  assert.equal(picksShown(), 2);
  assert.equal(elements["picks-title"].textContent, "Music");
  assert.equal(elements["picks-because"].textContent, "Because you like Radiohead");

  await typeIn("and films?");
  assert.equal(elements.picks.hidden, true, "the old list is gone while the new question is answered");
});

test("an answer with no suggestions shows no list", async () => {
  await startApp({ voice: false });
  await typeIn("what time is it");
  fetches[0].reply("Noon.");
  await tick();
  assert.equal(elements.picks.hidden, true);
});

test("typing a new question while Nion is still thinking cancels the old one", async () => {
  await startApp({ voice: false });
  await typeIn("first question");
  await typeIn("second question");
  assert.equal(fetches[0].aborted, true);
  assert.equal(fetches.length, 2);
  fetches[1].reply("Answer to the second.");
  await tick();
  assert.equal(elements.reply.textContent, "Answer to the second.");
  assert.equal(iconState(), "off");
});

test("when Nion needs a location, a typed place is accepted and the question is asked again", async () => {
  await startApp({ voice: false });
  await typeIn("where should I eat around here?");
  fetches[0].needLocation();
  await tick();
  assert.match(elements.reply.textContent, /can't tell where you are/i);

  await typeIn("Miami");
  assert.equal(fetches.length, 2);
  assert.deepEqual(fetches[1].body.location, { text: "Miami" });
  assert.equal(fetches[1].body.messages.at(-1).content, "where should I eat around here?");
});

test("a failed typed question shows the trouble message and settles", async () => {
  await startApp({ voice: false });
  await typeIn("anything");
  fetches[0].serverError("busy");
  await tick();
  assert.match(elements.reply.textContent, /trouble reaching my sources/i);
  assert.equal(iconState(), "off");
});

test("an empty box sends nothing", async () => {
  await startApp({ voice: false });
  await typeIn("   ");
  assert.equal(fetches.length, 0);
});

// ---------- the Stop button ----------

test("the Stop button shows only while Nion is thinking or speaking", async () => {
  await startApp({ name: "Sanjeev" });
  assert.equal(elements.stop.hidden, true, "nothing to stop while waiting");

  await hear("hey nion what time is it in Denver");
  assert.equal(elements.stop.hidden, false, "shown while thinking");
  fetches[0].reply("It's one seventeen.");
  await tick();
  assert.equal(elements.stop.hidden, false, "shown while speaking");

  await finishSpeaking();
  assert.equal(elements.stop.hidden, true, "gone again once Nion has finished");
});

test("Stop while Nion is speaking cuts it off and listens, even if your voice cannot be heard", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what time is it in Denver");
  fetches[0].reply("It's one seventeen in Denver right now.");
  await tick();
  assert.equal(pending.length, 1, "Nion is speaking");

  elements.stop.click();
  await tick();
  assert.equal(pending.length, 0, "the voice stopped");
  assert.match(status(), /Listening/);
  assert.equal(elements.stop.hidden, true);
});

test("Stop while Nion is thinking cancels the question", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what are some places to eat around me");
  assert.equal(fetches.length, 1);

  elements.stop.click();
  await tick();
  assert.equal(fetches[0].aborted, true);
  assert.match(status(), /Listening/);
});

test("Stop works when only typing: it cancels the question and rests the screen", async () => {
  await startApp({ voice: false });
  await typeIn("tell me something long");
  assert.equal(elements.stop.hidden, false);

  elements.stop.click();
  await tick();
  assert.equal(fetches[0].aborted, true);
  assert.equal(iconState(), "off");
  assert.equal(elements.reply.textContent, "Stopped.");
  assert.equal(elements.stop.hidden, true);

  // The question that was stopped does not come back, and the next one works.
  await typeIn("hello again");
  fetches[1].reply("Hi.");
  await tick();
  assert.equal(elements.reply.textContent, "Hi.");
  assert.equal(iconState(), "off");
});

test("pressing Stop when Nion is idle does nothing", async () => {
  await startApp({ name: "Sanjeev" });
  elements.stop.click();
  await tick();
  assert.match(status(), /Waiting|Say/);
});

// ---------- found in a real debug log (speakers, no earphones) ----------

test("'end the conversation' stuck on the end of Nion's own voice still ends it", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what do you suggest");
  fetches[0].reply("What sounds good right now? Something hearty, or something light?");
  await tick();
  await finishSpeaking();
  const before = spoken.length;

  // Chrome wrote Nion's last words and yours as one phrase. This used to be ignored, so you had to say it twice.
  await hear("what sounds good right now something hearty or something light and the conversation");
  assert.ok(spoken.length > before, "Nion answered");
  assert.match(spoken.slice(before).join(" "), /talk soon/i);
});

test("hearing its own 'you can say end the conversation' back never ends the conversation", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion how do I stop you");
  fetches[0].reply("You can say end the conversation whenever you're done.");
  await tick();
  await finishSpeaking();
  const before = spoken.length;

  await hear("you can say end the conversation whenever you're done");
  assert.equal(spoken.length, before, "Nion said nothing new: it knew that was its own voice");
});

test("after ignoring its own voice, the icon goes back from 'listening' to waiting", async () => {
  await startApp({ name: "Sanjeev" });
  await hear("hey nion what do you suggest");
  fetches[0].reply("Something hearty or something light?");
  await tick();
  await finishSpeaking();
  assert.match(status(), /still listening for a follow-up/);

  // A misheard word of Nion's own voice ("like" for "light") flips the icon to listening...
  await hear("something like", { final: false });
  assert.match(status(), /Listening/);
  // ...and when the phrase finishes and is ignored as an echo, it must not stay stuck there.
  await hear("something hearty or something like");
  assert.match(status(), /still listening for a follow-up/);
});

// ---------- suggestions to tap ----------

const tapChip = async (text) => {
  elements.chips.handlers.click({ target: { dataset: { say: text } } });
  await tick();
};

test("tapping a suggestion asks it, exactly as if it had been typed", async () => {
  await startApp({ voice: false });
  await tapChip("Music like Radiohead");
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].body.messages.at(-1).content, "Music like Radiohead");
  assert.equal(elements["you-said"].textContent, "You: Music like Radiohead");
  fetches[0].reply("Try these.");
  await tick();
  assert.equal(elements.reply.textContent, "Try these.");
});

test("a suggestion works with voice on, too, and is spoken", async () => {
  await startApp({ name: "Sanjeev" });
  await finishSpeaking();
  await tapChip("I'm hungry");
  fetches[0].reply("What kind of food do you love?");
  await tick();
  assert.match(spoken.at(-1), /What kind of food/);
});

test("tapping a second suggestion while the first is still being answered cancels the first", async () => {
  await startApp({ voice: false });
  await tapChip("I'm hungry");
  await tapChip("Films like Blade Runner 2049");
  assert.equal(fetches[0].aborted, true);
  assert.equal(fetches[1].body.messages.at(-1).content, "Films like Blade Runner 2049");
});

test("tapping something that is not a suggestion does nothing", async () => {
  await startApp({ voice: false });
  elements.chips.handlers.click({ target: { dataset: {} } });
  elements.chips.handlers.click({ target: {} });
  await tick();
  assert.equal(fetches.length, 0);
});

test("each pick shows Qloo's own reason, as text", async () => {
  await startApp({ voice: false });
  await typeIn("what would I like");
  fetches[0].respond({
    reply: "Try the museum.",
    suggestions: [{ name: "Museum", because: [{ name: "Radiohead", share: 0.54 }, { name: "Blade Runner 2049", share: 0.46 }] }],
    about: { kind: "place", likes: ["Radiohead", "Blade Runner 2049"], only: [] },
  });
  await tick();
  const lines = elements["picks-list"].children[0].children.map((node) => node.textContent);
  assert.ok(lines.includes("Qloo matched this through Radiohead (54%) and Blade Runner 2049 (46%)"), lines.join(" | "));
});

test("each pick shows its opening hours, as text, when they are known", async () => {
  await startApp({ voice: false });
  await typeIn("somewhere open now");
  fetches[0].respond({
    reply: "Try the bistro.",
    suggestions: [{ name: "Bistro", open: true, hours: "Open until 10 pm" }, { name: "Cafe", open: false, hours: "Closed now, opens at 11 am" }, { name: "Diner" }],
    about: { kind: "place", likes: [], only: [], avoid: [] },
  });
  await tick();
  const cards = elements["picks-list"].children;
  const lines = (card) => card.children.map((node) => node.textContent);
  assert.ok(lines(cards[0]).includes("Open until 10 pm"));
  assert.ok(lines(cards[1]).includes("Closed now, opens at 11 am"));
  assert.equal(cards[0].children.find((n) => n.textContent === "Open until 10 pm").className, "pick-line pick-hours is-open");
  assert.equal(cards[1].children.find((n) => n.textContent.startsWith("Closed")).className, "pick-line pick-hours is-closed");
  assert.ok(!lines(cards[2]).some((t) => /^open until|^open 24|^closed now/i.test(t)), "a place with no hours claims nothing");
});

// ---------- the shorter first-picks path ----------

test("when Nion needs a location, one-tap place buttons appear, and a tap answers it", async () => {
  await startApp({ voice: false });
  await typeIn("where should I eat around here?");
  fetches[0].needLocation();
  await tick();
  assert.equal(elements["place-chips"].hidden, false, "shown while Nion waits to be told where you are");

  elements["place-chips"].handlers.click({ target: { dataset: { say: "Lisbon" } } });
  await tick();
  assert.deepEqual(fetches[1].body.location, { text: "Lisbon" });
  assert.equal(fetches[1].body.messages.at(-1).content, "where should I eat around here?", "the waiting question is asked again");
  assert.equal(elements["place-chips"].hidden, true, "gone once it has been answered");
});

test("tapping 'Use my location' asks the browser for it", async () => {
  await startApp({ voice: false });
  await typeIn("places near me");
  fetches[0].needLocation();
  await tick();
  elements["place-chips"].handlers.click({ target: { dataset: { say: "use my location" } } });
  await tick();
  assert.equal(locationRequests, 1);
  assert.deepEqual(fetches[1].body.location, { lat: 25.7617, lon: -80.1918 });
});

test("the place buttons are not there when Nion is not waiting for a place", async () => {
  await startApp({ voice: false });
  await typeIn("what time is it");
  fetches[0].reply("Noon.");
  await tick();
  assert.equal(elements["place-chips"].hidden, true);
});

test("a slow answer says honestly, on screen, that it is still working", async () => {
  await startApp({ voice: false });
  await typeIn("music like Radiohead");
  assert.equal(elements.reply.textContent, "…");
  firePending(2500);
  assert.equal(elements.reply.textContent, "Looking this up. It can take a few seconds.");
  assert.equal(elements["you-said"].textContent, "You: music like Radiohead", "the question is still shown");
  fetches[0].reply("Try these.");
  await tick();
  assert.equal(elements.reply.textContent, "Try these.", "the real answer replaces it");
});

test("a quick answer never shows the slow note", async () => {
  await startApp({ voice: false });
  await typeIn("what time is it");
  fetches[0].reply("Noon.");
  await tick();
  firePending(2500); // the timer was cancelled, so nothing happens
  assert.equal(elements.reply.textContent, "Noon.");
});

test("an interrupted question does not leave its slow note on the screen", async () => {
  await startApp({ voice: false });
  await typeIn("first question");
  await typeIn("second question");
  firePending(2500);
  assert.equal(elements["you-said"].textContent, "You: second question");
});
