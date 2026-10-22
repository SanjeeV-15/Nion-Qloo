// What the quiet list under the circle says about each thing Nion recommended.
//
// This is plain logic with no screen in it, so it can be tested. app.js turns the result
// into elements, always as text and never as HTML, because every word here came from
// outside (Qloo) and must never be treated as code.

import { ageLabel } from "./taste.js";

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
  const avoid = Array.isArray(about?.avoid) ? about.avoid.slice(0, 3) : [];
  if (avoid.length) parts.push(`${parts.length ? "leaving" : "Leaving"} out ${joined(avoid)}`);
  const years = ageLabel(about?.age);
  if (years) parts.push(`${parts.length ? "tuned" : "Tuned"} for ages ${years}`);
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

/** "Radiohead (54%) and Blade Runner 2049 (46%)": Qloo's own breakdown of what drove a pick. */
function becauseLine(because) {
  const parts = (Array.isArray(because) ? because : [])
    .filter((b) => typeof b?.name === "string" && Number.isFinite(b?.share))
    .map((b) => `${b.name} (${Math.round(b.share * 100)}%)`);
  if (parts.length === 0) return "";
  return `Qloo matched this through ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}`;
}

/** One pick, ready to show: a name, a line of facts, why it fits, and where to look it up. */
export function describePick(item, about) {
  const tags = (item.tags ?? []).filter((tag) => !/^place$/i.test(String(tag).trim())).slice(0, 3).join(" · ");
  const meta = [item.distance, item.price, Number.isFinite(item.rating) ? `${item.rating} stars` : undefined].filter(Boolean);
  // For an artist, Qloo's short description is often just the name again: that says nothing, so it is not shown.
  const detail = typeof item.detail === "string" && item.detail.trim().toLowerCase() !== String(item.name ?? "").trim().toLowerCase() ? item.detail : "";
  return {
    name: item.name,
    detail,
    meta: meta.join(" · "),
    hours: typeof item.hours === "string" ? item.hours : "",
    open: item.open === true,
    why: item.fit ? `${capital(item.fit)} for you` : "",
    because: becauseLine(item.because),
    // "Place" is a generic tag Qloo puts on many places; it says nothing, so it is not shown.
    tags,
    mapUrl: mapUrl(item, about),
    // What Qloo itself said about this pick, each line labelled on the screen under "Qloo says".
    fitScore: Number.isFinite(item.fitScore) ? `Fit score ${item.fitScore.toFixed(2)} out of 1` : "",
    description: typeof item.description === "string" ? item.description : "",
    knownFor: Array.isArray(item.knownFor) && item.knownFor.length ? `Known for: ${item.knownFor.slice(0, 3).join(", ")}` : "",
    qlooTags: tags ? `Qloo tags: ${tags}` : "",
  };
}

/** "claude-haiku-5-5" becomes "Claude Haiku 5.5". Anything else is shown as it is. */
export function modelName(id) {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(typeof id === "string" ? id : "");
  if (match) return `Claude ${capital(match[1])} ${match[2]}.${match[3]}`;
  return typeof id === "string" && id.trim() ? id.trim() : "Claude";
}

const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Who did what for these picks, in two plain sentences. `made` is { model, qloo, searches } from the server and
 * every number in it is real: what Qloo matched, how many requests it took, and any web searches. Returns
 * { qloo, claude } (a part is an empty string when the server did not say), or null when there is nothing to say.
 */
export function madeLines(made) {
  if (!made || typeof made !== "object") return null;

  let qloo = "";
  const q = made.qloo;
  if (q && Number.isFinite(q.requests) && q.requests > 0) {
    const matched = [q.likes > 0 ? counted(q.likes, "like") : "", q.tags > 0 ? counted(q.tags, "tag") : ""].filter(Boolean);
    const took = `(${counted(q.requests, "recommendation request")})`;
    qloo = matched.length ? `Qloo matched ${joined(matched)}, then picked these ${took}.` : `Qloo picked these ${took}, with no taste of yours to go on.`;
    if (q.avoided > 0) qloo += ` It left out ${counted(q.avoided, "thing")} you dislike.`;
    if (ageLabel(q.age)) qloo += ` It also used your age range (${ageLabel(q.age)}).`;
  }

  let claude = `${modelName(made.model)} chose what to ask Qloo and wrote the answer.`;
  if (Number.isFinite(made.searches) && made.searches > 0) {
    claude += ` It also searched the web ${made.searches === 1 ? "once" : `${made.searches} times`}.`;
  }
  return { qloo, claude };
}
