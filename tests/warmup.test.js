import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { warmUp, WARM_UP } from "../server/warmup.js";
import { DEMO_TASTE } from "../public/js/taste.js";

// A pretend Qloo and map that record every lookup.
function pretend() {
  const log = [];
  return {
    log,
    qloo: {
      async searchEntities(name, kind, take) { log.push(`entity:${kind}:${name}:${take}`); return []; },
      async searchTags(word, take) { log.push(`tag:${word}:${take}`); return []; },
    },
    geocode: async (city) => { log.push(`city:${city}`); return null; },
  };
}

test("it looks up the demo's items, one at a time, in the same form a real question uses", async () => {
  const { qloo, geocode, log } = pretend();
  const made = await warmUp({ qloo, geocode });
  assert.equal(made, WARM_UP.entities.length + WARM_UP.tags.length + WARM_UP.cities.length);
  // The same count the tool asks for (1 for a name, 8 for a tag), or the remembered answer would not be found.
  assert.ok(log.includes("entity:artist:Radiohead:1"));
  assert.ok(log.includes("entity:movie:Blade Runner 2049:1"));
  assert.ok(log.includes("tag:ramen:8") && log.includes("tag:jazz:8"));
  assert.ok(log.includes("city:Lisbon"));
});

test("it stops the moment a visitor arrives, so it can never slow a real question down", async () => {
  const { qloo, geocode, log } = pretend();
  let visitorHere = false;
  const made = await warmUp({
    qloo,
    geocode,
    keepGoing: () => !visitorHere,
    plan: { entities: [{ name: "A", kind: "artist" }, { name: "B", kind: "movie" }], tags: ["x"], cities: ["Y"] },
  });
  assert.equal(made, 4);
  // Now do it again, with a visitor who arrives after the first lookup.
  const second = pretend();
  let count = 0;
  const stopped = await warmUp({
    qloo: { ...second.qloo, async searchEntities(...a) { count += 1; visitorHere = true; return second.qloo.searchEntities(...a); } },
    geocode: second.geocode,
    keepGoing: () => !visitorHere,
    plan: { entities: [{ name: "A", kind: "artist" }, { name: "B", kind: "movie" }], tags: ["x"], cities: ["Y"] },
  });
  assert.equal(stopped, 1);
  assert.equal(count, 1);
  assert.deepEqual(second.log, ["entity:artist:A:1"], "nothing more was asked after the visitor arrived");
});

test("a lookup that fails is ignored, and the rest carry on", async () => {
  const { geocode, log } = pretend();
  const made = await warmUp({
    qloo: { async searchEntities() { throw new Error("Qloo is down"); }, async searchTags(word, take) { log.push(`tag:${word}:${take}`); return []; } },
    geocode,
  });
  assert.equal(made, WARM_UP.tags.length + WARM_UP.cities.length, "the failed lookups are not counted");
  assert.ok(log.includes("tag:ramen:8"));
});

test("the warm-up covers the demo taste and the sample cities, so it cannot drift out of step with them", () => {
  const names = WARM_UP.entities.map((e) => `${e.kind}:${e.name}`);
  for (const item of DEMO_TASTE) {
    if (item.kind === "artist" || item.kind === "movie") assert.ok(names.includes(`${item.kind}:${item.name}`), `${item.name} is not warmed`);
    if (item.kind === "food" || item.kind === "genre") assert.ok(WARM_UP.tags.includes(item.name), `${item.name} is not warmed`);
  }
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const chipsWithCities = [...html.matchAll(/data-say="[^"]*\b(Lisbon|New York|Tokyo)\b[^"]*"/g)].map((m) => m[1]);
  for (const city of chipsWithCities) assert.ok(WARM_UP.cities.includes(city), `${city} is not warmed`);
});
