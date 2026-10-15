import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrain } from "../server/brain.js";
import { QlooError } from "../server/qloo.js";

// A pretend Claude. It plays back the replies it is given, one per request, and keeps the
// requests so the tests can check what Nion sent.
function pretendClaude(replies) {
  const requests = [];
  const client = {
    messages: {
      async create(request) {
        requests.push(structuredClone(request));
        const next = replies[requests.length - 1];
        if (!next) throw new Error("the pretend Claude ran out of replies");
        return next;
      },
    },
  };
  return { client, requests };
}

const text = (t) => ({ type: "text", text: t });
const done = (t, usage = {}) => ({ stop_reason: "end_turn", content: [text(t)], usage: { input_tokens: 100, output_tokens: 20, ...usage } });
const askQloo = (input, id = "toolu_1") => ({
  stop_reason: "tool_use",
  content: [text("Let me check."), { type: "tool_use", id, name: "ask_qloo", input }],
  usage: { input_tokens: 150, output_tokens: 30 },
});

const entity = (overrides = {}) => ({
  id: "P1", name: "Noodle House", kind: "place", detail: "1 Example St", distanceM: 640, match: 0.79,
  priceLevel: 1, rating: 4.4, tags: ["Ramen"], location: { lat: 1, lon: 2 }, ...overrides,
});

function pretendQloo(options = {}) {
  const calls = [];
  return {
    calls,
    async searchEntities(name) { calls.push(["entity", name]); return [{ id: "ART-1", name }]; },
    async searchTags() { return []; },
    async recommend(args) {
      calls.push(["recommend", args.kind]);
      if (options.fail) throw options.fail;
      return options.results ?? [entity()];
    },
  };
}

const ask = (brain, extra = {}) =>
  brain({ messages: [{ role: "user", content: "I'm hungry" }], context: { timeZone: "America/Denver" }, ...extra });

test("a plain question is answered in one round, with no Qloo call", async () => {
  const { client, requests } = pretendClaude([done("It's Sunday, October eleventh.")]);
  const qloo = pretendQloo();
  const result = await ask(createBrain({ client, qloo }));
  assert.equal(result.reply, "It's Sunday, October eleventh.");
  assert.equal(requests.length, 1);
  assert.equal(qloo.calls.length, 0);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.usage.qlooCalls, 0);
});

test("Haiku is the default brain, with Qloo, a taste note and a single web search on offer", async () => {
  delete process.env.NION_MODEL; // the default, whatever the shell says
  const { client, requests } = pretendClaude([done("Hi.")]);
  await ask(createBrain({ client, qloo: pretendQloo() }));
  const request = requests[0];
  assert.equal(request.model, "claude-haiku-5-5");
  const names = request.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["web_search", "ask_qloo", "remember_taste"]);
  assert.equal(request.tools[0].max_uses, 1);
});

test("Claude asks Qloo, gets the results back, and answers", async () => {
  const { client, requests } = pretendClaude([
    askQloo({ kind: "place", likes: [{ name: "Radiohead", kind: "artist" }] }),
    done("Noodle House is about eight minutes on foot and a strong fit for you. Want me to narrow it down?"),
  ]);
  const qloo = pretendQloo();
  const result = await ask(createBrain({ client, qloo }), { coords: { lat: 39.7, lon: -105 } });

  assert.match(result.reply, /Noodle House/);
  assert.deepEqual(qloo.calls, [["entity", "Radiohead"], ["recommend", "place"]]);
  assert.equal(result.usage.qlooCalls, 1);
  assert.equal(result.usage.inputTokens, 250, "tokens from both rounds are counted");

  // The second request carries Claude's own tool call and the answer to it.
  const second = requests[1].messages;
  assert.equal(second[1].role, "assistant");
  assert.equal(second[2].role, "user");
  assert.equal(second[2].content[0].type, "tool_result");
  assert.equal(second[2].content[0].tool_use_id, "toolu_1");
  assert.match(second[2].content[0].content, /Noodle House/);
  assert.equal(second[2].content[0].is_error, undefined);
});

test("what Qloo recommended is returned for the screen", async () => {
  const { client } = pretendClaude([askQloo({ kind: "place" }), done("Here you go.")]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }), { coords: { lat: 39.7, lon: -105 } });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].name, "Noodle House");
  assert.equal(result.suggestions[0].fit, "a strong fit");
});

test("what Claude said before it asked Qloo is not spoken", async () => {
  const { client } = pretendClaude([askQloo({ kind: "movie" }), done("Try Moon.")]);
  const result = await ask(createBrain({ client, qloo: pretendQloo({ results: [entity({ name: "Moon" })] }) }));
  assert.equal(result.reply, "Try Moon.");
});

test("the person's position reaches Qloo", async () => {
  const { client } = pretendClaude([askQloo({ kind: "place" }), done("ok")]);
  const calls = [];
  const qloo = { ...pretendQloo(), async recommend(args) { calls.push(args); return [entity()]; } };
  await ask(createBrain({ client, qloo }), { coords: { lat: 39.7392, lon: -104.9903 } });
  assert.deepEqual(calls[0].place, { lat: 39.7392, lon: -104.9903 });
});

test("when Qloo fails, Claude is told and can still answer the person", async () => {
  const { client, requests } = pretendClaude([askQloo({ kind: "movie" }), done("I'm having trouble reaching my sources.")]);
  const result = await ask(createBrain({ client, qloo: pretendQloo({ fail: new QlooError("unavailable", "down") }) }));
  assert.match(result.reply, /trouble reaching my sources/);
  const toolResult = requests[1].messages[2].content[0];
  assert.equal(toolResult.is_error, true);
  assert.deepEqual(result.suggestions, []);
});

test("a tool Nion does not have gets an error back, not a crash", async () => {
  const { client, requests } = pretendClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t9", name: "delete_everything", input: {} }], usage: {} },
    done("Sorry."),
  ]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.equal(result.reply, "Sorry.");
  assert.equal(requests[1].messages[2].content[0].is_error, true);
});

test("a search that pauses a reply is carried on, as before", async () => {
  const { client, requests } = pretendClaude([
    { stop_reason: "pause_turn", content: [text("Searching...")], usage: { server_tool_use: { web_search_requests: 1 } } },
    done("Here is the news."),
  ]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.equal(result.reply, "Here is the news.");
  assert.equal(result.searches, 1);
  assert.equal(requests[1].messages[1].role, "assistant");
});

test("a question can never loop forever", async () => {
  const forever = Array.from({ length: 10 }, (_, i) => askQloo({ kind: "movie" }, `toolu_${i}`));
  const { client, requests } = pretendClaude(forever);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.equal(requests.length, 5);
  assert.match(result.reply, /took too long to work out/);
  assert.doesNotMatch(result.reply, /Let me check/, "the unfinished 'let me check' is never spoken");
});

test("when the position is missing Nion asks the person for it", async () => {
  const { client } = pretendClaude([done("[[NEED_LOCATION]]")]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.equal(result.needsLocation, true);
  assert.equal(result.reply, "");
});

test("a refusal is spoken politely", async () => {
  const { client } = pretendClaude([{ stop_reason: "refusal", content: [], usage: {} }]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.match(result.reply, /can't help with that/);
});

const remember = (input, id = "toolu_r") => ({ type: "tool_use", id, name: "remember_taste", input });

test("Claude can note a taste and ask Qloo in the same step", async () => {
  const { client, requests } = pretendClaude([
    {
      stop_reason: "tool_use",
      content: [
        remember({ name: "ramen", kind: "food", opinion: "like" }),
        { type: "tool_use", id: "toolu_q", name: "ask_qloo", input: { kind: "place", tastes: ["ramen"] } },
      ],
      usage: {},
    },
    done("Sample Noodle Bar is close."),
  ]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }), { coords: { lat: 39.7, lon: -105 } });

  assert.deepEqual(result.learned, [{ name: "ramen", kind: "food", opinion: "like" }]);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.reply, "Sample Noodle Bar is close.");
  // Both answers go back together, in one step, so there is only one extra round trip.
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages[2].content.map((c) => c.tool_use_id), ["toolu_r", "toolu_q"]);
});

test("a taste that is not usable is refused without breaking the answer", async () => {
  const { client, requests } = pretendClaude([
    { stop_reason: "tool_use", content: [remember({ name: "x", kind: "nonsense", opinion: "like" })], usage: {} },
    done("Okay."),
  ]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.deepEqual(result.learned, []);
  assert.equal(requests[1].messages[2].content[0].is_error, true);
  assert.equal(result.reply, "Okay.");
});

test("only a few tastes can be saved from one question", async () => {
  const many = Array.from({ length: 8 }, (_, i) => remember({ name: `thing ${i}`, kind: "genre", opinion: "like" }, `t${i}`));
  const { client } = pretendClaude([{ stop_reason: "tool_use", content: many, usage: {} }, done("Okay.")]);
  const result = await ask(createBrain({ client, qloo: pretendQloo() }));
  assert.equal(result.learned.length, 3);
});

test("with nothing learned, the answer says so plainly", async () => {
  const { client } = pretendClaude([done("It's Sunday.")]);
  assert.deepEqual((await ask(createBrain({ client, qloo: pretendQloo() }))).learned, []);
});
