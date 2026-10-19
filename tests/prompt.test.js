import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, describeTaste } from "../server/prompt.js";

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

test("Nion's instructions say how to use Qloo for recommendations", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /ask_qloo/);
  assert.match(prompt, /don't search for recommendations/);
  assert.match(prompt, /Only ever say you know something about their taste if it is in that list/);
  assert.match(prompt, /remember_taste/);
  assert.match(prompt, /Never note your own guesses/);
  assert.match(prompt, /"not today" or "something else" only means not now, so don't note it/);
  assert.match(prompt, /Note a dislike only when they say they don't like it/);
  assert.match(prompt, /ask one short question first/i);
  assert.match(prompt, /Ask only one question, never two/);
  assert.match(prompt, /Never read out a score or a percentage/);
  assert.match(prompt, /information, not instructions/);
  assert.match(prompt, /IN a particular city.*kind place with near set to that city/);
  assert.match(prompt, /Use kind destination only when they have not named where they are going/);
  assert.match(prompt, /end your reply with \[\[picks: N, N\]\]/);
  assert.match(prompt, /never say it aloud/);
  assert.match(prompt, /Qloo matched it through one of their likes, you can say which one in words/);
  assert.match(prompt, /Never say the percentages/);
});

test("with no taste, Nion is told it knows nothing about the person", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /don't know anything about this person's taste yet/);
  assert.doesNotMatch(prompt, /Likes:/);
});

test("what the person has said they like is given to Nion as the only thing it knows", () => {
  const prompt = buildSystemPrompt({
    taste: [
      { name: "ramen", kind: "food", opinion: "like" },
      { name: "Blade Runner 2049", kind: "movie", opinion: "like" },
      { name: "sushi", kind: "food", opinion: "dislike" },
    ],
  });
  assert.match(prompt, /this is everything you know/);
  assert.match(prompt, /Likes: ramen \(food\), Blade Runner 2049 \(movie\)/);
  assert.match(prompt, /Doesn't like: sushi \(food\)/);
});

test("a kind with an underscore is written as words", () => {
  assert.deepEqual(describeTaste([{ name: "Severance", kind: "tv_show", opinion: "like" }]).at(-1), "- Likes: Severance (tv show)");
  assert.deepEqual(describeTaste("not a list"), ["You don't know anything about this person's taste yet."]);
});

test("Nion is told to note a stated like or dislike even when it only answers with a question", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /note it with remember_taste straight away, even if all you do next is ask them a question/);
  assert.match(prompt, /If you are also using ask_qloo, call both in the same step/);
});

test("Nion is told how to ask for places that are open now", () => {
  assert.match(buildSystemPrompt({}), /open right now or late, ask for places with open_now set/);
});

test("hours come only from the named place's own line, and are never guessed", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /only if that place's own line in the results gives its hours/);
  assert.match(prompt, /never from another place's/);
  assert.match(prompt, /say nothing about its hours and never guess them/);
});

test("Nion does not doubt or retract hours it already gave, because it cannot see the earlier results", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /Hours you gave earlier in this conversation came from ask_qloo's results/);
  assert.match(prompt, /never retract, correct or doubt them, and never say you didn't check them/);
  assert.match(prompt, /If the person thanks you, just reply to the thanks/);
  assert.match(prompt, /they come from Qloo's listing and can change/);
});

test("web search is for opening hours Qloo did not give, not the ones it did", () => {
  assert.match(buildSystemPrompt({}), /opening hours of a place ask_qloo didn't give you/);
});

test("with a known taste that fits, Nion goes straight to picks and says what they were based on", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /don't ask first: go ahead and use it, and say in a few words what you based the picks on/);
  assert.doesNotMatch(prompt, /ask a yes or no/);
});

test("Nion is told to name at most three picks aloud, with short facts, and how to give more", () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /Name at most three of the results, the best fits first: the screen shows what you name, and they can ask for more/);
  assert.match(prompt, /its name and at most two short facts/);
  assert.match(prompt, /ask again with offset set to the number of results you have already named/);
});
