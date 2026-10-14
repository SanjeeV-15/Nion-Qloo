// Speaking. Wraps Chrome's built-in speech synthesis, which reads text aloud
// using a voice that is already on the computer. No account or key needed.

export const speechOutSupported = "speechSynthesis" in window;

// Voices whose names suggest a more natural sound, best first. On a Mac, the
// "Premium" and "Enhanced" voices (a free download in System Settings) sound far
// more human than the basic built-in ones, so they come first. The basic voice
// "Samantha" is the last resort.
const PREFERRED = [
  "Premium",
  "Enhanced",
  "Natural",
  "Google US English",
  "Ava",
  "Zoe",
  "Evan",
  "Allison",
  "Samantha",
];

// Chrome loads its list of voices AFTER the page opens. If Nion speaks before that, it
// gets Chrome's plain default voice (the robotic one), and a moment later the good
// voice, so one conversation has two different voices. So we wait for the list, pick
// the voice once, and keep it for the whole session.
let chosenVoice = null;
let voicesNeverLoaded = false;

function voice() {
  if (!chosenVoice) chosenVoice = pickVoice();
  return chosenVoice;
}

function waitForVoices(maxMs) {
  if (speechSynthesis.getVoices().length > 0 || voicesNeverLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      voicesNeverLoaded = true; // some computers really have none: don't wait again
      resolve();
    }, maxMs);
    speechSynthesis.addEventListener?.("voiceschanged", () => {
      if (speechSynthesis.getVoices().length > 0) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

// Start loading the voices as soon as the page opens.
if (speechOutSupported) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", voice);
}

function pickVoice() {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  for (const hint of PREFERRED) {
    const match = english.find((v) => v.name.includes(hint));
    if (match) return match;
  }
  return english.find((v) => v.lang === "en-US") ?? english[0] ?? null;
}

// How the voice should say "Nion". Speech voices guess at unusual words (left
// alone, this voice said "Nayan"), so we give it a spelling that it says the way
// we want: "Neon" is said "NEE-on", which is how the owner says the name.
const SPOKEN_NAME = "Neon";

// Chrome can cut off a long utterance partway through, so we read one sentence
// at a time.
function splitIntoSentences(text) {
  const pieces = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** Reads `text` aloud. Resolves when Nion has finished speaking. */
export async function speak(text, { voiceWaitMs = 1500 } = {}) {
  if (!speechOutSupported) return;
  await waitForVoices(voiceWaitMs);
  return new Promise((resolve) => {
    speechSynthesis.cancel(); // stop anything still being said

    const chosen = voice();
    const sentences = splitIntoSentences(text.replace(/\bNion\b/g, SPOKEN_NAME));
    let remaining = sentences.length;
    if (remaining === 0) return resolve();

    for (const sentence of sentences) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (chosen) utterance.voice = chosen;
      utterance.lang = chosen?.lang ?? "en-US";
      const done = () => {
        remaining -= 1;
        if (remaining === 0) resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
    }
  });
}

export function stopSpeaking() {
  if (speechOutSupported) speechSynthesis.cancel();
}
