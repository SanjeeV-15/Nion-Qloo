// Tries the Qloo helper against the real Qloo hackathon server (npm run check:qloo).
//
// This only uses your Qloo key. It does not call Claude, so it costs no Anthropic credit.
// It prints names only, never your key, and saves nothing (Qloo asks that its response
// data is not published).

import { createQloo, pickTag, QlooError } from "../server/qloo.js";
import { geocodePlace } from "../server/place.js";
import { runAskQloo } from "../server/taste.js";

const qloo = createQloo({ apiKey: process.env.QLOO_API_KEY });
const denver = { lat: 39.7392, lon: -104.9903 }; // downtown Denver

let failures = 0;
async function step(title, run) {
  const started = Date.now();
  try {
    const lines = await run();
    console.log(`\n${title}  (${Date.now() - started} ms)`);
    for (const line of lines) console.log("  " + line);
  } catch (error) {
    failures += 1;
    const detail = error instanceof QlooError ? `${error.code}: ${error.message}` : String(error?.message ?? error);
    console.log(`\n${title}  FAILED -> ${detail}`);
  }
}

const show = (e) =>
  [
    e.name,
    e.detail,
    e.match !== undefined ? `match ${e.match}` : undefined,
    e.distanceM !== undefined ? `${e.distanceM} m` : undefined,
    e.priceLevel !== undefined ? `price ${e.priceLevel}` : undefined,
    e.rating !== undefined ? `rating ${e.rating}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");

const ids = {};

await step("1. Look up an artist and a film by name", async () => {
  const [artist] = await qloo.searchEntities("Radiohead", "artist", 1);
  const [film] = await qloo.searchEntities("Blade Runner 2049", "movie", 1);
  if (!artist || !film) throw new Error("search found nothing");
  ids.artist = artist.id;
  ids.film = film.id;
  return [`artist: ${artist.name}`, `film: ${film.name}`];
});

await step("2. Look up 'ramen' and choose a restaurant tag", async () => {
  const tag = pickTag(await qloo.searchTags("ramen"), ["urn:tag:genre:place:restaurant:", "urn:tag:cuisine:"]);
  if (!tag) throw new Error("no usable ramen tag");
  ids.ramen = tag.id;
  return [`tag: ${tag.name} (${tag.id})`];
});

await step("3. Ramen places near downtown Denver", async () => {
  const found = await qloo.recommend({ kind: "place", filterTagIds: [ids.ramen], place: denver, radiusM: 3000, take: 4 });
  if (!found.length) throw new Error("no places came back");
  return found.map(show);
});

await step("4. Places near Denver for someone who loves that artist", async () => {
  const found = await qloo.recommend({ kind: "place", entityIds: [ids.artist], place: denver, radiusM: 2000, take: 4 });
  if (!found.length) throw new Error("no places came back");
  return found.map(show);
});

await step("5. Two tastes at once (artist + film) -> places near Denver", async () => {
  const found = await qloo.recommend({ kind: "place", entityIds: [ids.artist, ids.film], place: denver, radiusM: 2000, take: 4 });
  if (!found.length) throw new Error("no places came back (comma-separated signals may not work)");
  return found.map(show);
});

await step("6. Films for the artist fan (taste carries across)", async () => {
  const found = await qloo.recommend({ kind: "movie", entityIds: [ids.artist], take: 4 });
  if (!found.length) throw new Error("no films came back");
  return found.map(show);
});

await step("7. Travel destinations for the film fan", async () => {
  const found = await qloo.recommend({ kind: "destination", entityIds: [ids.film], take: 4 });
  if (!found.length) throw new Error("no destinations came back");
  return found.map(show);
});

// ----- places the person says, not just their GPS position -----
// (This uses OpenStreetMap's free place lookup too, at most a few requests, a second apart.)

await step("8. Find 'Lisbon' on the map, then places near it for the artist fan", async () => {
  const lisbon = await geocodePlace("Lisbon");
  if (!lisbon) throw new Error("OpenStreetMap did not find Lisbon");
  const found = await qloo.recommend({ kind: "place", entityIds: [ids.artist], place: lisbon, radiusM: 3500, take: 4 });
  if (!found.length) throw new Error("no places came back near Lisbon");
  return [`Lisbon is at ${lisbon.lat.toFixed(3)}, ${lisbon.lon.toFixed(3)} (${lisbon.city}, ${lisbon.country ?? "?"})`, ...found.map(show)];
});

await step("9. The tool Claude uses: ramen near 'Tokyo' while the person is in Denver", async () => {
  const out = await runAskQloo({
    qloo,
    input: { kind: "place", only: "ramen", near: "Tokyo" },
    context: { coords: denver, coordsFrom: "gps", timeZone: "America/Denver", geocode: geocodePlace },
  });
  if (!out.suggestions.length) throw new Error(`no suggestions: ${out.text}`);
  return [...out.text.split("\n").slice(0, 2), ...out.suggestions.map((e) => `${e.name} | ${e.detail ?? ""} | distance shown: ${e.distance ?? "none (good)"}`)];
});

await step("10. A place that does not exist", async () => {
  const out = await runAskQloo({
    qloo,
    input: { kind: "place", near: "Zzyzx Qwertyuiop Land" },
    context: { coords: denver, coordsFrom: "gps", geocode: geocodePlace },
  });
  if (out.suggestions.length) throw new Error("it invented results for a place that is not there");
  return [out.text];
});

await step("11. Qloo's own reason: two liked items blended, places near Denver", async () => {
  const out = await runAskQloo({
    qloo,
    input: { kind: "place", likes: [{ name: "Radiohead", kind: "artist" }, { name: "Blade Runner 2049", kind: "movie" }] },
    context: { coords: denver, coordsFrom: "gps", timeZone: "America/Denver" },
  });
  if (!out.suggestions.length) throw new Error("no places came back");
  const explained = out.suggestions.filter((p) => p.because?.length);
  if (!explained.length) throw new Error("Qloo gave no reason for any pick");
  return out.suggestions.map((p) => `${p.name}: ${p.because?.map((b) => `${b.name} ${Math.round(b.share * 100)}%`).join(", ") ?? "(no reason given)"}`);
});

await step("12. A food the person dislikes is left out: Japanese places near Denver, with and without 'sushi' disliked", async () => {
  const ask = (dislikes) => runAskQloo({ qloo, input: { kind: "place", only: "japanese", how_many: 5 }, context: { coords: denver, coordsFrom: "gps", dislikes } });
  const plain = await ask([]);
  const without = await ask([{ name: "sushi", kind: "food" }]);
  const sushiTagged = (out) => out.suggestions.filter((p) => p.tags.some((t) => /sushi/i.test(t))).length;
  if (!without.suggestions.length) throw new Error("nothing came back once sushi was left out");
  if (!without.about.avoid.includes("sushi")) throw new Error("the dislike was not applied");
  return [
    `without a dislike: ${plain.suggestions.length} places, ${sushiTagged(plain)} with a sushi tag`,
    `sushi disliked:    ${without.suggestions.length} places, ${sushiTagged(without)} with a sushi tag (Qloo drops that exact tag, so a few may remain)`,
  ];
});

await step("13. A film the person dislikes is left out: films for a Radiohead fan", async () => {
  const base = await runAskQloo({ qloo, input: { kind: "movie", likes: [{ name: "Radiohead", kind: "artist" }] }, context: {} });
  const hidden = base.suggestions[0].name;
  const out = await runAskQloo({ qloo, input: { kind: "movie", likes: [{ name: "Radiohead", kind: "artist" }] }, context: { dislikes: [{ name: hidden, kind: "movie" }] } });
  if (out.suggestions.some((p) => p.name === hidden)) throw new Error(`${hidden} was still recommended`);
  if (out.suggestions.length < 4) throw new Error("the list was not filled up again");
  return [`first pick without a dislike: ${hidden}`, `with it disliked, picks are: ${out.suggestions.map((p) => p.name).join(" | ")}`, `heading would say: leaving out ${out.about.avoid.join(", ")}`];
});

await step("14. Search as you type: part of a name finds the real thing (this is what the 'tell Nion what you love' box shows)", async () => {
  const lines = [];
  for (const [text, kind] of [["Radioh", "artist"], ["Blade Ru", "movie"], ["Black Mir", "tv_show"]]) {
    const found = await qloo.searchEntities(text, kind, 5);
    if (!found.length) throw new Error(`nothing for "${text}"`);
    lines.push(`"${text}" (${kind}) -> ${found.map((e) => e.name).join(" | ")}`);
  }
  return lines;
});

await step("15. The age range changes what Qloo picks: the same likes near Denver, with each of Qloo's three age ranges", async () => {
  const likes = [{ name: "Radiohead", kind: "artist" }, { name: "Blade Runner 2049", kind: "movie" }];
  const lists = {};
  for (const age of [undefined, "35_and_younger", "36_to_55", "55_and_older"]) {
    const out = await runAskQloo({ qloo, input: { kind: "place", likes, how_many: 4 }, context: { coords: denver, coordsFrom: "gps", age } });
    if (!out.suggestions.length) throw new Error(`no places for age ${age}`);
    lists[age ?? "no age"] = out.suggestions.map((p) => p.name);
  }
  const distinct = new Set(Object.values(lists).map((names) => names.join("|"))).size;
  if (distinct < 3) throw new Error("the age range barely changed the picks");
  return Object.entries(lists).map(([age, names]) => `${age.padEnd(15)} ${names.join(" | ")}`);
});

await step("16. What Qloo says about a pick: its score, its own description and what it is known for", async () => {
  const out = await runAskQloo({
    qloo,
    input: { kind: "place", likes: [{ name: "Radiohead", kind: "artist" }, { name: "Blade Runner 2049", kind: "movie" }] },
    context: { coords: denver, coordsFrom: "gps", timeZone: "America/Denver" },
  });
  const scored = out.suggestions.filter((p) => Number.isFinite(p.fitScore));
  const described = out.suggestions.filter((p) => p.description);
  if (!scored.length) throw new Error("no pick had a fit score");
  if (!described.length) throw new Error("no pick had a description from Qloo");
  return out.suggestions.map((p) => `${p.name}: fit ${p.fitScore ?? "-"}, ${p.description ? "has Qloo's description" : "no description"}, known for ${p.knownFor?.join(", ") ?? "-"}`);
});

console.log(failures ? `\n${failures} step(s) failed.` : "\nAll steps worked.");
process.exit(failures ? 1 : 0);
