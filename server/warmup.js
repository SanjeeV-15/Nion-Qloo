// Looks up, ahead of time, the few things a first visitor is most likely to use, so their first question does
// not have to wait for them. (Measured against real Qloo: the lookups behind one judge-style request took about
// 1.4 seconds the first time and 0.2 seconds once remembered.)
//
// It uses the same helpers as a real question, so what it learns is remembered by them. It does nothing a
// visitor could notice: it stops as soon as a real question is being answered, and any failure is ignored.

// Keep this in step with the demo taste (public/js/taste.js) and the sample cities offered on the page; a test checks it.
export const WARM_UP = {
  entities: [
    { name: "Radiohead", kind: "artist" },
    { name: "Blade Runner 2049", kind: "movie" },
  ],
  tags: ["ramen", "jazz"],
  cities: ["Lisbon", "New York", "Tokyo"],
};

/**
 * Runs the lookups one at a time. `keepGoing()` is asked before each one; if it says no (a visitor has arrived),
 * the rest are skipped. Returns how many lookups were made.
 */
export async function warmUp({ qloo, geocode, keepGoing = () => true, plan = WARM_UP }) {
  let done = 0;
  const step = async (lookup) => {
    if (!keepGoing()) return false;
    try {
      await lookup();
      done += 1;
    } catch {
      // A failed warm-up lookup costs nothing: the real question will simply make it itself.
    }
    return true;
  };
  for (const { name, kind } of plan.entities) if (!(await step(() => qloo.searchEntities(name, kind, 1)))) return done;
  for (const word of plan.tags) if (!(await step(() => qloo.searchTags(word, 8)))) return done;
  for (const city of plan.cities) if (!(await step(() => geocode(city)))) return done;
  return done;
}
