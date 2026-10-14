// Spots Nion's own voice, and tells it apart from a person interrupting.
//
// Nion keeps listening while it speaks, so you can interrupt it. The catch: on
// laptop speakers the microphone hears Nion too, and Chrome writes down what it
// hears, usually slightly differently ("questions" becomes "question").
//
// So when something is heard while Nion is talking (or just after), we compare it
// with the words Nion was saying. Words that match, even roughly, are Nion's own
// voice. Words that don't match are a person.

function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// "questions" and "question", "asked" and "ask" count as the same word.
function stem(word) {
  return word.replace(/(?:ing|ed|es|s)$/, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Are these two words close enough to be the same spoken word?
function sameWord(a, b) {
  if (a === b) return true;
  if (stem(a) === stem(b) && stem(a).length >= 3) return true;
  return a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1;
}

function matchesSpoken(word, spokenWords) {
  return spokenWords.some((s) => sameWord(word, s));
}

/** True if `heard` is (mostly) Nion's own words, so it should be ignored. */
export function isEcho(heard, spoken) {
  const heardWords = words(heard);
  if (heardWords.length === 0) return true; // nothing real was heard
  const spokenWords = words(spoken);
  if (spokenWords.length === 0) return false;
  const matching = heardWords.filter((w) => matchesSpoken(w, spokenWords)).length;
  return matching / heardWords.length >= 0.6;
}

// Words people say to stop Nion. One of these is enough.
const STOP_WORDS = new Set(["wait", "stop", "hold", "pause", "hang", "cancel", "sorry", "actually"]);

/**
 * True if what was heard looks like a person interrupting Nion: a stop word, or
 * at least two words that Nion was not saying. A single odd word is more likely
 * Chrome mishearing Nion's own voice, so that does not count.
 */
export function isInterruption(heard, spoken) {
  const spokenWords = words(spoken);
  const fresh = words(heard).filter((w) => !matchesSpoken(w, spokenWords));
  if (fresh.some((w) => STOP_WORDS.has(w))) return true;
  return fresh.length >= 2;
}

/**
 * Chrome sometimes writes down the end of Nion's voice and the start of the
 * person's words as one phrase ("...help you with a decision wait what's the
 * time"). This drops the leading part that is Nion's own words.
 */
export function stripLeadingEcho(heard, spoken) {
  const spokenWords = words(spoken);
  const tokens = String(heard ?? "").trim().split(/\s+/).filter(Boolean);
  let skip = 0;
  while (skip < tokens.length && matchesSpoken(words(tokens[skip])[0] ?? "", spokenWords)) skip += 1;
  // Only trim when it's a real run of Nion's words, not a couple of common words.
  return skip >= 3 ? tokens.slice(skip).join(" ") : tokens.join(" ");
}

/**
 * Takes a phrase Nion said ("One moment.") out of what was heard, wherever it sits
 * ("use my location one moment"). Returns what is left, or "" if nothing is.
 */
export function stripPhrase(heard, phrase) {
  const target = words(phrase);
  const tokens = String(heard ?? "").trim().split(/\s+/).filter(Boolean);
  if (target.length === 0) return tokens.join(" ");
  const kept = [];
  for (let i = 0; i < tokens.length; ) {
    const run = tokens.slice(i, i + target.length);
    const same = run.length === target.length && run.every((t, j) => sameWord(words(t)[0] ?? "", target[j]));
    if (same) i += target.length;
    else kept.push(tokens[i++]);
  }
  return kept.join(" ");
}
