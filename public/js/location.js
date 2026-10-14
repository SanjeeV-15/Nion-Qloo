// Where the person is.
//
// Nion only asks for a location when a question needs one ("places to eat around
// me"). It asks out loud, and the person can either say where they are ("I'm in
// Brickell, Miami") or say "use my location" to share their device's location.
//
// The first two functions only read text, so they are easy to test. The last two
// talk to the browser's location feature.

// A reply that is a question or a request, not a place.
const NOT_A_PLACE = /^(?:what|what's|how|why|when|who|where|can|could|would|will|do|does|is|are|tell|give|find|show|hey|i don't know|i do not know|no|nope|never mind|nevermind|skip|cancel|not sure)\b/i;

// Words people say to share their device's location.
const DEVICE_WORDS =
  /\b(?:use|allow|share|check|find|get|enable|turn on)\s+(?:my\s+|the\s+)?(?:current\s+)?(?:location|gps)\b|\bmy (?:current )?location\b|\b(?:allow|share) (?:it|location)\b|\bgps\b|\bcurrent location\b/i;
const YES_ONLY = /^(?:yes|yeah|yep|sure|okay|ok|go ahead|please do|do it|allow)\W*$/i;

/** True if the person said to use their device's location. */
export function wantsDeviceLocation(text) {
  const heard = String(text ?? "").trim();
  return DEVICE_WORDS.test(heard) || YES_ONLY.test(heard);
}

/**
 * Find a place in what the person said.
 *   asked: true when Nion has just asked where they are, so a bare "Miami" or
 *          "123 Main Street, Seattle" counts. Otherwise only "I'm in ..." counts.
 * Returns the place as text, or null.
 */
export function extractPlace(text, { asked = false } = {}) {
  const heard = String(text ?? "").trim().replace(/[.!?]+$/, "");
  if (!heard) return null;

  const explicit =
    /\b(?:i'm|i am|we're|we are|currently|located|staying|visiting)\s+(?:currently\s+)?(?:in|at|near|around|by|on)\s+(.+)$/i.exec(heard) ||
    /^(?:in|at|near|around|by)\s+(.+)$/i.exec(heard) ||
    /\bmy location is\s+(.+)$/i.exec(heard);

  let candidate = explicit?.[1] ?? (asked ? heard : null);
  if (!candidate) return null;
  if (!explicit && NOT_A_PLACE.test(candidate)) return null;

  candidate = candidate
    .replace(/\b(?:please|thanks|thank you|right now|at the moment|currently)\b/gi, "")
    .replace(/[^\p{L}\p{N}\p{M}\s,.'#&-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const wordCount = candidate.split(" ").length;
  if (wordCount > 10 || (candidate.match(/\p{L}/gu) ?? []).length < 2) return null;
  return candidate;
}

/** "granted", "denied", "prompt", or "unknown": has the person already allowed location? */
export async function geolocationPermission() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Asks the browser for the device's location. Rejects if it is denied or takes too long. */
export function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't supported here."));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(error),
      // A recent position is fine (a few minutes), and there's no need for pinpoint accuracy.
      { timeout: 10000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}
