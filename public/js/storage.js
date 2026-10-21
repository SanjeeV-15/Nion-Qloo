// Nion's memory on this device. It uses the browser's own storage, which is like
// a sticky note the browser keeps for this one site. Nothing leaves your computer.
//
// Storage can be switched off (private windows, strict settings), so every call
// is wrapped: if it fails, Nion simply behaves as if nothing was saved.

const NAME_KEY = "nion.name";

export function getName() {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function setName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not saved: Nion will ask again next time.
  }
}

export function clearName() {
  try {
    localStorage.removeItem(NAME_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------- a random id for this browser ----------
//
// Sent with each question so a busy server can slow down one visitor without affecting others.
// It is random, tied to nothing about the person, and kept only in this browser.

const VISITOR_KEY = "nion.visitor";
let memoryId = null; // used if storage is switched off

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Very old browsers: build one the same shape from random numbers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
      id = makeId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return (memoryId ??= makeId());
  }
}

// ---------- taste (what the person has said they like) ----------
//
// A short list of { name, kind, opinion } kept on this device and sent with each question,
// so Nion can pick things that suit the person. See taste.js for what goes in it.

const TASTE_KEY = "nion.taste";

export function getTaste() {
  try {
    const list = JSON.parse(localStorage.getItem(TASTE_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // nothing saved, or it was damaged: Nion knows nothing yet
  }
}

export function saveTaste(items) {
  try {
    localStorage.setItem(TASTE_KEY, JSON.stringify(items));
  } catch {
    // Not saved: Nion will learn it again.
  }
}

export function clearTaste() {
  try {
    localStorage.removeItem(TASTE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------- age range (only if the person chose to give it) ----------
//
// One of Qloo's three age ranges, kept on this device and sent with each question so Qloo can use it. It is never
// asked for again, and "Forget my taste" removes it.

const AGE_KEY = "nion.age";
const AGE_VALUES = ["35_and_younger", "36_to_55", "55_and_older"]; // the same as AGE_CHOICES in taste.js (a test checks)

export function getAge() {
  try {
    const value = localStorage.getItem(AGE_KEY);
    return AGE_VALUES.includes(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveAge(value) {
  try {
    if (AGE_VALUES.includes(value)) localStorage.setItem(AGE_KEY, value);
    else localStorage.removeItem(AGE_KEY);
  } catch {
    // Not saved: Nion will not use an age range.
  }
}

export function clearAge() {
  try {
    localStorage.removeItem(AGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------- conversations (for the History screen) ----------
//
// Each conversation is saved as { id, startedAt, updatedAt, turns: [...] }. A turn is
// { role: "user" | "assistant", text, at } and an assistant turn may also carry
// `sources`: [{ title, url }]. Only questions that got an answer are saved.

const CONVERSATIONS_KEY = "nion.conversations";
const MAX_CONVERSATIONS = 100; // keeps the browser's storage from filling up

function readConversations() {
  try {
    const list = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // nothing saved, or it was damaged: start fresh
  }
}

function writeConversations(list) {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // Not saved (storage full or switched off): Nion still works, History just misses this one.
  }
}

/**
 * Save a question and its answer. Pass the id of the conversation they belong to,
 * or null to start a new one. Returns the conversation's id.
 */
export function recordExchange(conversationId, question, reply, sources = []) {
  const list = readConversations();
  const now = Date.now();

  let conversation = conversationId ? list.find((c) => c.id === conversationId) : null;
  if (!conversation) {
    conversation = { id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, startedAt: now, turns: [] };
    list.unshift(conversation);
  }

  const cleanSources = (Array.isArray(sources) ? sources : []).slice(0, 8).map((s) => ({
    title: String(s.title ?? s.url ?? "").slice(0, 120),
    url: String(s.url ?? "").slice(0, 500),
  }));

  conversation.turns.push({ role: "user", text: question, at: now });
  conversation.turns.push({
    role: "assistant",
    text: reply,
    at: now,
    ...(cleanSources.length ? { sources: cleanSources } : {}),
  });
  conversation.updatedAt = now;

  writeConversations(list);
  return conversation.id;
}

/** All saved conversations, most recent first. */
export function listConversations() {
  return readConversations().sort((a, b) => (b.updatedAt ?? b.startedAt) - (a.updatedAt ?? a.startedAt));
}

/** Forgets every saved conversation. */
export function clearConversations() {
  try {
    localStorage.removeItem(CONVERSATIONS_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function getConversation(id) {
  return readConversations().find((c) => c.id === id) ?? null;
}
