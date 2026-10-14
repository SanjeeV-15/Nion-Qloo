import { test } from "node:test";
import assert from "node:assert/strict";

// A pretend browser storage.
let data;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

const { recordExchange, listConversations, getConversation } = await import("../public/js/storage.js");
const { conversationTitle, formatTranscript } = await import("../public/js/transcript.js");

test.beforeEach(() => {
  data = new Map();
});

test("the first answered question starts a new conversation", () => {
  const id = recordExchange(null, "what is the date", "It's Sunday.");
  const conversation = getConversation(id);
  assert.equal(conversation.turns.length, 2);
  assert.deepEqual(conversation.turns.map((t) => t.role), ["user", "assistant"]);
  assert.equal(conversation.turns[0].text, "what is the date");
  assert.equal(conversation.turns[1].text, "It's Sunday.");
});

test("a follow-up is added to the same conversation", () => {
  const id = recordExchange(null, "time in Denver", "It's one.");
  const again = recordExchange(id, "and Mumbai", "It's midnight.");
  assert.equal(again, id);
  assert.equal(listConversations().length, 1);
  assert.equal(getConversation(id).turns.length, 4);
});

test("passing no id starts a separate conversation, and the newest comes first", async () => {
  const first = recordExchange(null, "first question", "first answer");
  await new Promise((r) => setTimeout(r, 5));
  const second = recordExchange(null, "second question", "second answer");
  assert.notEqual(first, second);
  assert.deepEqual(listConversations().map((c) => c.id), [second, first]);
});

test("sources are saved with the answer", () => {
  const id = recordExchange(null, "news", "According to Reuters, talks resumed.", [
    { title: "Reuters story", url: "https://reuters.com/a" },
  ]);
  assert.deepEqual(getConversation(id).turns[1].sources, [{ title: "Reuters story", url: "https://reuters.com/a" }]);
});

test("damaged or missing storage does not break anything", () => {
  data.set("nion.conversations", "this is not json");
  assert.deepEqual(listConversations(), []);
  const id = recordExchange(null, "hello", "hi");
  assert.equal(listConversations().length, 1);
  assert.ok(getConversation(id));
  assert.equal(getConversation("nope"), null);
});

test("only the most recent 100 conversations are kept", () => {
  for (let i = 0; i < 105; i++) recordExchange(null, `question ${i}`, "answer");
  assert.equal(listConversations().length, 100);
});

test("a title is the first question, shortened if long", () => {
  assert.equal(conversationTitle({ turns: [{ role: "user", text: "what is the date" }] }), "what is the date");
  const long = conversationTitle({ turns: [{ role: "user", text: "word ".repeat(40) }] });
  assert.ok(long.length <= 60);
  assert.ok(long.endsWith("…"));
  assert.equal(conversationTitle({ turns: [] }), "Conversation");
});

test("the copied transcript is plain readable text with sources", () => {
  const id = recordExchange(null, "latest news", "According to Reuters, talks resumed.", [
    { title: "Reuters story", url: "https://reuters.com/a" },
  ]);
  recordExchange(id, "thanks", "Anytime.");
  const text = formatTranscript(getConversation(id), { locale: "en-US" });
  assert.match(text, /^Nion conversation, /);
  assert.match(text, /You: latest news\nNion: According to Reuters, talks resumed\.\nSources: Reuters story \(https:\/\/reuters\.com\/a\)/);
  assert.match(text, /You: thanks\nNion: Anytime\.$/);
});
