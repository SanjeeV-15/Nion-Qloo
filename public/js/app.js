// The conversation controller: carries out what Nion decides to do.
//
// conversation.js decides ("ask this question", "end the conversation"...).
// This file does the doing: listening, asking the server, speaking, and keeping
// the screen's status line up to date.
//
//   waiting   -> listening for "Hey Nion" (or, in a conversation, for anything you say)
//   listening -> waiting for your question or your name
//   thinking  -> asking Claude
//   speaking  -> reading something aloud
//
// Nion keeps listening in every state. If you start talking while it is thinking
// or speaking, it stops at once and listens to you, like a person would.

import { decide } from "./conversation.js";
import { parseUtterance } from "./wake.js";
import { isEcho, isInterruption, stripLeadingEcho, stripPhrase } from "./echo.js";
import { createListener, speechInSupported } from "./speech-in.js";
import { speak, stopSpeaking, speechOutSupported } from "./speech-out.js";
import { getName, setName, clearName, clearConversations, recordExchange } from "./storage.js";
import { showState } from "./ui.js";
import { geolocationPermission, getDevicePosition } from "./location.js";

const el = {
  start: document.getElementById("start"),
  convo: document.getElementById("convo"),
  status: document.getElementById("status"),
  heard: document.getElementById("heard"),
  problem: document.getElementById("problem"),
  debug: document.getElementById("debug"),
  orb: document.getElementById("orb"),
  copylog: document.getElementById("copylog"),
};

const params = new URLSearchParams(location.search);

// Opening the page with ?reset starts completely fresh: it forgets the saved name and
// all saved conversations (useful before recording a demo).
if (params.has("reset")) {
  clearName();
  clearConversations();
}

// Opening the page with ?debug shows a log of what Nion hears and decides, which
// helps when something doesn't work the way it should.
const debugOn = params.has("debug");
el.heard.hidden = !debugOn; // the live "what Chrome heard" line is for debugging, not for viewers
const traceLines = [];
function trace(kind, detail = "") {
  const t = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${pad(t.getMinutes())}:${pad(t.getSeconds())}.${pad(t.getMilliseconds(), 3)}`;
  const line = `${stamp} ${kind} ${detail}`.trim();
  console.log("[nion]", line);
  if (!debugOn) return;
  traceLines.push(line);
  if (traceLines.length > 150) traceLines.shift();
  el.debug.hidden = false;
  el.copylog.hidden = false;
  el.debug.textContent = traceLines.join("\n");
  el.debug.scrollTop = el.debug.scrollHeight;
}
el.copylog.addEventListener("click", () => navigator.clipboard?.writeText(traceLines.join("\n")));

let state = "off"; // off | waiting | listening | thinking | speaking
const session = {
  active: false, // is a conversation running?
  followUp: false, // is the follow-up window open? (see below)
  awaiting: null, // null | "name" | "question"
};

// After Nion answers, you can ask a follow-up for this long without saying
// "Hey Nion" again. If you stay quiet for this long, Nion goes back to waiting
// for the wake phrase. A shorter window means fewer accidental questions from
// background talk; a longer one is more relaxed.
const FOLLOW_UP_MS = 15000;
let followUpTimer = null;

// If Claude takes longer than this to answer (usually because it is searching the
// web), Nion says a short "one moment" so you know it hasn't stalled. Ordinary
// answers arrive in about 1 to 2 seconds, so they don't trigger it.
const FILLER_AFTER_MS = 2200;

// If there is still no answer after this long, give up and say so, instead of
// sitting on "thinking" for ever. A web search normally takes under 10 seconds.
const ASK_TIMEOUT_MS = 25000;
const TROUBLE = "I'm having trouble reaching my sources. Please try again in a moment.";

// What to show on screen for the person running Nion, by the reason the server gives.
const PROBLEM_TEXT = {
  credit: "Your Claude API credit has run out. Add credit in the Anthropic Console (Plans & Billing), then try again.",
  key: "The Claude API key was rejected. Check ANTHROPIC_API_KEY in your .env file.",
  busy: "Claude is busy right now. Try again in a moment.",
};
const FILLERS = ["One moment.", "Let me check.", "Checking on that.", "Just a second."];
let lastFiller = -1;
function nextFiller() {
  let i;
  do {
    i = Math.floor(Math.random() * FILLERS.length);
  } while (i === lastFiller);
  lastFiller = i;
  return FILLERS[i];
}
let messages = []; // the conversation so far, sent to Claude each time
let conversationId = null; // which saved conversation (for History) the next answer belongs to
let nameTries = 0;

// Where the person is, once we know. It is remembered until the page is closed,
// so Nion doesn't ask again. `pending` is the question that was waiting for a
// location, asked again as soon as we have one.
const known = { place: null };
let pending = null;
// True while the browser's "Allow location?" pop-up is open. Anything heard then is
// Nion's own voice or the person talking to the pop-up, not a new question.
let locating = false;
// The last "one moment" Nion said, so it is never mistaken for the person.
const filler = { text: "", until: 0 };
let placeTries = 0;
let questionTimer = null;

// Interrupting: every spoken line or question gets a "turn" number. If you
// interrupt, the number moves on, and anything still finishing from the old turn
// notices and quietly stops.
let turn = 0;
let abortAsk = null; // lets us cancel a question that is still waiting for Claude
// What Nion said last, and until when its voice may still be coming back through
// the microphone. Chrome reports words a moment late, so this keeps going for a
// few seconds after Nion stops.
const ECHO_TAIL_MS = 3500;
// A "one moment" is only a second or two long. If the voice never reports that it
// finished, the real answer must not wait for it for ever.
const FILLER_WAIT_MS = 3000;
const echo = { text: "", until: 0 };

function statusText() {
  switch (state) {
    case "off": return "Tap the button to turn Nion on.";
    case "waiting":
      if (session.active) return "In a conversation. Just talk, or say “End the conversation.”";
      if (session.followUp) return "Go ahead, I'm still listening for a follow-up.";
      return "Waiting. Say “Hey Nion.”";
    case "listening":
      if (session.awaiting === "name") return "Listening for your name…";
      if (session.awaiting === "place") return "Listening for where you are…";
      return "Listening…";
    case "thinking": return "Thinking…";
    case "speaking": return "Speaking…";
  }
}

function setState(next) {
  if (next !== state) trace("state", `${state} -> ${next}`);
  state = next;
  el.status.textContent = statusText();
  showState(next); // the icon
}

function showProblem(message) {
  el.problem.textContent = message;
  el.problem.hidden = !message;
}

const listener = createListener({
  onText: handleHeard,
  onInterim: handleInterim,
  onProblem: handleProblem,
  onEvent: (name) => trace("mic", name),
});

function handleProblem(reason) {
  if (reason === "mic-blocked") {
    listener.stop();
    setState("off");
    el.start.hidden = false;
    showProblem("Nion can't use the microphone. Allow it in Chrome's address bar, then tap the button again.");
  } else if (reason === "network") {
    showProblem("Chrome's speech recognition needs an internet connection.");
  }
}

// Say something. Listening stays on, so you can interrupt.
async function say(text, { then = "waiting" } = {}) {
  const mine = ++turn;
  echo.text = text;
  echo.until = Infinity; // its voice is coming through the speakers right now
  setState("speaking");
  await speak(text);
  if (mine !== turn) return false; // you interrupted: the new turn has taken over
  echo.until = Date.now() + ECHO_TAIL_MS;
  setState(then);
  return true;
}

// Open (or restart) the follow-up window.
function openFollowUp() {
  if (session.active) return; // a started conversation has no time limit
  const wasOpen = session.followUp;
  session.followUp = true;
  clearTimeout(followUpTimer);
  followUpTimer = setTimeout(closeFollowUp, FOLLOW_UP_MS);
  if (!wasOpen) trace("follow-up window", `open for ${FOLLOW_UP_MS / 1000}s`);
  if (state === "waiting") setState("waiting"); // refresh the status line
}

function closeFollowUp() {
  clearTimeout(followUpTimer);
  if (!session.followUp) return;
  session.followUp = false;
  if (!session.active) {
    messages = []; // that conversation is over
    conversationId = null;
  }
  trace("follow-up window", "closed");
  if (state === "waiting") setState("waiting");
}

// Stop whatever Nion is doing, because you started talking.
function interrupt() {
  trace("interrupt", `was ${state}`);
  turn += 1;
  if (locating) {
    locating = false; // stopped while the pop-up was open: forget the waiting question
    pending = null;
  }
  stopSpeaking();
  abortAsk?.abort();
  echo.until = Date.now() + ECHO_TAIL_MS; // what we cut off may still arrive
  // Outside a started conversation, what you say next is a follow-up to this one.
  if (!session.active && session.awaiting === null) openFollowUp();
  setState("listening");
}

function armQuestionWait() {
  session.awaiting = "question";
  clearTimeout(questionTimer);
  questionTimer = setTimeout(() => {
    if (session.awaiting === "question") session.awaiting = null;
    if (state === "listening") setState("waiting");
  }, 8000);
}

// Words arrive while someone is still speaking. If Nion is busy and it isn't
// just its own voice, stop at once.
let lastInterim = "";
function handleInterim(text) {
  if (session.followUp) openFollowUp(); // you are talking: keep the window open
  // Show what Chrome is hearing right now, before it has finished the phrase.
  if (debugOn) el.heard.textContent = `Hearing: “${text}”`;
  const busy = state === "speaking" || state === "thinking";
  if (locating) return; // waiting for the browser's location pop-up
  const interrupting = busy && isInterruption(text, echo.text);
  if (text !== lastInterim) {
    lastInterim = text;
    trace("interim", `“${text}”${busy ? (interrupting ? " (someone is talking)" : " (Nion's own voice, ignored)") : ""}`);
  }
  if (interrupting) interrupt();

  // Someone is talking to Nion: show the listening icon right away, not only when
  // Chrome has finished the sentence. In wake mode that means the wake phrase was
  // heard; in a conversation or the follow-up window, any speech counts.
  if (!busy && state === "waiting") {
    const forNion = session.active || session.followUp || parseUtterance(text).woke;
    const ownVoice = Date.now() < echo.until && isEcho(text, echo.text);
    if (forNion && !ownVoice) setState("listening");
  }
}

function handleHeard(text) {
  if (!text || state === "off") return;
  if (debugOn) el.heard.textContent = `Heard: “${text}”`;
  lastInterim = "";
  trace("final", `“${text}” (state ${state}, conversation ${session.active ? "on" : "off"}, awaiting ${session.awaiting ?? "nothing"})`);

  // When Nion has just asked you something (your name, where you are), a short
  // answer is expected. It may repeat words from the question ("use my location"),
  // so it must not be mistaken for Nion's own voice. Only a long phrase that is
  // mostly Nion's words is treated as an echo then.
  if (locating) {
    trace("ignored", "waiting for the location pop-up (press Escape to cancel)");
    return;
  }

  // Chrome can write Nion's "one moment" into the same phrase as the person's words.
  if (Date.now() < filler.until) {
    const rest = stripPhrase(text, filler.text);
    if (rest !== text) {
      trace("trimmed", `“${rest}” (took out Nion's "${filler.text}")`);
      if (!rest) return;
      text = rest;
    }
  }

  const expectingAnswer = session.awaiting === "name" || session.awaiting === "place";
  const shortAnswer = expectingAnswer && text.split(/\s+/).filter(Boolean).length < 6;

  // Nion's own voice, coming back through the microphone, is not you talking.
  if (Date.now() < echo.until && !shortAnswer) {
    if (isEcho(text, echo.text)) {
      trace("ignored", "Nion's own voice");
      return;
    }
    const trimmed = stripLeadingEcho(text, echo.text);
    if (trimmed !== text) {
      trace("trimmed", `“${trimmed}”`);
      text = trimmed;
    }
  }

  if (state === "speaking" || state === "thinking") {
    // On laptop speakers Chrome often mishears one word of Nion's own voice (a stray
    // "Brett" in the middle of a list). One odd word is far more likely that than you
    // interrupting, so it is ignored. A stop word ("wait") or a real phrase still counts.
    if (!shortAnswer && !isInterruption(text, echo.text)) {
      trace("ignored", "one stray word while Nion was talking");
      return;
    }
    interrupt();
  }

  const action = decide(session, text);
  trace("decided", JSON.stringify(action));

  switch (action.type) {
    case "ignore":
      // It turned out not to be for Nion: stop showing the listening icon.
      if (state === "listening" && session.awaiting === null) setState("waiting");
      return;

    case "setName":
      return rememberName(action.name);

    case "nameRetry":
      return retryName();

    case "setPlace":
      return rememberPlace(action.place);

    case "useDeviceLocation":
      return useDeviceLocation();

    case "placeRetry":
      return retryPlace();

    case "awaitQuestion":
      armQuestionWait();
      setState("listening");
      return;

    case "start":
      return startConversation();

    case "end":
      return endConversation();

    case "ask":
      session.awaiting = null;
      clearTimeout(questionTimer);
      return ask(action.question, action.oneShot);
  }
}

async function rememberName(name) {
  const first = session.awaiting === "name";
  setName(name);
  session.awaiting = null;
  nameTries = 0;
  await say(
    first
      ? `Nice to meet you, ${name}. Just say “Hey Nion” whenever you want me.`
      : `Okay, I'll call you ${name}.`
  );
}

async function retryName() {
  nameTries += 1;
  if (nameTries >= 2) {
    session.awaiting = null;
    nameTries = 0;
    return say("No problem, we can do names later. Just say “Hey Nion” whenever you want me.");
  }
  await say("Sorry, I didn't catch your name. What should I call you?", { then: "listening" });
}

// A question needs to know where the person is, and we don't. Ask out loud.
async function askForLocation(question, oneShot, lookupFailed = false) {
  pending = { question, oneShot };
  placeTries = 0;

  // If the person already allowed location for this site, just use it quietly.
  if (!lookupFailed && (await geolocationPermission()) === "granted") return useDeviceLocation();

  session.awaiting = "place";
  await say(
    lookupFailed
      ? "I couldn't work out where that is. Just tell me which city you're in."
      : "I can't tell where you are yet. You can say “use my location” and allow it when asked, or just tell me where you are.",
    { then: "listening" }
  );
}

// The person said where they are: remember it and ask the waiting question again.
async function rememberPlace(place) {
  known.place = place;
  session.awaiting = null;
  const waiting = pending;
  pending = null;
  if (waiting) return ask(waiting.question, waiting.oneShot);
  await say(`Okay, I'll remember you're in ${place}.`);
}

// The person said to use their device's location.
async function useDeviceLocation() {
  session.awaiting = null;
  if (!pending) return;
  const mine = ++turn;
  locating = true;
  setState("thinking");
  try {
    const gps = await getDevicePosition();
    if (mine !== turn) return; // stopped while the pop-up was open
    locating = false;
    const waiting = pending;
    pending = null;
    return ask(waiting.question, waiting.oneShot, gps);
  } catch (error) {
    if (mine !== turn) return;
    locating = false;
    trace("location", `couldn't get it: ${error?.message ?? error}`);
    session.awaiting = "place";
    placeTries = 0;
    await say("I couldn't get your location. Just tell me which city you're in.", { then: "listening" });
  }
}

async function retryPlace() {
  placeTries += 1;
  if (placeTries >= 2) {
    session.awaiting = null;
    pending = null;
    placeTries = 0;
    return say("No problem, we can skip the location.");
  }
  await say("Sorry, I didn't catch that. Which city are you in?", { then: "listening" });
}

// The backup button: starts or ends a conversation without needing the wake phrase.
function refreshConvoButton() {
  el.convo.textContent = session.active ? "End conversation" : "Start conversation";
}

async function startConversation() {
  clearTimeout(followUpTimer);
  session.followUp = false;
  session.active = true;
  refreshConvoButton();
  session.awaiting = null;
  messages = [];
  conversationId = null;
  const name = getName();
  await say(name ? `Hey ${name}, I'm listening. Go ahead.` : "I'm listening. Go ahead.");
}

async function endConversation() {
  pending = null;
  clearTimeout(followUpTimer);
  session.followUp = false;
  session.active = false;
  refreshConvoButton();
  session.awaiting = null;
  messages = [];
  conversationId = null;
  await say("Great, talk soon. Take care");
}

// Details about the person's moment, so Nion can answer "what is today's date?".
function currentContext(isNewConversation) {
  const now = new Date();
  return {
    nowISO: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localDateTime: now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    userName: getName() || undefined,
    isNewConversation,
  };
}

async function ask(question, oneShot, gps) {
  const mine = ++turn;
  setState("thinking");
  showProblem("");

  // A question outside any conversation starts a new one (and gets a greeting).
  // Otherwise Claude gets everything said so far, so follow-ups make sense.
  if (oneShot) {
    messages = [];
    conversationId = null;
  }
  const thread = messages;
  thread.push({ role: "user", content: question });

  const controller = new AbortController();
  abortAsk = controller;
  const askTimeout = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  // Waits for a "one moment" to finish, but not for ever.
  const fillerFinished = () =>
    Promise.race([fillerDone, new Promise((resolve) => setTimeout(resolve, FILLER_WAIT_MS))]);

  // If the answer is slow, say a short "one moment". The real answer then waits
  // until that has finished, so the two never overlap.
  let fillerDone = Promise.resolve();
  const fillerTimer = setTimeout(() => {
    if (mine !== turn || state !== "thinking") return; // already answered or interrupted
    const phrase = nextFiller();
    trace("filler", phrase);
    echo.text = phrase;
    echo.until = Infinity;
    filler.text = phrase;
    filler.until = Infinity;
    fillerDone = speak(phrase).then(() => {
      filler.until = Date.now() + ECHO_TAIL_MS;
    });
  }, FILLER_AFTER_MS);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        // Keep only the most recent turns so the request stays small.
        messages: thread.slice(-20),
        // In a started conversation Nion has already greeted you, so only a
        // one-shot question counts as "new" (and gets a greeting by name).
        context: currentContext(oneShot),
        // Fresh GPS numbers, or the place we already know, or nothing.
        location: gps ?? (known.place ? { text: known.place } : undefined),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(new Error(`Server said ${response.status}`), { reason: body.reason });
    }
    const data = await response.json();

    clearTimeout(askTimeout);
    clearTimeout(fillerTimer);
    await fillerFinished(); // let "one moment" finish before the answer starts

    if (mine !== turn) {
      thread.pop(); // you interrupted while Claude was answering: drop that question
      return;
    }

    // The question depends on where the person is, and we don't know yet.
    if (data.needsLocation) {
      thread.pop(); // it'll be asked again once we know
      return askForLocation(question, oneShot, data.locationFailed);
    }

    const { reply } = data;
    if (data.place) known.place = data.place; // worked out from GPS: remember it
    thread.push({ role: "assistant", content: reply });
    // Save it for the History screen (only questions that got an answer).
    conversationId = recordExchange(conversationId, question, reply, data.sources);
    const finished = await say(reply);
    // After an answer, leave the follow-up window open for a moment.
    if (finished && !session.active) openFollowUp();
  } catch (error) {
    clearTimeout(askTimeout);
    clearTimeout(fillerTimer);
    echo.until = Date.now() + ECHO_TAIL_MS; // a "one moment" may have been spoken
    thread.pop(); // the question got no answer, so take it back out
    if (mine !== turn) return; // that was us cancelling because you interrupted
    console.error(error);
    showProblem(
      PROBLEM_TEXT[error?.reason] ??
        "Nion couldn't get an answer. If this keeps happening, check the terminal where npm start is running."
    );
    await fillerFinished(); // let a "one moment" finish before saying this
    await say(TROUBLE);
  }
}

// A manual way to stop Nion, for when your voice can't be heard over its own (on
// laptop speakers the microphone hears Nion too): press Escape, or tap the circle.
function stopNion() {
  if (state === "speaking" || state === "thinking") interrupt();
}
el.orb.addEventListener("click", stopNion);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") stopNion();
});

el.convo.addEventListener("click", () => {
  if (state === "off") return;
  if (state === "speaking" || state === "thinking") interrupt();
  return session.active ? endConversation() : startConversation();
});

el.start.addEventListener("click", async () => {
  if (!speechInSupported || !speechOutSupported) {
    showProblem("This browser can't do speech. Please open Nion in Chrome.");
    return;
  }
  el.start.hidden = true;
  el.convo.hidden = false;
  showProblem("");
  listener.start();

  // First use: Nion asks your name once.
  if (!getName()) {
    session.awaiting = "name";
    await say("Hi, I'm Nion. What should I call you?", { then: "listening" });
  } else {
    setState("waiting");
  }
});

if (!speechInSupported || !speechOutSupported) {
  el.start.hidden = true;
  el.status.textContent = "Nion needs a browser that can do speech.";
  showProblem("This browser can't listen or speak. Please open Nion in Google Chrome.");
}
