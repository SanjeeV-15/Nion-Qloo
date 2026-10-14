// Decides what Nion should do with each thing it hears. No sound, no screen, no
// network here: just a decision. That keeps it easy to test, and app.js carries
// the decision out.
//
// `session` describes where we are:
//   active:   true while a conversation is running ("Hey Nion, let's start a conversation")
//   followUp: true during the short window after Nion answers, when you can ask
//             a follow-up without saying "Hey Nion" again
//   awaiting: null, "name" (Nion just asked for your name), "place" (Nion just asked
//             where you are) or "question" (you said only "Hey Nion" and the next
//             thing you say is the question)
//
// The decision is one of:
//   { type: "ignore" }                     not for Nion
//   { type: "setName", name }              remember this name
//   { type: "nameRetry" }                  that wasn't a name, ask again
//   { type: "setPlace", place }            remember where the person is
//   { type: "useDeviceLocation" }          share the device's location
//   { type: "placeRetry" }                 that wasn't a place, ask again
//   { type: "start" }                      begin a conversation
//   { type: "end" }                        end the conversation
//   { type: "awaitQuestion" }              heard only "Hey Nion"
//   { type: "ask", question, oneShot }     send a question to Claude

import { parseUtterance, detectCommand } from "./wake.js";
import { extractName } from "./name.js";
import { extractPlace, wantsDeviceLocation } from "./location.js";

// Is Nion in a conversation, either a started one or the follow-up window after an answer?
function isOpen(session) {
  return Boolean(session.active || session.followUp);
}

// What to do with words that came after the wake phrase (or, in a
// conversation, with anything said at all).
function decideAfterWake(question, session) {
  const command = detectCommand(question);
  if (command === "start") return session.active ? { type: "ignore" } : { type: "start" };
  if (command === "end") return isOpen(session) ? { type: "end" } : { type: "ignore" };

  const name = extractName(question);
  if (name) return { type: "setName", name };

  if (!question) return { type: "awaitQuestion" };
  return { type: "ask", question, oneShot: !isOpen(session) };
}

export function decide(session, text) {
  const heard = String(text ?? "").trim();
  if (!heard) return { type: "ignore" };

  // Nion just asked for your name: the next thing you say is the name.
  if (session.awaiting === "name") {
    const name = extractName(heard, { asked: true });
    return name ? { type: "setName", name } : { type: "nameRetry" };
  }

  // Nion just asked where you are: say a place, or say to use your device's location.
  if (session.awaiting === "place") {
    if (detectCommand(heard) === "end") return { type: "end" };
    if (wantsDeviceLocation(heard)) return { type: "useDeviceLocation" };
    const place = extractPlace(heard, { asked: true });
    return place ? { type: "setPlace", place } : { type: "placeRetry" };
  }

  // In a conversation, or in the follow-up window after an answer, you don't
  // need the wake phrase. "Hey Nion" is still allowed at the start.
  if (isOpen(session)) {
    const parsed = parseUtterance(heard);
    return decideAfterWake(parsed.woke ? parsed.question : heard, session);
  }

  // After a lone "Hey Nion", whatever comes next is the question.
  if (session.awaiting === "question") return decideAfterWake(heard, session);

  // Otherwise Nion only listens for the wake phrase.
  const parsed = parseUtterance(heard);
  if (!parsed.woke) return { type: "ignore" };
  return decideAfterWake(parsed.question, session);
}
