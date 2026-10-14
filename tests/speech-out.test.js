// Tests that Nion uses one good voice from the very first word, even though Chrome
// only finishes loading its list of voices a moment after the page opens.

import { test } from "node:test";
import assert from "node:assert/strict";

const robotic = { name: "Fred", lang: "en-US" };
const good = { name: "Ava (Premium)", lang: "en-US" };
const other = { name: "Samantha", lang: "en-US" };

let voices = [];
let listeners = [];
const used = []; // which voice each spoken sentence used

globalThis.window = globalThis;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
globalThis.speechSynthesis = {
  getVoices: () => voices,
  addEventListener: (type, fn) => type === "voiceschanged" && listeners.push(fn),
  cancel() {},
  speak(utterance) {
    used.push(utterance.voice?.name ?? "(browser default)");
    queueMicrotask(() => utterance.onend?.());
  },
};
const loadVoices = (list) => {
  voices = list;
  listeners.forEach((fn) => fn());
};

const { speak } = await import("../public/js/speech-out.js");

test("the first words wait for Chrome's voices, so they use the good voice, not the default", async () => {
  voices = []; // Chrome has not loaded its voices yet
  const speaking = speak("Hi, I'm Nion.");
  setTimeout(() => loadVoices([robotic, other, good]), 30); // a moment later, they load
  await speaking;
  assert.deepEqual(used, ["Ava (Premium)"]);
});

test("the same voice is used for the rest of the session, even if the list changes", async () => {
  loadVoices([other, robotic]); // a different list appears later
  await speak("And another thing.");
  await speak("One more.");
  assert.deepEqual(used, ["Ava (Premium)", "Ava (Premium)", "Ava (Premium)"]);
});
