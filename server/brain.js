// The "brain": asks Claude for Nion's answer.
//
// The Claude SDK reads your key from the ANTHROPIC_API_KEY setting (your .env
// file), so the key never appears in the code and never reaches the browser.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompt.js";
import { searchTool, pickSpokenText, collectSources, searchErrors } from "./search.js";

const client = new Anthropic();

// Which Claude model to use. Change NION_MODEL in .env to try another one
// (for example claude-haiku-5-5 if replies feel slow).
const MODEL = process.env.NION_MODEL || "claude-sonnet-5-5";

// A search can pause partway through a reply. We then send the paused reply back
// and Claude carries on. This caps how many times, so a question can't run forever.
const MAX_ROUNDS = 4;

// What Nion writes, instead of an answer, when a question depends on where the
// person is and it doesn't know. (See the rules in prompt.js.)
const NEED_LOCATION = "[[NEED_LOCATION]]";

/**
 * Ask Claude for Nion's reply.
 *   messages: the conversation so far, [{ role: "user" | "assistant", content: "..." }]
 *   context:  details from the person's browser (date, time, time zone, name)
 *   location: optional { city, region, country } to localize searches
 * Returns { reply, sources, searches, usage } where reply is the text Nion should
 * speak and sources are the pages it used, as [{ title, url }].
 */
export async function askNion({ messages, context, location, model = MODEL }) {
  let thread = messages;
  let response;
  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
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
      tools: [searchTool(context, location)],
      messages: thread,
    });

    searches += response.usage?.server_tool_use?.web_search_requests ?? 0;
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    for (const source of collectSources(response.content)) sources.set(source.url, source);
    errors.push(...searchErrors(response.content));

    if (response.stop_reason !== "pause_turn") break;
    // Paused: send Claude's unfinished reply back unchanged so it can continue.
    thread = [...thread, { role: "assistant", content: response.content }];
  }

  const usage = { searches, inputTokens, outputTokens, searchErrors: errors };

  // Claude can decline a request. That is a normal reply with a special reason.
  if (response.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that one.", sources: [], searches, usage };
  }

  // The spoken words are the text after the last search result.
  const reply = pickSpokenText(response.content);

  // Nion needs to know where the person is, and doesn't. The page will ask them.
  if (reply.includes(NEED_LOCATION)) {
    return { needsLocation: true, reply: "", sources: [], searches, usage };
  }

  return {
    reply: reply || "Sorry, I didn't catch that. Could you say it again?",
    sources: [...sources.values()].slice(0, 8),
    searches,
    usage,
  };
}
