import { test } from "node:test";
import assert from "node:assert/strict";
import { headingFor, describePick } from "../public/js/picks.js";

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
