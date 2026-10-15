import { test } from "node:test";
import assert from "node:assert/strict";

// A pretend browser storage.
let data;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

const { mergeLearned, tasteForRequest, summarizeTaste, DEMO_TASTE, TASTE_KINDS } = await import("../public/js/taste.js");
const { getTaste, saveTaste, clearTaste } = await import("../public/js/storage.js");
const { TASTE_KINDS: SERVER_KINDS } = await import("../server/taste.js");

test.beforeEach(() => {
  data = new Map();
});

const like = (name, kind = "food") => ({ name, kind, opinion: "like" });

test("the page and the server agree on the kinds of taste", () => {
  assert.deepEqual(TASTE_KINDS, SERVER_KINDS);
});

test("what the person says is added to what Nion knows", () => {
  const list = mergeLearned([like("ramen")], [like("Radiohead", "artist")]);
  assert.deepEqual(list.map((t) => t.name), ["ramen", "Radiohead"]);
});

test("saying the same thing twice does not add it twice, even in different capitals", () => {
  const list = mergeLearned([like("ramen")], [like("Ramen"), like("ramen")]);
  assert.equal(list.length, 1);
});

test("changing their mind replaces the old taste with the new one", () => {
  const list = mergeLearned([like("sushi")], [{ name: "sushi", kind: "food", opinion: "dislike" }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].opinion, "dislike");
});

test("the same name in a different area is a different taste", () => {
  const list = mergeLearned([like("Heat", "movie")], [like("Heat", "food")]);
  assert.equal(list.length, 2);
});

test("something learned from the person is never marked as a demo", () => {
  const list = mergeLearned(DEMO_TASTE, [{ ...like("ramen"), demo: true }]);
  assert.equal(list.find((t) => t.name === "ramen").demo, undefined);
  assert.equal(list.filter((t) => t.demo).length, DEMO_TASTE.length - 1);
});

test("unusable entries are skipped", () => {
  const list = mergeLearned([], [null, { name: "", kind: "food" }, { name: "x", kind: "nonsense" }, { kind: "food" }, like("ramen")]);
  assert.deepEqual(list.map((t) => t.name), ["ramen"]);
});

test("only the newest thirty are kept", () => {
  const many = Array.from({ length: 40 }, (_, i) => like(`taste ${i}`));
  const list = mergeLearned([], many);
  assert.equal(list.length, 30);
  assert.equal(list[29].name, "taste 39");
  assert.equal(list[0].name, "taste 10");
});

test("only the plain facts are sent to the server", () => {
  const sent = tasteForRequest(DEMO_TASTE);
  assert.equal(sent.length, DEMO_TASTE.length);
  assert.deepEqual(Object.keys(sent[0]).sort(), ["kind", "name", "opinion"]);
  assert.deepEqual(tasteForRequest("not a list"), []);
});

test("the demo taste is valid and mixes areas, so cross-taste picks show", () => {
  assert.ok(DEMO_TASTE.every((t) => t.demo === true && TASTE_KINDS.includes(t.kind) && t.opinion === "like"));
  assert.ok(new Set(DEMO_TASTE.map((t) => t.kind)).size >= 3);
});

test("the screen line says what Nion knows, and calls the demo a demo", () => {
  assert.equal(summarizeTaste([]), "Nion doesn't know your taste yet.");
  assert.equal(summarizeTaste(DEMO_TASTE), "Demo taste: ramen, Radiohead, Blade Runner 2049 and 1 more");
  assert.equal(summarizeTaste([like("ramen"), like("jazz", "genre")]), "Your taste: ramen, jazz");
  // Mixing the demo with something the person said is their own taste now.
  assert.match(summarizeTaste(mergeLearned(DEMO_TASTE, [like("tacos")])), /^Your taste:/);
  // Dislikes are kept but not announced on the screen.
  assert.equal(summarizeTaste([{ name: "sushi", kind: "food", opinion: "dislike" }]), "Nion doesn't know your taste yet.");
});

test("taste is kept in the browser's storage and can be forgotten", () => {
  assert.deepEqual(getTaste(), []);
  saveTaste([like("ramen")]);
  assert.deepEqual(getTaste(), [like("ramen")]);
  clearTaste();
  assert.deepEqual(getTaste(), []);
});

test("damaged storage means Nion knows nothing yet, not a crash", () => {
  data.set("nion.taste", "this is not json");
  assert.deepEqual(getTaste(), []);
  data.set("nion.taste", '{"not":"a list"}');
  assert.deepEqual(getTaste(), []);
});
