// Is a place open right now, and when does it close or open?
//
// Qloo gives each place its opening hours by day of the week, like
//   friday: [{ opens: "T10:00:00", closes: "T17:00:00", closed: false }], monday: [{ closed: true }]
// but it cannot say "open now" (its own hours filter only takes a day of the week). So it is worked out
// here, using the local time AT THE PLACE: a time-zone lookup from the place's coordinates, so it is right
// for a restaurant in Lisbon even when the person asking is in Denver.
//
// Everything takes the time as a parameter, so tests can run any hour of any day.

import tzlookup from "tz-lookup";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_MINUTES = 1440;

function minutesOf(text) {
  const match = /(\d{1,2}):(\d{2})/.exec(typeof text === "string" ? text : "");
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

/**
 * Reads Qloo's hours into { monday: [{ opens, closes }, ...], ... }, in minutes since midnight. A closing
 * time at or before the opening time means the place stays open past midnight, so it is written as more than
 * 1440. A day with no opening hours given is left out (unknown), and a day marked closed is an empty list.
 * Returns undefined if nothing usable was there.
 */
export function parseHours(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const week = {};
  for (const day of DAYS) {
    const spans = raw[day];
    if (!Array.isArray(spans)) continue;
    const open = [];
    for (const span of spans.slice(0, 4)) {
      if (!span || span.closed === true) continue;
      const opens = minutesOf(span.opens);
      let closes = minutesOf(span.closes);
      if (opens === undefined || closes === undefined) continue;
      if (closes <= opens) closes += DAY_MINUTES; // "00:00" as a closing time is midnight; "02:00" is the early hours
      open.push({ opens, closes });
    }
    week[day] = open;
  }
  return Object.keys(week).length > 0 ? week : undefined;
}

/** The IANA time zone at a point on the map, or the fallback if it cannot be worked out. */
export function timeZoneFor(location, fallback) {
  try {
    if (Number.isFinite(location?.lat) && Number.isFinite(location?.lon)) return tzlookup(location.lat, location.lon);
  } catch {
    // Not a place tz-lookup knows: use the fallback.
  }
  return fallback;
}

// "5 pm", "5:30 pm", "noon", "midnight"
function clock(minutes) {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  const hour = Math.floor(m / 60);
  const minute = m % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "am" : "pm"}`;
}

// The weekday and minutes since midnight where the place is.
function localTime(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const day = DAYS.indexOf(String(get("weekday")).toLowerCase());
    const minutes = Number(get("hour")) * 60 + Number(get("minute"));
    return day >= 0 && Number.isFinite(minutes) ? { day, minutes } : null;
  } catch {
    return null; // not a time zone this computer knows
  }
}

/**
 * { open: true|false, label } for a place right now, or null if it cannot be told (no hours, or a day with no
 * hours given, or an unknown time zone). Never guesses.
 *   label: "Open until 5 pm", "Open 24 hours", "Closed now, opens at 10 am", "Closed now, opens tomorrow at
 *          10 am", "Closed now, opens Tuesday at 10 am", or "Closed now" if no opening is listed this week.
 */
export function openStatus(hours, timeZone, now = new Date()) {
  if (!hours || !timeZone) return null;
  const here = localTime(now, timeZone);
  if (!here) return null;
  const today = hours[DAYS[here.day]];
  if (!today) return null;
  const yesterday = hours[DAYS[(here.day + 6) % 7]] ?? [];

  // Open from a late night that began yesterday?
  for (const span of yesterday) {
    if (span.closes > DAY_MINUTES && here.minutes < span.closes - DAY_MINUTES) {
      return { open: true, label: `Open until ${clock(span.closes)}` };
    }
  }
  // Open in one of today's spans?
  for (const span of today) {
    if (here.minutes >= span.opens && here.minutes < span.closes) {
      return { open: true, label: span.closes - span.opens >= DAY_MINUTES ? "Open 24 hours" : `Open until ${clock(span.closes)}` };
    }
  }
  // Closed: when does it next open?
  const later = today.filter((span) => span.opens > here.minutes).sort((a, b) => a.opens - b.opens)[0];
  if (later) return { open: false, label: `Closed now, opens at ${clock(later.opens)}` };
  for (let ahead = 1; ahead <= 7; ahead++) {
    const spans = hours[DAYS[(here.day + ahead) % 7]];
    if (!spans || spans.length === 0) continue;
    const first = [...spans].sort((a, b) => a.opens - b.opens)[0];
    const when = ahead === 1 ? "tomorrow" : DAYS[(here.day + ahead) % 7].replace(/^./, (c) => c.toUpperCase());
    return { open: false, label: `Closed now, opens ${when} at ${clock(first.opens)}` };
  }
  return { open: false, label: "Closed now" };
}
