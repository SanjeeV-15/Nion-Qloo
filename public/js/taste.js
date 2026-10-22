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

// The age ranges Qloo understands, with how each is said on the screen. Keep the values the same as AGE_RANGES in
// server/qloo.js (a test checks they match). Giving an age is always optional, and it stays on this device.
export const AGE_CHOICES = [
  { value: "35_and_younger", label: "35 or younger" },
  { value: "36_to_55", label: "36 to 55" },
  { value: "55_and_older", label: "55 or older" },
];

/** "36_to_55" becomes "36 to 55". Anything else is nothing. */
export function ageLabel(value) {
  return AGE_CHOICES.find((choice) => choice.value === value)?.label;
}

// Foods to tap in the "tell Nion what you love" box. Nion looks each one up in Qloo when it is used.
export const FOOD_CHOICES = ["ramen", "tacos", "sushi", "pizza", "burgers", "coffee"];

// Music styles and kinds of film or show to tap. Each is a genre taste, looked up as a Qloo tag when it is used. Only
// words whose first Qloo tag is a music or media genre are offered: "rock" and "country" are not, because Qloo's first
// match for them is a place category and a hotel type (checked against real Qloo).
export const MUSIC_GENRES = ["pop", "hip hop", "jazz", "electronic", "indie", "classical", "metal"];
export const SCREEN_GENRES = ["comedy", "sci-fi", "drama", "thriller", "documentary", "animation"];

const sameName = (a, b) => a.kind === b.kind && a.name.toLowerCase() === b.name.toLowerCase();

/** Adds a pick to a short list (a repeat is ignored, and only the first `max` are kept). Returns a new list. */
export function addPick(list, pick, max = 3) {
  const current = Array.isArray(list) ? list : [];
  if (!pick || typeof pick.name !== "string" || !pick.name.trim()) return current;
  const item = { name: pick.name.replace(/\s+/g, " ").trim(), kind: pick.kind };
  if (current.some((existing) => sameName(existing, item))) return current;
  return current.length >= max ? current : [...current, item];
}

/** Takes a pick out of a list. Returns a new list. */
export function removePick(list, pick) {
  return (Array.isArray(list) ? list : []).filter((existing) => !sameName(existing, pick));
}

/**
 * Mixes several lists of suggestions into one short list, taking turns so each kind (films, then shows)
 * gets a place, without repeats.
 */
export function mixSuggestions(lists, max = 5) {
  const queues = (Array.isArray(lists) ? lists : []).map((list) => (Array.isArray(list) ? [...list] : []));
  const mixed = [];
  while (mixed.length < max && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && !mixed.some((existing) => sameName(existing, next))) mixed.push(next);
      if (mixed.length >= max) break;
    }
  }
  return mixed;
}

/** What the person picked in the box, as tastes Nion keeps: { name, kind, opinion: "like" }. */
export function intakeToTaste({ artists = [], shows = [], genres = [], foods = [] } = {}) {
  return [
    ...artists.map((pick) => ({ name: pick.name, kind: "artist" })),
    ...shows.map((pick) => ({ name: pick.name, kind: pick.kind === "tv_show" ? "tv_show" : "movie" })),
    ...genres.map((name) => ({ name, kind: "genre" })),
    ...foods.map((name) => ({ name, kind: "food" })),
  ]
    .map(tidy)
    .filter(Boolean);
}

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

/** One line for the screen: "Demo taste: ramen, Radiohead, Blade Runner 2049 and 1 more", and the age range if given. */
export function summarizeTaste(items, show = 3, age) {
  const likes = (Array.isArray(items) ? items : []).map(tidy).filter((item) => item && item.opinion === "like");
  if (likes.length === 0) return "Nion doesn't know your taste yet.";
  const label = likes.every((item) => item.demo) ? "Demo taste" : "Your taste";
  const names = likes.slice(0, show).map((item) => item.name);
  const more = likes.length - names.length;
  const years = ageLabel(age);
  return `${label}: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}${years ? ` · ages ${years}` : ""}`;
}
