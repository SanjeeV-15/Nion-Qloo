// Turns a person's location into something Nion can use.
//
// The browser gives GPS coordinates (numbers). Web search wants a place name, so we
// look the coordinates up. The main lookup is OpenStreetMap's free "Nominatim"
// service, which gives a neighbourhood (like "Brickell") as well as the city, which
// is what makes "near me" mean near me. If that is unreachable, a small, fast
// Claude model names just the city, state and country instead.
//
// It also works the other way: a place the person says or types ("Lisbon", "Brickell,
// Miami") is looked up to get coordinates, because Qloo finds things near a point on the map.
//
// Nominatim's rules (https://operations.osmfoundation.org/policies/nominatim/): no
// more than one request a second, and an identifying User-Agent. Nion remembers each
// answer and waits its turn between requests, so several people at once stay polite.

// Tests point this at a pretend server.
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const MAX_REMEMBERED = 500;

const cache = new Map();
const geocodeCache = new Map();
let nextSlot = 0;

// Takes the next free slot, at least 1.1 seconds after the last one. Slots are reserved before
// waiting, so two lookups arriving together do not both go at once.
async function politeWait(sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + 1100;
  if (at > Date.now()) await sleep(at - Date.now());
}

function remember(map, key, value) {
  if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value);
  map.set(key, value);
}

/** Keep a place word safe to put into Nion's instructions: letters and a few marks. */
export function cleanPlacePart(value, max = 60) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\p{L}\p{M}\s.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned && cleaned !== "-" ? cleaned : undefined;
}

/** Reads Nominatim's answer into { area, city, region, country }, or null if there is no city. */
export function placeFromNominatim(json) {
  const a = json?.address ?? {};
  const city = cleanPlacePart(a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county);
  if (!city) return null;
  const country = /^[A-Za-z]{2}$/.test(a.country_code ?? "") ? a.country_code.toUpperCase() : undefined;
  return {
    area: cleanPlacePart(a.neighbourhood ?? a.suburb ?? a.quarter),
    city,
    region: cleanPlacePart(a.state),
    country,
  };
}

/** Reads a line like "Miami | Florida | US" (from Claude) into a place. A dash means "not sure". */
export function parsePlaceLine(line) {
  const parts = String(line ?? "").split("|").map((part) => part.trim());
  const city = cleanPlacePart(parts[0]);
  if (!city) return null;
  return {
    city,
    region: cleanPlacePart(parts[1]),
    country: /^[A-Za-z]{2}$/.test(parts[2] ?? "") ? parts[2].toUpperCase() : undefined,
  };
}

/** "Brickell, Miami, Florida, US": how a place is written in Nion's instructions. */
export function describePlace(place) {
  return [place?.area, place?.city, place?.region, place?.country].filter(Boolean).join(", ");
}

async function fromNominatim(lat, lon) {
  await politeWait();
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Nion/0.1 (hackathon demo; github.com/SanjeeV-15)" },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Nominatim said ${response.status}`);
  return placeFromNominatim(await response.json());
}

async function fromClaude(client, lat, lon) {
  const response = await client.messages.create({
    model: "claude-haiku-5-5",
    // Generous on purpose: the model may spend some of this thinking first.
    max_tokens: 1000,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content:
          `GPS coordinates: ${lat.toFixed(4)},${lon.toFixed(4)}. ` +
          "Reply with only: city | state or region | two-letter country code. " +
          "Use a dash for any part you are not sure of.",
      },
    ],
  });
  const line = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return parsePlaceLine(line);
}

/**
 * Name the place for some coordinates. `client` is the Claude client (the fallback).
 * Returns { area?, city, region?, country? } or null if it couldn't be worked out.
 */
export async function resolvePlace(client, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  // Three decimal places is about a hundred metres: close enough to share an answer.
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  let place = null;
  try {
    place = await fromNominatim(lat, lon);
  } catch (error) {
    console.error("Place lookup (OpenStreetMap) failed, trying Claude:", error?.message ?? error);
  }
  if (!place) {
    try {
      place = await fromClaude(client, lat, lon);
    } catch (error) {
      console.error("Place lookup (Claude) failed:", error?.message ?? error);
    }
  }

  if (place) remember(cache, key, place);
  return place;
}

/**
 * Reads Nominatim's answer to a search into { lat, lon, area?, city, region?, country? }, or
 * null if it found nothing usable. Nominatim sends the coordinates as text, so they are checked.
 */
export function placeFromSearch(json) {
  const hit = Array.isArray(json) ? json[0] : null;
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  // A search for a whole country or region has no "city", so fall back to the name it matched.
  const named = placeFromNominatim(hit) ?? {};
  const city = named.city ?? cleanPlacePart(hit.name ?? String(hit.display_name ?? "").split(",")[0]);
  if (!city) return null;
  return { lat, lon, area: named.area, city, region: named.region, country: named.country };
}

/**
 * Finds a place the person said or typed, and where it is on the map. Returns
 * { lat, lon, area?, city, region?, country? }, or null if it could not be found.
 * `fetchImpl` and `sleep` can be swapped for pretend ones in tests.
 */
export async function geocodePlace(text, { fetchImpl = fetch, sleep } = {}) {
  const query = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!query) return null;

  const key = query.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  let place = null;
  try {
    await politeWait(sleep);
    const url = `${NOMINATIM}/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Nion/0.1 (hackathon demo; github.com/SanjeeV-15)" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Nominatim said ${response.status}`);
    place = placeFromSearch(await response.json());
  } catch (error) {
    console.error("Place search (OpenStreetMap) failed:", error?.message ?? error);
    return null; // not remembered: it may work next time
  }

  // A search that found nothing is remembered too, so a made-up place is not looked up again and again.
  remember(geocodeCache, key, place);
  return place;
}
