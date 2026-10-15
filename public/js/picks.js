// What the quiet list under the circle says about each thing Nion recommended.
//
// This is plain logic with no screen in it, so it can be tested. app.js turns the result
// into elements, always as text and never as HTML, because every word here came from
// outside (Qloo) and must never be treated as code.

const NOUNS = {
  place: "Places near you",
  destination: "Places to travel",
  artist: "Music",
  movie: "Films",
  tv_show: "TV shows",
  brand: "Brands",
  book: "Books",
  podcast: "Podcasts",
};

/** "a", "a and b", "a, b and c" */
function joined(words) {
  const list = words.filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/**
 * The heading above the list. `about` is { kind, likes, only } from the server: what was
 * recommended and what it was based on. Says so honestly when the picks are not personal.
 */
export function headingFor(about) {
  const likes = Array.isArray(about?.likes) ? about.likes.slice(0, 3) : [];
  const only = Array.isArray(about?.only) ? about.only.slice(0, 2) : [];
  const parts = [];
  if (likes.length) parts.push(`Because you like ${joined(likes)}`);
  if (only.length) parts.push(`${likes.length ? "limited" : "Limited"} to ${joined(only).toLowerCase()}`);
  return {
    title: NOUNS[about?.kind] ?? "Suggestions",
    because: parts.length ? parts.join(", ") : "Popular rather than personal",
  };
}

/** Looks for a place on a map. The place's own name, address or coordinates, never the person's position. */
function mapUrl(item, about) {
  if (!item?.name || !["place", "destination"].includes(about?.kind)) return undefined;
  // A city name alone is ambiguous (Canterbury is in several countries), so a destination
  // is looked up by its own coordinates when Qloo gave them.
  const here = item.location;
  const query =
    about.kind === "destination" && Number.isFinite(here?.lat) && Number.isFinite(here?.lon)
      ? `${here.lat},${here.lon}`
      : [item.name, item.detail].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** One pick, ready to show: a name, a line of facts, why it fits, and where to look it up. */
export function describePick(item, about) {
  const meta = [item.distance, item.price, Number.isFinite(item.rating) ? `${item.rating} stars` : undefined].filter(Boolean);
  return {
    name: item.name,
    detail: item.detail,
    meta: meta.join(" · "),
    why: item.fit ? `${capital(item.fit)} for you` : "",
    tags: (item.tags ?? []).slice(0, 3).join(" · "),
    mapUrl: mapUrl(item, about),
  };
}
