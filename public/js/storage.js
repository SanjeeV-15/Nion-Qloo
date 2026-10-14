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
