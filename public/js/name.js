// Works out a person's name from what they said out loud.
//
// People say it in different ways: "Sanjeev", "my name is Sanjeev", "call me
// Sanjeev". We only keep what looks like a short name (one to three words made
// of letters), so the name is safe to use in Nion's instructions later.

const INTRO =
  /\b(?:my name is|my name's|call me|they call me|i am|i'm|it's|it is|this is|name is)\s+(.+)$/i;

// Phrases that start with "I'm" or "it's" are only treated as a name when we are
// asking for one. Otherwise "I'm hungry" would become a name.
const ONLY_WHEN_ASKED = /^(?:i am|i'm|it's|it is|this is)\b/i;

// Words that are never a name.
const NOT_NAMES = new Set([
  "hey", "hi", "hello", "yes", "no", "okay", "ok", "what", "why", "who", "how",
  "nion", "neon", "please", "thanks", "thank", "you", "sorry", "never", "mind",
]);

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Nion's own name, and the greeting before it. If these end up in what was heard ("Sanjeev
// Neon", from "Hey Neon, I'm Sanjeev"), they are not part of the person's name.
const NION_WORDS = new Set(["nion", "neon", "nyan", "nian", "nyon", "hey"]);

function toName(candidate) {
  const words = candidate
    .replace(/[.,!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NION_WORDS.has(w.toLowerCase()))
    // drop polite words at the end: "Sanjeev please"
    .filter((w, i, all) => !(i > 0 && ["please", "thanks"].includes(w.toLowerCase())));

  if (words.length === 0 || words.length > 3) return null;
  if (!words.every((w) => /^[\p{L}'-]{1,20}$/u.test(w))) return null;
  if (words.every((w) => NOT_NAMES.has(w.toLowerCase()))) return null;
  return words.map(titleCase).join(" ");
}

/**
 * Find a name in what was said.
 *   asked: true when Nion has just asked "What should I call you?", so a bare
 *          "Sanjeev" counts and so does "I'm Sanjeev".
 * Returns the name, or null if no name was found.
 */
export function extractName(text, { asked = false } = {}) {
  const heard = String(text ?? "").trim();
  if (!heard) return null;

  const intro = INTRO.exec(heard);
  if (intro) {
    const phrase = intro[0].trim();
    if (ONLY_WHEN_ASKED.test(phrase) && !asked) return null;
    return toName(intro[1]);
  }

  return asked ? toName(heard) : null;
}
