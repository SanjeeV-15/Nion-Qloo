// The History screen. Two views on one page:
//   history.html          the list of past conversations, newest first
//   history.html#<id>     one conversation as a transcript, with a Copy button
//
// Everything is read from this device's own browser storage. Text from
// conversations is always put on the page as plain text, never as HTML.

import { listConversations, getConversation } from "./storage.js";
import { conversationTitle, formatTranscript } from "./transcript.js";

const listEl = document.getElementById("list");
const transcriptEl = document.getElementById("transcript");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const when = (timestamp) =>
  new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Only ordinary web links are made clickable.
function safeLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function showList() {
  transcriptEl.hidden = true;
  listEl.hidden = false;
  listEl.replaceChildren();

  const conversations = listConversations();
  if (conversations.length === 0) {
    listEl.append(el("p", "empty", "No conversations yet. Ask Nion something and it will appear here."));
    return;
  }

  for (const conversation of conversations) {
    const questions = conversation.turns.filter((t) => t.role === "user").length;
    const item = el("a", "convo");
    item.href = `#${encodeURIComponent(conversation.id)}`;
    item.append(
      el("span", "convo-title", conversationTitle(conversation)),
      el("span", "convo-meta", `${when(conversation.updatedAt ?? conversation.startedAt)} · ${questions} ${questions === 1 ? "question" : "questions"}`)
    );
    listEl.append(item);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some browsers only allow copying through a hidden text box.
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.append(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

function showTranscript(id) {
  listEl.hidden = true;
  transcriptEl.hidden = false;
  transcriptEl.replaceChildren();

  const conversation = getConversation(id);
  if (!conversation) {
    transcriptEl.append(
      el("p", "empty", "That conversation could not be found."),
      Object.assign(el("a", "back", "← All conversations"), { href: "#" })
    );
    return;
  }

  const back = Object.assign(el("a", "back", "← All conversations"), { href: "#" });
  const heading = el("h2", "transcript-title", conversationTitle(conversation));
  const meta = el("p", "convo-meta", when(conversation.startedAt));

  const copy = el("button", "pill", "Copy transcript");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    const ok = await copyText(formatTranscript(conversation));
    copy.textContent = ok ? "Copied" : "Couldn't copy";
    setTimeout(() => (copy.textContent = "Copy transcript"), 2000);
  });

  transcriptEl.append(back, heading, meta);

  for (const turn of conversation.turns) {
    const block = el("div", `turn turn-${turn.role}`);
    block.append(el("span", "who", turn.role === "user" ? "You" : "Nion"), el("p", "said", turn.text));

    if (turn.sources?.length) {
      const sources = el("p", "sources", "Sources: ");
      turn.sources.forEach((source, index) => {
        const href = safeLink(source.url);
        if (index > 0) sources.append("; ");
        if (href) {
          const link = el("a", "", source.title || source.url);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          sources.append(link);
        } else {
          sources.append(source.title || "source");
        }
      });
      block.append(sources);
    }
    transcriptEl.append(block);
  }

  transcriptEl.append(copy);
}

function render() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) showTranscript(id);
  else showList();
}

window.addEventListener("hashchange", render);
render();
