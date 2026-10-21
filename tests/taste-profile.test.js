import { test } from "node:test";
import assert from "node:assert/strict";

// A pretend browser storage.
let data;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

const { mergeLearned, tasteForRequest, summarizeTaste, DEMO_TASTE, TASTE_KINDS, AGE_CHOICES, ageLabel, FOOD_CHOICES, addPick, removePick, mixSuggestions, intakeToTaste } = await import("../public/js/taste.js");
const { getTaste, saveTaste, clearTaste, getAge, saveAge, clearAge } = await import("../public/js/storage.js");
const { TASTE_KINDS: SERVER_KINDS } = await import("../server/taste.js");
const { AGE_RANGES } = await import("../server/qloo.js");

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

// ---------- the "tell Nion what you love" box: choices, picks and age ----------

test("the age choices on the page are exactly the ranges Qloo understands", () => {
  assert.deepEqual(AGE_CHOICES.map((choice) => choice.value), AGE_RANGES);
  assert.equal(ageLabel("36_to_55"), "36 to 55");
  assert.equal(ageLabel("35_and_younger"), "35 or younger");
  assert.equal(ageLabel("ancient"), undefined);
  assert.equal(ageLabel(undefined), undefined);
});

test("the foods offered are ones Nion can use", () => {
  assert.ok(FOOD_CHOICES.length >= 4 && FOOD_CHOICES.length <= 8);
  assert.ok(FOOD_CHOICES.every((food) => /^[a-z ]{3,20}$/.test(food)));
});

test("a pick is added once, in order, up to a limit, and can be taken out", () => {
  let list = [];
  list = addPick(list, { name: "Radiohead", kind: "artist" });
  list = addPick(list, { name: "  radiohead ", kind: "artist" });
  assert.equal(list.length, 1, "a repeat is ignored, however it is cased");
  list = addPick(list, { name: "Beck", kind: "artist" });
  list = addPick(list, { name: "Bjork", kind: "artist" });
  list = addPick(list, { name: "Prince", kind: "artist" });
  assert.deepEqual(list.map((p) => p.name), ["Radiohead", "Beck", "Bjork"], "only three");
  assert.deepEqual(removePick(list, { name: "BECK", kind: "artist" }).map((p) => p.name), ["Radiohead", "Bjork"]);
  assert.deepEqual(addPick(list, { name: "  " }), list, "an empty name is ignored");
  assert.deepEqual(addPick(undefined, { name: "x", kind: "movie" }), [{ name: "x", kind: "movie" }]);
});

test("films and shows take turns in the suggestions, without repeats", () => {
  const movies = [{ name: "Blade Runner 2049", kind: "movie" }, { name: "Blade Runner", kind: "movie" }, { name: "Blade", kind: "movie" }];
  const shows = [{ name: "Black Mirror", kind: "tv_show" }, { name: "Blade Runner", kind: "movie" }];
  const mixed = mixSuggestions([movies, shows], 4);
  assert.deepEqual(mixed.map((m) => m.name), ["Blade Runner 2049", "Black Mirror", "Blade Runner", "Blade"]);
  assert.deepEqual(mixSuggestions([[], undefined], 5), []);
  assert.equal(mixSuggestions([movies], 2).length, 2);
});

test("what is picked in the box becomes tastes Nion keeps, with the right kinds", () => {
  const taste = intakeToTaste({
    artists: [{ name: "Radiohead", kind: "artist" }],
    shows: [{ name: "Blade Runner 2049", kind: "movie" }, { name: "Black Mirror", kind: "tv_show" }],
    foods: ["ramen"],
  });
  assert.deepEqual(taste, [
    { name: "Radiohead", kind: "artist", opinion: "like" },
    { name: "Blade Runner 2049", kind: "movie", opinion: "like" },
    { name: "Black Mirror", kind: "tv_show", opinion: "like" },
    { name: "ramen", kind: "food", opinion: "like" },
  ]);
  assert.deepEqual(intakeToTaste({}), []);
  assert.deepEqual(intakeToTaste(), []);
});

test("the taste line adds the age range only when one was given", () => {
  const items = mergeLearned([], [{ name: "Radiohead", kind: "artist", opinion: "like" }]);
  assert.equal(summarizeTaste(items, 3, "36_to_55"), "Your taste: Radiohead · ages 36 to 55");
  assert.equal(summarizeTaste(items, 3), "Your taste: Radiohead");
  assert.equal(summarizeTaste(items, 3, "ancient"), "Your taste: Radiohead");
  assert.equal(summarizeTaste([], 3, "36_to_55"), "Nion doesn't know your taste yet.");
});

test("an age range is saved on this device, and only one of the three ranges is", () => {
  assert.equal(getAge(), undefined);
  saveAge("55_and_older");
  assert.equal(getAge(), "55_and_older");
  saveAge("ancient");
  assert.equal(getAge(), undefined, "an unknown range removes it");
  saveAge("36_to_55");
  clearAge();
  assert.equal(getAge(), undefined);
  data.set("nion.age", "tampered");
  assert.equal(getAge(), undefined, "a damaged value is not used");
});
