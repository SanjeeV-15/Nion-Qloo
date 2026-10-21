import { test } from "node:test";
import assert from "node:assert/strict";
import { headingFor, describePick, madeLines, modelName } from "../public/js/picks.js";

const pick = {
  name: "Sample Noodle Bar",
  detail: "1 Example Street Denver, CO 80000",
  distance: "about 12 minutes on foot",
  price: "inexpensive",
  rating: 4.4,
  fit: "a strong fit",
  tags: ["Gyoza", "Work dinner", "Outdoor seating", "Beer"],
};

test("the heading names what was suggested and what it was based on", () => {
  assert.deepEqual(headingFor({ kind: "place", likes: ["Radiohead", "Jazz"], only: ["Ramen restaurant"] }), {
    title: "Places near you",
    because: "Because you like Radiohead and Jazz, limited to ramen restaurant",
  });
  assert.deepEqual(headingFor({ kind: "movie", likes: ["Radiohead"], only: [] }), { title: "Films", because: "Because you like Radiohead" });
  assert.equal(headingFor({ kind: "place", likes: [], only: ["Ramen restaurant"] }).because, "Limited to ramen restaurant");
});

test("picks that are not personal say so honestly", () => {
  assert.equal(headingFor({ kind: "place", likes: [], only: [] }).because, "Popular rather than personal");
  assert.deepEqual(headingFor(null), { title: "Suggestions", because: "Popular rather than personal" });
});

test("three likes are listed as a short sentence and no more", () => {
  assert.equal(headingFor({ kind: "artist", likes: ["A", "B", "C", "D"], only: [] }).because, "Because you like A, B and C");
});

test("a pick is described in plain words", () => {
  const card = describePick(pick, { kind: "place" });
  assert.equal(card.name, "Sample Noodle Bar");
  assert.equal(card.meta, "about 12 minutes on foot · inexpensive · 4.4 stars");
  assert.equal(card.why, "A strong fit for you");
  assert.equal(card.tags, "Gyoza · Work dinner · Outdoor seating");
  assert.equal(card.detail, "1 Example Street Denver, CO 80000");
});

test("missing facts are simply left out", () => {
  const card = describePick({ name: "Moon" }, { kind: "movie" });
  assert.equal(card.meta, "");
  assert.equal(card.why, "");
  assert.equal(card.tags, "");
  assert.equal(card.mapUrl, undefined);
});

test("places and destinations link to a map search for the place itself", () => {
  const card = describePick(pick, { kind: "place" });
  assert.equal(
    card.mapUrl,
    "https://www.google.com/maps/search/?api=1&query=Sample%20Noodle%20Bar%201%20Example%20Street%20Denver%2C%20CO%2080000"
  );
  assert.match(describePick({ name: "Edinburgh" }, { kind: "destination" }).mapUrl, /query=Edinburgh$/);
  // A city name alone is ambiguous, so a destination with coordinates is looked up by them.
  const canterbury = describePick({ name: "Canterbury", location: { lat: 51.28, lon: 1.08 } }, { kind: "destination" });
  assert.equal(canterbury.mapUrl, "https://www.google.com/maps/search/?api=1&query=51.28%2C1.08");
});

test("films, music and the rest have no map link", () => {
  for (const kind of ["movie", "artist", "tv_show", "book", "podcast", "brand"]) {
    assert.equal(describePick(pick, { kind }).mapUrl, undefined);
  }
});

test("a name that looks like code is just words in the link, not a way out of it", () => {
  const card = describePick({ name: 'x" onmouseover="alert(1)', detail: "<script>" }, { kind: "place" });
  assert.ok(card.mapUrl.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.doesNotMatch(card.mapUrl, /["<> ]/);
});

test("Qloo's own reason is shown as how much each liked item drove the pick", () => {
  const card = describePick({ ...pick, because: [{ name: "Radiohead", share: 0.54 }, { name: "Blade Runner 2049", share: 0.46 }] }, { kind: "place" });
  assert.equal(card.because, "Qloo matched this through Radiohead (54%) and Blade Runner 2049 (46%)");
  const three = describePick({ ...pick, because: [{ name: "A", share: 0.5 }, { name: "B", share: 0.3 }, { name: "C", share: 0.2 }] }, { kind: "place" });
  assert.equal(three.because, "Qloo matched this through A (50%), B (30%) and C (20%)");
});

test("with no reason from Qloo, nothing is claimed", () => {
  assert.equal(describePick(pick, { kind: "place" }).because, "");
  assert.equal(describePick({ ...pick, because: [] }, { kind: "place" }).because, "");
  assert.equal(describePick({ ...pick, because: [{ name: 5, share: "x" }, null] }, { kind: "place" }).because, "");
});

test("the heading says what was left out because the person dislikes it", () => {
  assert.equal(
    headingFor({ kind: "place", likes: ["Radiohead"], only: ["Ramen restaurant"], avoid: ["sushi"] }).because,
    "Because you like Radiohead, limited to ramen restaurant, leaving out sushi"
  );
  assert.equal(headingFor({ kind: "movie", likes: [], only: [], avoid: ["Moon"] }).because, "Leaving out Moon", "a name keeps its capital letters");
  assert.equal(headingFor({ kind: "movie", likes: [], only: [], avoid: [] }).because, "Popular rather than personal");
});

test("a card shows when the place is open or closed, only when that is known", () => {
  const open = describePick({ ...pick, open: true, hours: "Open until 5 pm" }, { kind: "place" });
  assert.equal(open.hours, "Open until 5 pm");
  assert.equal(open.open, true);
  const shut = describePick({ ...pick, open: false, hours: "Closed now, opens at 10 am" }, { kind: "place" });
  assert.equal(shut.open, false);
  assert.equal(describePick(pick, { kind: "place" }).hours, "");
  assert.equal(describePick({ ...pick, hours: 5 }, { kind: "place" }).hours, "", "anything that is not text is ignored");
});

test("Qloo's generic 'Place' tag is not shown, but other tags are", () => {
  const card = describePick({ ...pick, tags: ["Place", "Convenience stop", "place", "Credit cards", "Outdoor seating"] }, { kind: "place" });
  assert.equal(card.tags, "Convenience stop · Credit cards · Outdoor seating");
});

// ---------- who did what ----------

test("a model id is shown as a name a person would say", () => {
  assert.equal(modelName("claude-haiku-5-5"), "Claude Haiku 5.5");
  assert.equal(modelName("claude-sonnet-5-5"), "Claude Sonnet 5.5");
  assert.equal(modelName("some-other-model"), "some-other-model", "an id it does not know is shown as it is");
  assert.equal(modelName(undefined), "Claude");
});

test("the line under the picks says what Qloo matched and what the model did, with the real numbers", () => {
  const lines = madeLines({ model: "claude-haiku-5-5", qloo: { likes: 2, tags: 1, avoided: 1, requests: 1 }, searches: 0 });
  assert.equal(lines.qloo, "Qloo matched 2 likes and 1 tag, then picked these (1 recommendation request). It left out 1 thing you dislike.");
  assert.equal(lines.claude, "Claude Haiku 5.5 chose what to ask Qloo and wrote the answer.");
});

test("with no taste to go on, it says so rather than claiming a match", () => {
  const lines = madeLines({ model: "claude-haiku-5-5", qloo: { likes: 0, tags: 0, avoided: 0, requests: 2 }, searches: 1 });
  assert.equal(lines.qloo, "Qloo picked these (2 recommendation requests), with no taste of yours to go on.");
  assert.match(lines.claude, /It also searched the web once\.$/);
  assert.match(madeLines({ model: "claude-haiku-5-5", qloo: null, searches: 3 }).claude, /searched the web 3 times/);
  assert.equal(madeLines({ model: "claude-haiku-5-5", qloo: null, searches: 0 }).qloo, "", "no Qloo numbers means no Qloo claim");
});

test("nothing is said when the server sent nothing", () => {
  assert.equal(madeLines(null), null);
  assert.equal(madeLines(undefined), null);
  assert.equal(madeLines("text"), null);
});

// ---------- the age range, and what Qloo says about a pick ----------

test("the heading says when the picks were tuned for an age range", () => {
  assert.deepEqual(headingFor({ kind: "place", likes: ["Radiohead"], only: [], avoid: [], age: "36_to_55" }), {
    title: "Places near you",
    because: "Because you like Radiohead, tuned for ages 36 to 55",
  });
  assert.equal(headingFor({ kind: "movie", likes: [], only: [], age: "55_and_older" }).because, "Tuned for ages 55 or older");
  assert.equal(headingFor({ kind: "movie", likes: ["Radiohead"], only: [], age: "ancient" }).because, "Because you like Radiohead");
});

test("the who-did-what line says when Qloo used the age range", () => {
  const lines = madeLines({ model: "claude-haiku-5-5", qloo: { likes: 2, tags: 0, avoided: 0, requests: 1, age: "36_to_55" }, searches: 0 });
  assert.equal(lines.qloo, "Qloo matched 2 likes, then picked these (1 recommendation request). It also used your age range (36 to 55).");
  const none = madeLines({ model: "claude-haiku-5-5", qloo: { likes: 2, tags: 0, avoided: 0, requests: 1 }, searches: 0 });
  assert.ok(!/age range/.test(none.qloo));
});

test("a pick carries Qloo's own score, description, known-for and tags, each as a labelled line", () => {
  const card = describePick(
    { name: "Noodle House", fitScore: 0.8112, description: "A cosy noodle bar.", knownFor: ["Tonkotsu Ramen", "Gyoza", "Karaage", "Extra"], tags: ["Place", "Late night", "Casual"] },
    { kind: "place" }
  );
  assert.equal(card.fitScore, "Fit score 0.81 out of 1");
  assert.equal(card.description, "A cosy noodle bar.");
  assert.equal(card.knownFor, "Known for: Tonkotsu Ramen, Gyoza, Karaage");
  assert.equal(card.qlooTags, "Qloo tags: Late night · Casual", "the generic Place tag is not shown");
});

test("a pick with nothing from Qloo to show says nothing under Qloo's name", () => {
  const card = describePick({ name: "Moon" }, { kind: "movie" });
  assert.equal(card.fitScore, "");
  assert.equal(card.description, "");
  assert.equal(card.knownFor, "");
  assert.equal(card.qlooTags, "");
  assert.equal(describePick({ name: "x", fitScore: "high", knownFor: [] }, { kind: "movie" }).fitScore, "", "a score that is not a number is not shown");
});
