import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlace, wantsDeviceLocation } from "../public/js/location.js";
import { decide } from "../public/js/conversation.js";

test("understands the usual ways of saying where you are", () => {
  assert.equal(extractPlace("I'm in Miami"), "Miami");
  assert.equal(extractPlace("I am in Brickell, Miami."), "Brickell, Miami");
  assert.equal(extractPlace("we're staying in downtown Denver"), "downtown Denver");
  assert.equal(extractPlace("I'm at 1200 Brickell Avenue, Miami"), "1200 Brickell Avenue, Miami");
  assert.equal(extractPlace("in Portland, Oregon"), "Portland, Oregon");
});

test("when Nion has just asked, a bare place counts", () => {
  assert.equal(extractPlace("Miami", { asked: true }), "Miami");
  assert.equal(extractPlace("Brickell Miami please", { asked: true }), "Brickell Miami");
  assert.equal(extractPlace("123 Main Street, Seattle", { asked: true }), "123 Main Street, Seattle");
});

test("without being asked, a bare phrase is not taken as a place", () => {
  assert.equal(extractPlace("Miami"), null);
  assert.equal(extractPlace("what time is it"), null);
});

test("questions and non-answers are not places", () => {
  for (const heard of ["what is the time in Denver", "I don't know", "never mind", "no", "tell me a joke", "", "a"]) {
    assert.equal(extractPlace(heard, { asked: true }), null, `should not be a place: "${heard}"`);
  }
});

test("a place is cut down to safe letters and numbers", () => {
  assert.equal(extractPlace("I'm in Miami <script>alert(1)</script>"), "Miami scriptalert1script");
  assert.equal(extractPlace("I'm in " + "very ".repeat(30) + "far"), null, "far too long to be a place");
});

test("says to use the device's location", () => {
  for (const heard of ["use my location", "Use my current location", "allow location", "my location", "yes", "sure", "go ahead", "GPS"]) {
    assert.equal(wantsDeviceLocation(heard), true, `should use the device location: "${heard}"`);
  }
  assert.equal(wantsDeviceLocation("I'm in Miami"), false);
  assert.equal(wantsDeviceLocation("what is the weather"), false);
});

test("after Nion asks where you are, the decision follows what you say", () => {
  const asking = { active: false, followUp: false, awaiting: "place" };
  assert.deepEqual(decide(asking, "I'm in Brickell, Miami"), { type: "setPlace", place: "Brickell, Miami" });
  assert.deepEqual(decide(asking, "Miami"), { type: "setPlace", place: "Miami" });
  assert.deepEqual(decide(asking, "use my location"), { type: "useDeviceLocation" });
  assert.deepEqual(decide(asking, "what is the time in Denver"), { type: "placeRetry" });
  assert.deepEqual(decide(asking, "end the conversation"), { type: "end" });
});
