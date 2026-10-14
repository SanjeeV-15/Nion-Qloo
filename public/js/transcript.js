// Turns a saved conversation into text: a title for the list, and a plain-text
// transcript to copy. No browser features used, so it is easy to test.

/** A short title: the first thing the person asked. */
export function conversationTitle(conversation) {
  const first = conversation?.turns?.find((t) => t.role === "user")?.text ?? "Conversation";
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
}

/** The whole conversation as plain text, ready to copy and paste somewhere. */
export function formatTranscript(conversation, { locale } = {}) {
  const started = new Date(conversation.startedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const lines = [`Nion conversation, ${started}`, ""];

  for (const turn of conversation.turns) {
    lines.push(`${turn.role === "user" ? "You" : "Nion"}: ${turn.text}`);
    if (turn.sources?.length) {
      lines.push(`Sources: ${turn.sources.map((s) => `${s.title} (${s.url})`).join("; ")}`);
    }
    // A blank line after each answer, so every question and its answer sit together.
    if (turn.role === "assistant") lines.push("");
  }
  return lines.join("\n").trimEnd();
}
