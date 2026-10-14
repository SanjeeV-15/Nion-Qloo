import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../public/js/conversation.js";
import { parseUtterance, detectCommand } from "../public/js/wake.js";

const idle = { active: false, awaiting: null };
const inConversation = { active: true, awaiting: null };

test("voice commands are recognised", () => {
  assert.equal(detectCommand("let's start a conversation"), "start");
  assert.equal(detectCommand("can we have a chat"), "start");
  assert.equal(detectCommand("end the conversation"), "end");
  assert.equal(detectCommand("okay goodbye"), "end");
  assert.equal(detectCommand("what is the end of the conversation like"), null);
  assert.equal(detectCommand("what is the date"), null);
});

test("'Hey Nion, let's start a conversation' carries the command", () => {
  const result = parseUtterance("Hey Nion, let's start a conversation");
  assert.equal(result.woke, true);
  assert.equal(result.command, "start");
});

test("when idle, speech without the wake phrase is ignored", () => {
  assert.deepEqual(decide(idle, "what is the date today"), { type: "ignore" });
});

test("when idle, wake phrase plus a question is a one-shot question", () => {
  assert.deepEqual(decide(idle, "hey nion what is today's date"), {
    type: "ask",
    question: "what is today's date",
    oneShot: true,
  });
});

test("when idle, a lone wake phrase waits for the question", () => {
  assert.deepEqual(decide(idle, "hey nion"), { type: "awaitQuestion" });
  assert.deepEqual(decide({ active: false, awaiting: "question" }, "what time is it"), {
    type: "ask",
    question: "what time is it",
    oneShot: true,
  });
});

test("'Hey Nion, let's start a conversation' starts one", () => {
  assert.deepEqual(decide(idle, "hey nion let's start a conversation"), { type: "start" });
});

test("in a conversation, follow-ups need no wake phrase", () => {
  assert.deepEqual(decide(inConversation, "and what about tomorrow"), {
    type: "ask",
    question: "and what about tomorrow",
    oneShot: false,
  });
});

test("in a conversation, saying 'Hey Nion' again is harmless", () => {
  assert.deepEqual(decide(inConversation, "hey nion what about tomorrow"), {
    type: "ask",
    question: "what about tomorrow",
    oneShot: false,
  });
});

test("'End the conversation' ends it, with or without the wake phrase", () => {
  assert.deepEqual(decide(inConversation, "end the conversation"), { type: "end" });
  assert.deepEqual(decide(inConversation, "hey nion end the conversation"), { type: "end" });
});

test("ending or starting is ignored when it makes no sense", () => {
  assert.deepEqual(decide(idle, "hey nion end the conversation"), { type: "ignore" });
  assert.deepEqual(decide(inConversation, "start a conversation"), { type: "ignore" });
});

test("after Nion asks for a name, the next thing said is the name", () => {
  const asking = { active: false, awaiting: "name" };
  assert.deepEqual(decide(asking, "Sanjeev"), { type: "setName", name: "Sanjeev" });
  assert.deepEqual(decide(asking, "my name is Sanjeev"), { type: "setName", name: "Sanjeev" });
  assert.deepEqual(decide(asking, "what is the weather in denver today please"), { type: "nameRetry" });
});

test("'call me ...' changes the name when idle (after the wake phrase) or in a conversation", () => {
  assert.deepEqual(decide(idle, "hey nion call me Sam"), { type: "setName", name: "Sam" });
  assert.deepEqual(decide(inConversation, "call me Sam"), { type: "setName", name: "Sam" });
});

test("nothing happens for empty speech", () => {
  assert.deepEqual(decide(idle, ""), { type: "ignore" });
  assert.deepEqual(decide(inConversation, "   "), { type: "ignore" });
});

test("when Chrome writes 'Hey Nion' as 'Indian', it still wakes Nion", () => {
  const start = parseUtterance("Indian let's start a conversation");
  assert.equal(start.woke, true);
  assert.equal(start.command, "start");

  const question = parseUtterance("Indian what's the time in Denver");
  assert.equal(question.woke, true);
  assert.equal(question.question, "what's the time in Denver");
});

test("'Indian' in an ordinary sentence does not wake Nion", () => {
  for (const heard of [
    "Indian food near me",
    "what are some Indian restaurants",
    "I love Indian music",
    "tell me about Indian history",
  ]) {
    assert.equal(parseUtterance(heard).woke, false, `should not wake: "${heard}"`);
  }
});

test("when Chrome writes 'Hey Nion' as 'anyone', it wakes Nion only for starting requests", () => {
  const start = parseUtterance("anyone let's start a conversation");
  assert.equal(start.woke, true);
  assert.equal(start.command, "start");

  assert.equal(parseUtterance("anyone know the time").woke, false);
  assert.equal(parseUtterance("can anyone help me").woke, false);
});

test("the other ways Chrome wrote 'Hey Nion' on the phone all wake Nion", () => {
  for (const [heard, question] of [
    ["Any on what can you do", "what can you do"],
    ["Any neon what can you do", "what can you do"],
    ["A neon what is 7+7", "what is 7+7"],
    ["Neon what is 7+7", "what is 7+7"],
    ["Nion, what's the weather like", "what's the weather like"],
  ]) {
    const result = parseUtterance(heard);
    assert.equal(result.woke, true, `should wake for: "${heard}"`);
    assert.equal(result.question, question, `question for: "${heard}"`);
  }
});

test("ordinary sentences that start with those sounds do not wake Nion", () => {
  for (const heard of [
    "neon signs are pretty",
    "a neon sign in the window",
    "any on the list",
    "nion is a nice name",
    "what can you do",
  ]) {
    assert.equal(parseUtterance(heard).woke, false, `should not wake: "${heard}"`);
  }
});

const inFollowUp = { active: false, followUp: true, awaiting: null };

test("in the follow-up window, you can ask a follow-up without the wake phrase", () => {
  assert.deepEqual(decide(inFollowUp, "and what about tomorrow"), {
    type: "ask",
    question: "and what about tomorrow",
    oneShot: false,
  });
});

test("in the follow-up window, the wake phrase is still fine", () => {
  assert.deepEqual(decide(inFollowUp, "hey nion and in Mumbai"), {
    type: "ask",
    question: "and in Mumbai",
    oneShot: false,
  });
});

test("in the follow-up window, you can still end it or start a full conversation", () => {
  assert.deepEqual(decide(inFollowUp, "end the conversation"), { type: "end" });
  assert.deepEqual(decide(inFollowUp, "let's start a conversation"), { type: "start" });
});

test("once the follow-up window has closed, the wake phrase is needed again", () => {
  const closed = { active: false, followUp: false, awaiting: null };
  assert.deepEqual(decide(closed, "and what about tomorrow"), { type: "ignore" });
});
