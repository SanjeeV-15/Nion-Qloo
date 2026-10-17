import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours, openStatus, timeZoneFor } from "../server/hours.js";

// Qloo's shape (made-up hours): a time is "T10:00:00", and a closed day says closed: true.
const span = (opens, closes) => [{ opens: `T${opens}:00`, closes: `T${closes}:00`, closed: false }];
const closed = [{ opens: null, closes: null, closed: true }];
const week = (over = {}) => ({
  sunday: closed, monday: span("10:00", "17:00"), tuesday: span("10:00", "17:00"), wednesday: span("10:00", "17:00"),
  thursday: span("10:00", "17:00"), friday: span("10:00", "22:00"), saturday: span("10:00", "22:00"), ...over,
});

// A moment given as local time at a place. Denver is UTC-6 on 20 Oct 2026 (MDT), so 15:00 UTC is 09:00 there.
// Tuesday 20 October 2026.
const at = (utcHour, utcMinute = 0, day = 20) => new Date(Date.UTC(2026, 9, day, utcHour, utcMinute));

test("Qloo's hours are read into minutes, with closed days as an empty list", () => {
  const hours = parseHours(week());
  assert.deepEqual(hours.monday, [{ opens: 600, closes: 1020 }]);
  assert.deepEqual(hours.sunday, []);
  assert.deepEqual(hours.friday, [{ opens: 600, closes: 1320 }]);
});

test("anything unusable gives no hours, never a guess", () => {
  assert.equal(parseHours(undefined), undefined);
  assert.equal(parseHours("nope"), undefined);
  assert.equal(parseHours({}), undefined);
  assert.equal(parseHours({ monday: "x", tuesday: [{ opens: "soon", closes: "later" }] }).tuesday.length, 0);
});

test("a place open late is open until the early hours, and midnight is a closing time", () => {
  assert.deepEqual(parseHours({ friday: span("18:00", "02:00") }).friday, [{ opens: 1080, closes: 1560 }]);
  assert.deepEqual(parseHours({ friday: span("18:00", "00:00") }).friday, [{ opens: 1080, closes: 1440 }]);
});

test("open now: it says when it closes", () => {
  // Tuesday 10:30 in Denver
  const status = openStatus(parseHours(week()), "America/Denver", at(16, 30));
  assert.deepEqual(status, { open: true, label: "Open until 5 pm" });
});

test("closed before opening, the same day: it says when it opens", () => {
  // Tuesday 08:00 in Denver
  assert.deepEqual(openStatus(parseHours(week()), "America/Denver", at(14, 0)), { open: false, label: "Closed now, opens at 10 am" });
});

test("closed after closing: it opens tomorrow", () => {
  // Tuesday 18:00 in Denver
  assert.deepEqual(openStatus(parseHours(week()), "America/Denver", at(0, 0, 21)), { open: false, label: "Closed now, opens tomorrow at 10 am" });
});

test("closed all day: it names the day it next opens", () => {
  // Sunday 12:00 in Denver (Sunday is closed in this week): opens Monday, which is "tomorrow"
  assert.equal(openStatus(parseHours(week()), "America/Denver", at(18, 0, 18)).label, "Closed now, opens tomorrow at 10 am");
  // A week where Monday is closed too: it opens Tuesday
  const label = openStatus(parseHours(week({ monday: closed })), "America/Denver", at(18, 0, 18)).label;
  assert.equal(label, "Closed now, opens Tuesday at 10 am");
});

test("a place open past midnight is still open after midnight, by yesterday's hours", () => {
  const hours = parseHours(week({ friday: span("18:00", "02:00"), saturday: closed }));
  // Saturday 17 October, 01:00 in Denver (07:00 UTC) is still Friday night's late hours
  assert.deepEqual(openStatus(hours, "America/Denver", at(7, 0, 17)), { open: true, label: "Open until 2 am" });
  // Saturday 03:00 (09:00 UTC): it has closed
  assert.equal(openStatus(hours, "America/Denver", at(9, 0, 17)).open, false);
});

test("a place open all day is open 24 hours", () => {
  const hours = parseHours(week({ tuesday: span("00:00", "00:00") }));
  assert.deepEqual(openStatus(hours, "America/Denver", at(20, 0)), { open: true, label: "Open 24 hours" });
});

test("noon, half hours and midnight are said the way people say them", () => {
  const hours = parseHours(week({ tuesday: span("11:30", "12:00") }));
  assert.equal(openStatus(hours, "America/Denver", at(17, 45)).label, "Open until noon"); // 11:45 in Denver
  assert.equal(openStatus(parseHours(week({ tuesday: span("10:00", "17:45") })), "America/Denver", at(16, 30)).label, "Open until 5:45 pm");
});

test("the time is the time AT THE PLACE, not where the person is", () => {
  const hours = parseHours(week());
  // The same instant: 16:30 UTC is 10:30 in Denver (open) and 17:30 in Lisbon (closed, it shut at 5 pm).
  assert.equal(openStatus(hours, "America/Denver", at(16, 30)).open, true);
  assert.equal(openStatus(hours, "Europe/Lisbon", at(16, 30)).open, false);
});

test("a day with no hours given, no hours at all, or an unknown time zone is not guessed at", () => {
  assert.equal(openStatus(undefined, "America/Denver", at(16, 30)), null);
  assert.equal(openStatus(parseHours({ friday: span("10:00", "17:00") }), "America/Denver", at(16, 30)), null, "Tuesday is not listed");
  assert.equal(openStatus(parseHours(week()), "Not/AZone", at(16, 30)), null);
  assert.equal(openStatus(parseHours(week()), undefined, at(16, 30)), null);
});

test("the time zone comes from the place's coordinates", () => {
  assert.equal(timeZoneFor({ lat: 39.7392, lon: -104.9903 }, "Europe/Paris"), "America/Denver");
  assert.equal(timeZoneFor({ lat: 38.7077, lon: -9.1366 }, "America/Denver"), "Europe/Lisbon");
  assert.equal(timeZoneFor({ lat: 95, lon: 0 }, "America/Denver"), "America/Denver", "bad coordinates fall back");
  assert.equal(timeZoneFor(undefined, "America/Denver"), "America/Denver");
});
