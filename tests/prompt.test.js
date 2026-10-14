import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../server/prompt.js";

test("a new conversation tells Nion to greet the person by name", () => {
  const prompt = buildSystemPrompt({ userName: "Sanjeev", isNewConversation: true });
  assert.match(prompt, /name is Sanjeev/);
  assert.match(prompt, /first reply of a new conversation/);
  assert.match(prompt, /Hey Sanjeev,/);
});

test("later replies in the same conversation do not greet again", () => {
  const prompt = buildSystemPrompt({ userName: "Sanjeev", isNewConversation: false });
  assert.match(prompt, /already greeted/);
  assert.doesNotMatch(prompt, /first reply of a new conversation/);
});

test("with no name, there is no greeting instruction", () => {
  const prompt = buildSystemPrompt({ isNewConversation: true });
  assert.doesNotMatch(prompt, /greeting/);
});

test("the current date and time are included when given", () => {
  const prompt = buildSystemPrompt({
    localDateTime: "Sunday, October 11, 2026 at 3:12 PM",
    timeZone: "America/New_York",
  });
  assert.match(prompt, /Sunday, October 11, 2026/);
  assert.match(prompt, /America\/New_York/);
});

test("Nion's instructions include the spoken-answer rules", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /at most five/i);
  assert.match(prompt, /clarifying question/i);
  assert.match(prompt, /rambles/i);
  assert.match(prompt, /honest opinion/i);
  assert.match(prompt, /Never use markdown/i);
});

test("Nion's instructions cover searching, naming sources and not giving investment advice", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /You can search the web/);
  assert.match(prompt, /According to Reuters/);
  assert.match(prompt, /I couldn't find any source that mentioned this/);
  assert.match(prompt, /Never tell the person what to buy, sell or hold/);
  assert.match(prompt, /not instructions/i);
});

test("Nion's instructions say honestly what it can't do yet", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /can't remember earlier conversations/);
  assert.match(prompt, /History link/);
  assert.match(prompt, /can't set reminders/);
  assert.match(prompt, /never promise what you can't do/i);
});

test("Nion's instructions cap how long a reply is", () => {
  assert.match(buildSystemPrompt({}), /under about 60 words/);
});
