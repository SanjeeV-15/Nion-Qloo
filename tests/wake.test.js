import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUtterance } from "../public/js/wake.js";

test("hears the wake phrase and keeps the question", () => {
  const result = parseUtterance("Hey Nion, what is today's date?");
  assert.equal(result.woke, true);
  assert.equal(result.question, "what is today's date?");
});

test("accepts other spellings of the name that Chrome might write", () => {
  for (const heard of [
    "hey neon what time is it",
    "Hey Nyan what time is it",
    "hey ni on what time is it",
    "Hey, nee on, what time is it",
    "okay nion what time is it",
  ]) {
    const result = parseUtterance(heard);
    assert.equal(result.woke, true, `should wake for: ${heard}`);
    assert.match(result.question, /what time is it/i, `question kept for: ${heard}`);
  }
});

test("a lone wake phrase wakes Nion with an empty question", () => {
  const result = parseUtterance("Hey Nion.");
  assert.equal(result.woke, true);
  assert.equal(result.question, "");
});

test("ignores speech that has no wake phrase", () => {
  for (const heard of [
    "what is the date today",
    "I think neon signs are pretty",
    "hey there how are you",
    "",
    undefined,
  ]) {
    assert.equal(parseUtterance(heard).woke, false, `should ignore: ${heard}`);
  }
});

test("does not wake on longer words that only start like the name", () => {
  assert.equal(parseUtterance("hey nionic is a word").woke, false);
});

test("finds the wake phrase in the middle of what was heard", () => {
  const result = parseUtterance("so um hey nion what's the weather like");
  assert.equal(result.woke, true);
  assert.equal(result.question, "what's the weather like");
});
