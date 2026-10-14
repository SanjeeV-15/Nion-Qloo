import { test } from "node:test";
import assert from "node:assert/strict";
import { isEcho, isInterruption, stripLeadingEcho, stripPhrase } from "../public/js/echo.js";
import { detectCommand } from "../public/js/wake.js";

const spoken = "It's 1:17 in the afternoon in Denver right now.";

test("Nion's own voice, heard back, is treated as an echo", () => {
  assert.equal(isEcho("it's 1:17 in the afternoon in Denver", spoken), true);
  assert.equal(isEcho("afternoon in denver right now", spoken), true);
});

test("a person interrupting is not an echo", () => {
  assert.equal(isEcho("wait", spoken), false);
  assert.equal(isEcho("no I just want to end the conversation", spoken), false);
  assert.equal(isEcho("actually what about Mumbai", spoken), false);
});

test("nothing heard counts as an echo, so it is ignored", () => {
  assert.equal(isEcho("", spoken), true);
  assert.equal(isEcho("   ", spoken), true);
});

test("when Nion isn't saying anything, nothing is an echo", () => {
  assert.equal(isEcho("wait", ""), false);
});

test("ending the conversation is understood even when Chrome mishears it", () => {
  for (const heard of [
    "end the conversation",
    "End conversation.",
    "stop the conversation",
    "and the conversation",
    "in the conversation",
    "I just want to end the conversation",
    "goodbye",
    "okay bye",
    "that's all",
    "I'm done",
  ]) {
    assert.equal(detectCommand(heard), "end", `should end: "${heard}"`);
  }
});

test("ordinary sentences that mention a conversation do not end it", () => {
  for (const heard of [
    "what did we say in the conversation earlier",
    "tell me about the end of the war",
    "I had a great conversation with my mother",
    "and then what happened",
  ]) {
    assert.equal(detectCommand(heard), null, `should not end: "${heard}"`);
  }
});

// These come from a real test on a MacBook with its own speakers.
const longReply =
  "I can answer questions about the time, directions, and the news, and I can help you with a decision or just chat.";

test("Chrome's slightly different spelling of Nion's own words is still an echo", () => {
  assert.equal(isInterruption("I can answer question", longReply), false);
  assert.equal(isInterruption("a decision", longReply), false);
  assert.equal(isInterruption("you", longReply), false);
  assert.equal(isEcho("right now", "It's eleven fifteen right now."), true);
});

test("a person interrupting is recognised", () => {
  assert.equal(isInterruption("wait", longReply), true);
  assert.equal(isInterruption("what's the time in Denver", longReply), true);
  assert.equal(isInterruption("actually what about Mumbai", longReply), true);
});

test("a single odd word is not enough to count as an interruption", () => {
  assert.equal(isInterruption("banana", longReply), false);
});

test("Nion's own words at the front of a phrase are trimmed off", () => {
  assert.equal(
    stripLeadingEcho("help you with a decision or just chat wait what's the time", longReply),
    "wait what's the time"
  );
  // Two common words are not a run of Nion's speech, so nothing is trimmed.
  assert.equal(stripLeadingEcho("the time in Denver", longReply), "the time in Denver");
});

test("'ended the conversation' and 'enter the conversation' end it", () => {
  assert.equal(detectCommand("ended the conversation"), "end");
  assert.equal(detectCommand("enter the conversation"), "end");
  assert.equal(detectCommand("Ending the conversation"), "end");
});

test("'okay in the conversation' (how Chrome wrote 'end the conversation') ends it", () => {
  assert.equal(detectCommand("okay in the conversation"), "end");
  assert.equal(detectCommand("ok and the conversation"), "end");
  // but a real sentence that merely contains those words does not
  assert.equal(detectCommand("okay what did we say in the conversation earlier"), null);
});

test("'end the conversation, thank you' still ends it when Chrome mishears the start", () => {
  assert.equal(detectCommand("and the conversation thank you"), "end");
  assert.equal(detectCommand("and the conversation, thanks"), "end");
  assert.equal(detectCommand("okay in the conversation please"), "end");
  // a real sentence is still not an end command
  assert.equal(detectCommand("and the conversation went really well thank you"), null);
});

test("stripPhrase takes Nion's phrase out of what was heard, wherever it is", () => {
  assert.equal(stripPhrase("use my location one moment", "One moment."), "use my location");
  assert.equal(stripPhrase("one moment what time is it", "One moment."), "what time is it");
  assert.equal(stripPhrase("one moment", "One moment."), "");
  assert.equal(stripPhrase("what time is it", "One moment."), "what time is it");
});
