// The "brain": asks Claude for Nion's answer.
//
// Claude can use three tools while it answers:
//   - web search (Anthropic runs it for us), for news and facts that change;
//   - ask_qloo (we run it, see taste.js), for anything that depends on what the person
//     would love: places, music, films, travel and more; and
//   - remember_taste (also ours), to note something the person says they like or dislike.
//
// The Claude SDK reads your key from the ANTHROPIC_API_KEY setting (your .env
// file), so the key never appears in the code and never reaches the browser.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompt.js";
import { searchTool, pickSpokenText, collectSources, searchErrors } from "./search.js";
import { askQlooTool, runAskQloo, ASK_QLOO, rememberTasteTool, runRememberTaste, REMEMBER_TASTE, spokenSuggestions, splitPicksMarker, picksByNumber } from "./taste.js";
import { createQloo } from "./qloo.js";
import { geocodePlace } from "./place.js";

// Which Claude model to use. Haiku 5.5 is cheap and quick, which suits a voice app and a
// public demo. Change NION_MODEL in .env to try another one (for example claude-sonnet-5-5).
const DEFAULT_MODEL = "claude-haiku-5-5";

/** The model Nion is using right now (the setting, or Haiku), so the server can price answers. */
export const currentModel = () => process.env.NION_MODEL || DEFAULT_MODEL;

// A reply can take several rounds: a search can pause it, and each tool use is a round
// trip. This caps how many, so one question can't run forever.
const MAX_LEARNED_PER_TURN = 3;
const MAX_ROUNDS = 5;

// What Nion writes, instead of an answer, when a question depends on where the
// person is and it doesn't know. (See the rules in prompt.js.)
const NEED_LOCATION = "[[NEED_LOCATION]]";

/**
 * Makes the brain. `client` is the Claude client and `qloo` is the helper from createQloo;
 * both can be pretend ones in tests, which is how Nion's flow is checked without spending money.
 */
export function createBrain({ client, qloo, geocode = geocodePlace, model: defaultModel = process.env.NION_MODEL || DEFAULT_MODEL }) {
  /**
   * Ask Claude for Nion's reply.
   *   messages: the conversation so far, [{ role: "user" | "assistant", content: "..." }]
   *   context:  details from the person's browser (date, time, time zone, name)
   *   location: optional { city, region, country } to localize searches
   *   coords:   optional { lat, lon }, where the person is, for places near them
   *   coordsFrom: "gps" if coords is their exact position, "named" if it is the middle of a city they named
   *   placeLabel: the name of that city, when coordsFrom is "named"
   * Returns { reply, sources, suggestions, about, learned, searches, usage } where reply is the
   * text Nion should speak, sources are the pages it used ([{ title, url }]), suggestions are
   * the Qloo picks Nion actually said (ready to list on screen), about says what they were based
   * on ({ kind, likes, only }) and learned is any new taste the person stated, for the page to save.
   */
  return async function askNion({ messages, context, location, coords, coordsFrom, placeLabel, model = defaultModel }) {
    let thread = messages;
    let response;
    let searches = 0;
    let qlooCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let suggestions = [];
    let about = null;
    let qlooStats = null; // what Qloo did for the picks that were kept (see runAskQloo)
    const learned = [];
    const sources = new Map();
    const errors = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      response = await client.messages.create({
        model,
        // A generous ceiling, not a target. Nion's answers are short, but the model
        // may also spend some of this budget thinking before it answers.
        max_tokens: 4096,
        // "low" effort keeps replies quick, which matters for a voice conversation.
        output_config: { effort: "low" },
        system: buildSystemPrompt(context),
        tools: [searchTool(context, location), askQlooTool(), rememberTasteTool()],
        messages: thread,
      });

      searches += response.usage?.server_tool_use?.web_search_requests ?? 0;
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      for (const source of collectSources(response.content)) sources.set(source.url, source);
      errors.push(...searchErrors(response.content));

      if (response.stop_reason === "pause_turn") {
        // Paused mid-search: send Claude's unfinished reply back unchanged so it can continue.
        thread = [...thread, { role: "assistant", content: response.content }];
        continue;
      }

      if (response.stop_reason === "tool_use") {
        // Claude wants to ask Qloo. Run each request and hand the answers back.
        const results = [];
        for (const block of response.content.filter((b) => b.type === "tool_use")) {
          if (block.name === REMEMBER_TASTE) {
            const noted = runRememberTaste(block.input);
            if (noted.learned && learned.length < MAX_LEARNED_PER_TURN) learned.push(noted.learned);
            results.push({ type: "tool_result", tool_use_id: block.id, content: noted.text, ...(noted.learned ? {} : { is_error: true }) });
            continue;
          }
          if (block.name !== ASK_QLOO) {
            results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool.", is_error: true });
            continue;
          }
          qlooCalls += 1;
          const outcome = await runAskQloo({
            qloo,
            input: block.input,
            context: {
              coords,
              coordsFrom,
              placeLabel,
              timeZone: context?.timeZone,
              geocode,
              // What the person has said they dislike (already checked by the server), for Qloo to leave out.
              dislikes: (context?.taste ?? []).filter((t) => t.opinion === "dislike").map((t) => ({ name: t.name, kind: t.kind })),
            },
          });
          if (outcome.suggestions.length > 0) {
            suggestions = outcome.suggestions;
            about = outcome.about ?? null;
            qlooStats = outcome.stats ?? null;
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.text, ...(outcome.isError ? { is_error: true } : {}) });
        }
        thread = [...thread, { role: "assistant", content: response.content }, { role: "user", content: results }];
        continue;
      }

      break;
    }

    const usage = { searches, qlooCalls, inputTokens, outputTokens, searchErrors: errors };

    // Claude can decline a request. That is a normal reply with a special reason.
    if (response.stop_reason === "refusal") {
      return { reply: "Sorry, I can't help with that one.", sources: [], suggestions: [], learned, searches, usage };
    }

    // Out of rounds while Claude still wanted to look something up: whatever text it has
    // is only "let me check", not an answer, so don't speak it.
    if (response.stop_reason === "tool_use" || response.stop_reason === "pause_turn") {
      return {
        reply: "Sorry, that one took too long to work out. Could you ask it another way?",
        sources: [],
        suggestions,
        learned,
        searches,
        usage,
      };
    }

    // The spoken words are the text after the last search result, without the unspoken picks note.
    const { text: reply, numbers } = splitPicksMarker(pickSpokenText(response.content));

    // Nion needs to know where the person is, and doesn't. The page will ask them.
    if (reply.includes(NEED_LOCATION)) {
      return { needsLocation: true, reply: "", sources: [], suggestions: [], learned, searches, usage };
    }

    // Which Qloo picks were said: the numbers Claude gave, or, if it gave none that make sense, the
    // names it said.
    const byNumber = numbers ? picksByNumber(numbers, suggestions) : [];
    const spoken = numbers && (byNumber.length > 0 || numbers.length === 0) ? byNumber : spokenSuggestions(reply, suggestions);
    return {
      reply: reply || "Sorry, I didn't catch that. Could you say it again?",
      sources: [...sources.values()].slice(0, 8),
      suggestions: spoken,
      about: spoken.length ? about : null,
      // Who did what, for the line under the picks: which model wrote the answer, what Qloo did, any web searches.
      made: spoken.length ? { model, qloo: qlooStats, searches } : null,
      learned,
      searches,
      usage,
    };
  };
}

// The everyday brain, made the first time it is needed so that importing this file (in
// tests, say) does not need any keys.
let everyday;
export function askNion(args) {
  everyday ??= createBrain({
    client: new Anthropic(),
    qloo: createQloo({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL || undefined }),
  });
  return everyday(args);
}
