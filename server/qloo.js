// Everything Nion knows about Qloo lives in this one file.
//
// Qloo is a "taste graph": give it things a person likes (an artist, a film, a kind of
// food) and it says what else that person would probably love, including places near them.
// It is data, not a language model, so Claude does the talking and calls this file as a tool.
//
// Qloo works in IDs, not words. "Radiohead" is first looked up to get its ID, and "ramen"
// is looked up to get a tag ID. Then the recommendation call takes those IDs. Qloo also
// quietly ignores any parameter it does not understand and returns an empty list, so the
// code here is strict about what it sends and says so when a result comes back empty.
//
// Rules from the hackathon's developer guide: keys work only with
// https://hackathon.api.qloo.com, the key goes in the X-Api-Key header (never in the URL),
// and Qloo's response data must not be published in the public repo.

const BASE_URL = "https://hackathon.api.qloo.com";

/** The kinds of things Nion can recommend, and Qloo's name for each. */
export const KINDS = {
  place: "urn:entity:place", // restaurants, museums, venues: anything with an address
  destination: "urn:entity:destination", // cities and regions to travel to
  artist: "urn:entity:artist", // music
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  brand: "urn:entity:brand", // fashion and other brands
  book: "urn:entity:book",
  podcast: "urn:entity:podcast",
};

// Only these kinds can be narrowed to a spot on the map.
const LOCATION_KINDS = new Set(["place", "destination"]);

const MAX_TAKE = 10;

/** What went wrong, in a form the rest of Nion can act on. */
export class QlooError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QlooError";
    // missing_key | auth | rate_limited | bad_request | unavailable | timeout | bad_answer
    this.code = code;
  }
}

/**
 * Qloo's words end up inside Claude's context, so treat them as untrusted: no control
 * characters, no angle brackets, one line, and a length limit.
 */
export function cleanText(value, max = 120) {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned || undefined;
}

/** Qloo wants a map point as "POINT(longitude latitude)": longitude first. */
export function pointWkt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new QlooError("bad_request", "That location is not a real latitude and longitude.");
  }
  return `POINT(${Number(lon.toFixed(5))} ${Number(lat.toFixed(5))})`;
}

/** Keeps only what Nion needs from one of Qloo's results, with the words cleaned. */
export function normalizeEntity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.entity_id === "string" ? raw.entity_id : undefined;
  const name = cleanText(raw.name);
  if (!id || !name) return null;

  const query = raw.query ?? {};
  const properties = raw.properties ?? {};
  const number = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined);
  const location =
    Number.isFinite(raw.location?.lat) && Number.isFinite(raw.location?.lon)
      ? { lat: raw.location.lat, lon: raw.location.lon }
      : undefined;
  const subtype = typeof raw.subtype === "string" ? raw.subtype.split(":").pop() : undefined;

  // Qloo's own reason for a pick, when asked for: how much each liked item (by its ID) drove it.
  // The shares add up to about 1. Anything unreadable is simply left out.
  const shares = raw.query?.explainability?.["signal.interests.entities"];
  const because = Array.isArray(shares)
    ? shares
        .filter((s) => typeof s?.entity_id === "string" && Number.isFinite(s?.score) && s.score >= 0 && s.score <= 1)
        .map((s) => ({ id: s.entity_id, share: Number(s.score.toFixed(2)) }))
    : [];

  return {
    id,
    name,
    kind: subtype,
    // For a place this is its address; for other things, a short description.
    detail: cleanText(raw.disambiguation),
    distanceM: Number.isFinite(query.distance) ? Math.round(query.distance) : undefined,
    // How well this fits the person's taste, 0 to 1. Only present when taste was given.
    match: number(query.affinity, 2),
    priceLevel: Number.isFinite(properties.price_level) ? properties.price_level : undefined,
    rating: number(properties.business_rating, 1),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((tag) => cleanText(tag?.name, 40))
      .filter(Boolean)
      .slice(0, 6),
    location,
    because,
  };
}

/**
 * Chooses the best tag for a word like "ramen" from Qloo's tag search. A tag has an ID
 * such as "urn:tag:genre:place:restaurant:ramen"; `prefixes` says which families to prefer,
 * in order. Returns the tag, or undefined if nothing is close enough.
 */
export function pickTag(tags, prefixes = []) {
  const list = Array.isArray(tags) ? tags.filter((tag) => typeof tag?.id === "string") : [];
  for (const prefix of prefixes) {
    const found = list.find((tag) => tag.id.startsWith(prefix));
    if (found) return { id: found.id, name: cleanText(found.name, 40) };
  }
  return undefined;
}

function errorForStatus(status) {
  if (status === 401 || status === 403) {
    return new QlooError("auth", "Qloo rejected the API key. It must be the hackathon key.");
  }
  if (status === 429) return new QlooError("rate_limited", "Qloo says too many requests. Try again shortly.");
  if (status >= 400 && status < 500) return new QlooError("bad_request", `Qloo could not use that request (${status}).`);
  return new QlooError("unavailable", `Qloo is not answering properly (${status}).`);
}

/**
 * Makes a Qloo helper. `fetchImpl` and `baseUrl` can be swapped, which is how the tests
 * run with a pretend Qloo and spend nothing.
 */
export function createQloo({
  apiKey,
  fetchImpl = fetch,
  baseUrl = BASE_URL,
  timeoutMs = 8000,
  // Qloo allows 5 calls a second on a hackathon key (and 10,000 a month, which the
  // answers report in x-month-ratelimit-* headers). Calls are spaced a little more than
  // 1/5 of a second apart so a few people at once do not trip the limit.
  minGapMs = 230,
  retryAfter429Ms = 1100,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  if (!apiKey) {
    throw new QlooError("missing_key", "QLOO_API_KEY is missing. Put your Qloo hackathon key in the .env file.");
  }

  // Waits for this call's turn. Each call takes the next free slot, so calls never bunch up.
  let nextSlot = 0;
  async function waitForTurn() {
    const at = Math.max(now(), nextSlot);
    nextSlot = at + minGapMs;
    if (at > now()) await sleep(at - now());
  }

  // The last monthly allowance Qloo reported, so Nion can see it running low.
  const quota = { monthRemaining: undefined, monthLimit: undefined };

  async function get(path, params, retriesLeft = 1) {
    const url = new URL(path, baseUrl);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }

    await waitForTurn();
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "X-Api-Key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new QlooError("timeout", "Qloo took too long to answer.");
      }
      throw new QlooError("unavailable", "Could not reach Qloo.");
    }

    const remaining = Number(response.headers?.get?.("x-month-ratelimit-remaining"));
    const limit = Number(response.headers?.get?.("x-month-ratelimit-limit"));
    if (Number.isFinite(remaining)) quota.monthRemaining = remaining;
    if (Number.isFinite(limit)) quota.monthLimit = limit;

    // "Too many requests" in the last second clears quickly: wait and try once more.
    if (response.status === 429 && retriesLeft > 0) {
      await sleep(retryAfter429Ms);
      return get(path, params, retriesLeft - 1);
    }
    if (!response.ok) throw errorForStatus(response.status);

    let json;
    try {
      json = await response.json();
    } catch {
      throw new QlooError("bad_answer", "Qloo's answer was not readable.");
    }
    if (json?.success === false) throw new QlooError("bad_request", "Qloo reported a problem with the request.");
    return json;
  }

  // An artist's ID or a tag's ID does not change, so a name already looked up is remembered.
  // This saves calls (the monthly allowance is 10,000) and time. Kept small on purpose.
  const lookups = new Map();
  async function remembered(key, fetchIt) {
    if (lookups.has(key)) return lookups.get(key);
    const value = await fetchIt();
    if (lookups.size >= 500) lookups.delete(lookups.keys().next().value);
    lookups.set(key, value);
    return value;
  }

  return {
    /** What Qloo last said about the monthly allowance: { monthRemaining, monthLimit }. */
    quota: () => ({ ...quota }),

    /** Look a name up to get its ID. Returns up to `take` matches, best first. */
    async searchEntities(query, kind, take = 3) {
      const type = KINDS[kind];
      const text = cleanText(query, 80);
      if (!type) throw new QlooError("bad_request", `Nion cannot search for "${kind}".`);
      if (!text) return [];
      const count = clampTake(take);
      return remembered(`entity|${kind}|${text.toLowerCase()}|${count}`, async () => {
        const json = await get("/search", { query: text, types: type, take: count });
        return (json?.results ?? []).map(normalizeEntity).filter(Boolean);
      });
    },

    /** Look a word like "ramen" up to get tag IDs. Returns Qloo's raw tag list. */
    async searchTags(query, take = 8) {
      const text = cleanText(query, 60);
      if (!text) return [];
      const count = clampTake(take);
      return remembered(`tag|${text.toLowerCase()}|${count}`, async () => {
        const json = await get("/v2/tags", { "filter.query": text, take: count });
        const results = json?.results;
        return Array.isArray(results) ? results : (results?.tags ?? []);
      });
    },

    /**
     * Ask Qloo what a person with this taste would love.
     *   kind:       what to recommend (a key of KINDS)
     *   entityIds:  IDs of things they like (artists, films, places...)
     *   tagIds:     IDs of tastes they have (cuisines, genres...)
     *   filterTagIds: only return things that have these tags (for example one cuisine)
     *   excludeEntityIds, excludeTagIds: never return these (what the person dislikes)
     *   place:      { lat, lon } to keep results near a spot (places and destinations only)
     *   radiusM:    how far from that spot, in metres
     */
    async recommend({ kind, entityIds = [], tagIds = [], filterTagIds = [], excludeEntityIds = [], excludeTagIds = [], place, radiusM = 2000, take = 5 }) {
      const type = KINDS[kind];
      if (!type) throw new QlooError("bad_request", `Nion cannot recommend "${kind}".`);

      const params = {
        "filter.type": type,
        take: clampTake(take),
        "signal.interests.entities": entityIds.join(","),
        "signal.interests.tags": tagIds.join(","),
        "filter.tags": filterTagIds.join(","),
        // Things the person said they dislike. Qloo leaves out exactly these (and fills the list from further down).
        "filter.exclude.entities": excludeEntityIds.join(","),
        "filter.exclude.tags": excludeTagIds.join(","),
      };
      // With two or more liked items Qloo can say how much each one drove a pick. (With one, it would
      // always be "all of it", so it is not asked for.) It does not slow the answer measurably.
      if (entityIds.length >= 2) params["feature.explainability"] = "true";
      if (place && LOCATION_KINDS.has(kind)) {
        params["filter.location"] = pointWkt(place.lat, place.lon);
        params["filter.location.radius"] = Math.min(Math.max(Math.round(radiusM), 100), 50000);
      }

      const json = await get("/v2/insights", params);
      const entities = json?.results?.entities;
      if (!Array.isArray(entities)) throw new QlooError("bad_answer", "Qloo's answer had no results list.");
      return entities.map(normalizeEntity).filter(Boolean);
    },
  };
}

function clampTake(take) {
  const n = Math.round(Number(take));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_TAKE) : 5;
}
