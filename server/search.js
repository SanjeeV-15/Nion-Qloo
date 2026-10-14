// Helpers for Claude's web search. They hold no secrets and make no requests, so
// they are easy to test with made-up replies in the shape Anthropic documents:
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
//
// A reply from Claude is a list of "blocks". With web search it can look like:
//   text            "I'll check that."                      (before searching)
//   server_tool_use the search Claude ran
//   web_search_tool_result  the results (or an error)
//   text            the answer, with `citations` naming sources

const MAX_SEARCHES = 3; // per question: keeps replies quick and the cost low

/**
 * The web search tool, ready to send to Claude. If we know the person's time zone
 * we pass it, so results (and things like opening hours) fit where they are.
 * `location` may also carry a city, region and country code once we know them.
 */
export function searchTool(context = {}, location = {}) {
  const userLocation = { type: "approximate" };
  if (isIanaTimeZone(context.timeZone)) userLocation.timezone = context.timeZone;
  if (location.city) userLocation.city = location.city;
  if (location.region) userLocation.region = location.region;
  if (/^[A-Za-z]{2}$/.test(location.country ?? "")) userLocation.country = location.country.toUpperCase();

  const tool = {
    // The basic version: Claude searches directly. (The newer versions filter
    // results by running code first, which adds a step and slows replies down,
    // and a voice conversation can't wait.)
    type: "web_search_20250305",
    name: "web_search",
    max_uses: MAX_SEARCHES,
  };
  if (Object.keys(userLocation).length > 1) tool.user_location = userLocation;
  return tool;
}

function isIanaTimeZone(value) {
  if (typeof value !== "string" || value.length > 60) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The words Nion should speak: the text that comes after the last search result.
 * (Before searching, Claude may write "Let me check that", which isn't the answer.)
 * If there was no search, it is all the text.
 */
export function pickSpokenText(content = []) {
  const types = content.map((block) => block.type);
  const lastResult = types.lastIndexOf("web_search_tool_result");
  const text = content
    .slice(lastResult + 1)
    .filter((block) => block.type === "text")
    // Citation blocks arrive in pieces that already carry their own spacing.
    .map((block) => block.text)
    .join("");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The sources behind an answer: the pages Claude cited, as [{ title, url }].
 * If it cited nothing, the first few pages it found instead.
 */
export function collectSources(content = []) {
  const cited = new Map();
  const found = new Map();

  for (const block of content) {
    if (block.type === "text") {
      for (const citation of block.citations ?? []) {
        if (citation.type === "web_search_result_location" && citation.url) {
          cited.set(citation.url, citation.title ?? citation.url);
        }
      }
    }
    // A failed search has an error object here instead of a list of results.
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === "web_search_result" && result.url) {
          found.set(result.url, result.title ?? result.url);
        }
      }
    }
  }

  const chosen = cited.size > 0 ? cited : new Map([...found].slice(0, 5));
  return [...chosen].map(([url, title]) => ({ title, url }));
}

/** Error codes from any searches that failed (these still arrive as a normal reply). */
export function searchErrors(content = []) {
  return content
    .filter((block) => block.type === "web_search_tool_result" && !Array.isArray(block.content))
    .map((block) => block.content?.error_code ?? "unknown");
}
