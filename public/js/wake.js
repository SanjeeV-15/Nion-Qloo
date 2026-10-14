// Decides what Nion should do with a piece of text that the browser heard.
//
// The browser turns speech into text, and it often spells "Nion" in a different
// way ("Neon", "Nyan", "Ni on"...). So instead of looking for one exact word, we
// accept several spellings of the name after a greeting like "Hey".

// Several ways Chrome might write "Nion". Add new ones here when the "heard"
// line on the screen shows a spelling we don't recognise yet.
const NAME = "(?:n[iy]\\s?on|nee\\s?on|knee\\s?on|neon|nyan|nian|nyon)";
const GREETING = "(?:hey|hay|hi|hello|ok|okay)";

// A greeting, a gap (spaces or punctuation), then the name, then more gap.
const WAKE = new RegExp(`\\b${GREETING}[\\s,.!?-]+${NAME}\\b[\\s,.!?-]*`, "i");

// In testing, Chrome wrote "Hey Nion" in several other ways: "Indian", "anyone",
// "any on", "any neon", "a neon", and just "neon" with no "hey". These are ordinary
// words or sounds, so they only count as the wake phrase at the very start, and
// only when followed by a word that begins a request ("what", "how", "let's"...).
const REQUEST_WORDS = "(?:let's|let us|start|begin|can we|can you|please|what|what's|how|where|when|who|why|tell)";
const MISHEARD_WAKE = new RegExp(
  "^\\s*(?:" +
    `indian[\\s,.!?-]+(?=${REQUEST_WORDS}\\b)` +
    // "anyone" is a real word ("anyone know the time?"), so it is held to a stricter rule.
    "|any\\s?one[\\s,.!?-]+(?=(?:let's|let us|start|begin|what's|what is|tell me|can you)\\b)" +
    `|(?:any\\s?on|any\\s?neon|a\\s?neon|neon|nion|nyan)[\\s,.!?-]+(?=${REQUEST_WORDS}\\b)` +
  ")",
  "i"
);

// Spoken commands that control a conversation.
const START_CONVERSATION =
  /\b(?:start|begin|have|open)\s+(?:a|the|our|another)?\s*(?:new\s+)?(?:conversation|chat|talk)\b/i;
const END_CONVERSATION =
  /\b(?:end(?:ed|s|ing)?|stop(?:ped|s)?|finish(?:ed)?|close[ds]?|exit|quit)\s+(?:the|our|this)?\s*(?:conversation|chat)s?\b|\bgood\s?bye\b|\bbye\b|\b(?:that's|that is)\s+all\b|\b(?:i'm|i am|we're|we are)\s+done\b/i;

// Chrome sometimes writes "end the conversation" as "and the conversation" or
// "in the conversation". Those are only accepted when they are the whole thing
// that was said, so ordinary sentences containing "in the conversation" don't end it.
const END_CONVERSATION_MISHEARD =
  /^\s*(?:(?:okay|ok|please|now|just)[\s,]+)*(?:and|in|n|and then|enter|entered|ended|end)\s+(?:the|this|our)?\s*conversation(?:[\s,.]*(?:thank you|thanks|please))?\s*[.!?]?\s*$/i;

/**
 * Looks for a conversation command in some text.
 * Returns "start", "end", or null.
 */
export function detectCommand(text) {
  const heard = String(text ?? "");
  if (END_CONVERSATION.test(heard) || END_CONVERSATION_MISHEARD.test(heard)) return "end";
  if (START_CONVERSATION.test(heard)) return "start";
  return null;
}

/**
 * Look at what was heard and say whether it starts with the wake phrase.
 *
 * Returns { woke: false } when there is no "Hey Nion".
 * Returns { woke: true, question, command } when there is. `question` is whatever
 * came after the wake phrase (an empty string if the person only said "Hey Nion"),
 * and `command` is "start" or "end" if that is what was asked, otherwise null.
 */
export function parseUtterance(text) {
  const heard = String(text ?? "");
  const match = WAKE.exec(heard) ?? MISHEARD_WAKE.exec(heard);
  if (!match) return { woke: false };

  const question = heard
    .slice(match.index + match[0].length)
    .replace(/^[\s,.!?-]+/, "")
    .trim();

  return { woke: true, question, command: detectCommand(question) };
}
