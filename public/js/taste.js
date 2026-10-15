// What Nion knows about a person's taste, kept on this device.
//
// A taste is { name, kind, opinion }: "ramen" (food) that they "like", for example. The
// list grows only from what the person says: the server notes a like or dislike when it
// is stated, and sends it back here to be saved. Nothing is guessed.
//
// This file holds only the plain logic (merging, summarising, the demo set), so it can be
// tested without a browser. Saving to the browser's storage is in storage.js.

// The sorts of taste Nion keeps. Keep this the same as TASTE_KINDS in server/taste.js
// (a test checks they match).
export const TASTE_KINDS = ["food", "genre", "artist", "movie", "tv_show", "book", "podcast", "brand", "place", "destination"];

const MAX_ITEMS = 30;

// A ready-made taste for people who would rather not talk (judges, for one). It is marked
// as a demo wherever it is shown, and it mixes areas so the cross-taste picks show.
export const DEMO_TASTE = [
  { name: "ramen", kind: "food", opinion: "like", demo: true },
  { name: "Radiohead", kind: "artist", opinion: "like", demo: true },
  { name: "Blade Runner 2049", kind: "movie", opinion: "like", demo: true },
  { name: "jazz", kind: "genre", opinion: "like", demo: true },
];

const same = (a, b) => a.kind === b.kind && a.name.toLowerCase() === b.name.toLowerCase();

function tidy(item) {
  if (!item || typeof item.name !== "string" || !TASTE_KINDS.includes(item.kind)) return null;
  const name = item.name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return null;
  return { name, kind: item.kind, opinion: item.opinion === "dislike" ? "dislike" : "like", ...(item.demo ? { demo: true } : {}) };
}

/**
 * Adds newly learned tastes to the list. A repeat is not added twice; if the person has
 * changed their mind (a like becomes a dislike) the newer one wins. The newest are kept
 * if the list gets long.
 */
export function mergeLearned(items, learned) {
  let list = (Array.isArray(items) ? items : []).map(tidy).filter(Boolean);
  for (const entry of Array.isArray(learned) ? learned : []) {
    const item = tidy({ ...entry, demo: false });
    if (!item) continue;
    list = list.filter((existing) => !same(existing, item));
    list.push(item);
  }
  return list.slice(-MAX_ITEMS);
}

/** What is sent to the server with each question: only the plain facts. */
export function tasteForRequest(items) {
  return (Array.isArray(items) ? items : [])
    .map(tidy)
    .filter(Boolean)
    .map(({ name, kind, opinion }) => ({ name, kind, opinion }));
}

/** One line for the screen: "Demo taste: ramen, Radiohead, Blade Runner 2049 and 1 more". */
export function summarizeTaste(items, show = 3) {
  const likes = (Array.isArray(items) ? items : []).map(tidy).filter((item) => item && item.opinion === "like");
  if (likes.length === 0) return "Nion doesn't know your taste yet.";
  const label = likes.every((item) => item.demo) ? "Demo taste" : "Your taste";
  const names = likes.slice(0, show).map((item) => item.name);
  const more = likes.length - names.length;
  return `${label}: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
