// Tries the Qloo helper against the real Qloo hackathon server (npm run check:qloo).
//
// This only uses your Qloo key. It does not call Claude, so it costs no Anthropic credit.
// It prints names only, never your key, and saves nothing (Qloo asks that its response
// data is not published).

import { createQloo, pickTag, QlooError } from "../server/qloo.js";

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

console.log(failures ? `\n${failures} step(s) failed.` : "\nAll steps worked.");
process.exit(failures ? 1 : 0);
