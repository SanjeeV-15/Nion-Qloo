import { test } from "node:test";
import assert from "node:assert/strict";
import { searchTool, pickSpokenText, collectSources, searchErrors } from "../server/search.js";

// A reply shaped the way Anthropic documents it for web search.
const withSearch = [
  { type: "text", text: "I'll check the news." },
  { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "world news" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "srv_1",
    content: [
      { type: "web_search_result", url: "https://reuters.com/a", title: "Reuters story", encrypted_content: "x" },
      { type: "web_search_result", url: "https://bbc.com/b", title: "BBC story", encrypted_content: "y" },
    ],
  },
  { type: "text", text: "According to Reuters, " },
  {
    type: "text",
    text: "talks resumed today.",
    citations: [{ type: "web_search_result_location", url: "https://reuters.com/a", title: "Reuters story", cited_text: "..." }],
  },
];

test("the spoken words are only the text after the last search result", () => {
  assert.equal(pickSpokenText(withSearch), "According to Reuters, talks resumed today.");
});

test("with no search, all the text is spoken", () => {
  assert.equal(pickSpokenText([{ type: "text", text: "It's Canberra." }]), "It's Canberra.");
});

test("the sources are the pages that were cited", () => {
  assert.deepEqual(collectSources(withSearch), [{ title: "Reuters story", url: "https://reuters.com/a" }]);
});

test("if nothing was cited, the sources are the pages that were found", () => {
  const uncited = withSearch.slice(0, 3);
  assert.deepEqual(collectSources(uncited).map((s) => s.url), ["https://reuters.com/a", "https://bbc.com/b"]);
});

test("a failed search is reported and does not break anything", () => {
  const failed = [
    { type: "server_tool_use", id: "srv_2", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "srv_2", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
    { type: "text", text: "I'm having trouble reaching my sources." },
  ];
  assert.deepEqual(searchErrors(failed), ["unavailable"]);
  assert.deepEqual(collectSources(failed), []);
  assert.equal(pickSpokenText(failed), "I'm having trouble reaching my sources.");
});

test("the search tool is limited, and passes the time zone and any place we know", () => {
  const plain = searchTool({});
  assert.equal(plain.name, "web_search");
  assert.ok(plain.max_uses <= 3);
  assert.equal(plain.user_location, undefined);

  const located = searchTool({ timeZone: "America/New_York" }, { city: "Miami", region: "Florida", country: "us" });
  assert.deepEqual(located.user_location, {
    type: "approximate",
    timezone: "America/New_York",
    city: "Miami",
    region: "Florida",
    country: "US",
  });
});

test("a made-up time zone or country code is not sent", () => {
  const tool = searchTool({ timeZone: "Not/AZone" }, { country: "USA" });
  assert.equal(tool.user_location, undefined);
});
