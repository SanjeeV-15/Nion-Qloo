# Nion

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Nion is a voice-and-typing web app. It
uses [Qloo](https://www.qloo.com/)'s taste data, through an agent built on Claude's tool use, to pick places,
music, films, TV, books, podcasts, brands and travel destinations that fit what a person has told it they like.

**Live demo:** https://nion-fv7m.onrender.com (open it in Chrome to talk to Nion, or type in any browser; press
**Use a demo taste** to see personal picks without telling Nion anything first).

## What you need

- **Node.js 22 or newer.**
- **Google Chrome** for talking to Nion (it uses Chrome's built-in speech recognition and voice). Typing works in
  any modern browser.
- **A Claude API key** from the Anthropic Console (https://platform.claude.com). It is billed separately from a
  Claude chat plan, as prepaid credit. In our own tests an answer cost about a fifth of a cent on Claude Haiku 5.5
  (an estimate, so check Anthropic's pricing).
- **A Qloo hackathon API key**, from the form in
  [Qloo's developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide). It works only with
  `https://hackathon.api.qloo.com`, allows 5 calls a second and 10,000 a month, and Qloo turns hackathon keys off
  when the hackathon closes.

## Run it

```
npm install
cp .env.example .env     # then put your two keys in .env
npm start
```

Open http://localhost:3000 in Chrome. If that port is taken, `PORT=3010 npm start` and open
http://localhost:3010 instead.

- **To talk:** tap **Turn on Nion**, allow the microphone, and say "Hey Nion" followed by a question.
- **To type:** use the box under the circle. It works without a microphone and in any browser.
- **No time to talk about your taste first?** Press **Use a demo taste** (ramen, Radiohead, Blade Runner 2049, jazz).

The `.env` file is private: git ignores it and it must never be committed or shared.

## Using it

| Say or type | What happens |
|---|---|
| "Hey Nion, I'm hungry" | With no taste known, Nion asks one short question ("What kind of food do you love?"). With a known taste, it goes straight to picks and says what it based them on |
| "Music like Radiohead" | Artists that fit, from Qloo |
| "I loved Blade Runner 2049. What should I watch next?" | Films from Qloo |
| "I love Radiohead. Where would I love to travel?" | Destinations from Qloo |
| "What would I like in Lisbon?" | Places near Lisbon, even if you are somewhere else |
| "Somewhere open right now" | Places that are open now come first, each with when it closes or opens, by the local time at the place |
| "I'm in Miami" (when Nion asks where you are) | Places around the middle of Miami |
| "What's the latest world news?" | One web search, with the source named |
| "Hey Nion, let's start a conversation" | Keeps listening until you say "end the conversation" |

Replies are short and written to be heard. What Nion suggested also appears as a list under its answer, with a link
that opens a map search. When you have given Nion two or more things you like, each pick also shows Qloo's own
breakdown of how much each one drove it. Things you have said you dislike are sent to Qloo to leave out, and the list
says what was left out. Four suggestions under the typing box can be tapped to try Nion, and when Nion needs to know where you are, so can "Use my location" and three sample cities. **Stop** (or Escape, or
tapping the circle) cuts Nion off. A started conversation or a quick follow-up (within 15 seconds of an answer) needs
no wake phrase.

## How it works

```
Browser page  --- what you say or type, your taste list, your place --->  Node server (Express)
   hearing and speaking: Chrome                                              keeps the API keys
   typing box, answer, list of picks                                         guards cost and abuse
                                                                                   |
                                                                                   v
                                                         Claude (Haiku 5.5, a tool-use loop) with three tools:
                                                           ask_qloo       -> server/qloo.js -> Qloo API
                                                           remember_taste -> notes a like or dislike you said
                                                           web search     -> news and facts that change
```

- Claude turns what you say into a request for Qloo (names are looked up to get Qloo's IDs, then recommendations are
  asked for near a point on the map, with your likes as signals, your dislikes excluded, and Qloo's explanation of each
  pick when two or more likes are blended), and turns the results into a short spoken answer.
- A place you say or type is found on the map with OpenStreetMap, so Qloo can look near it.
- Whether a place is open is worked out from the opening hours Qloo returns, using the local time at the place
  (found from its coordinates with [tz-lookup](https://github.com/photostructure/tz-lookup), public domain).
- When there is no cuisine filter, ratings count in how places are ranked (Qloo's `bias.quality`); a place Qloo lists
  twice is shown once. A few of the demo's likely lookups are made at startup so the first question is quicker.
- Nion only says it knows your taste if you told it. The list is kept in your browser, sent with each question,
  and checked by the server before it reaches Claude.

```
server/    index.js (the server and its limits), brain.js (the Claude loop), qloo.js (the one place that talks to
           Qloo), taste.js (the tools, and which picks were said), place.js (maps), prompt.js (Nion's instructions),
           limits.js (spending and visitor limits), search.js, failure.js
public/    the page: app.js (the controller), conversation.js, wake.js, echo.js, speech-in.js, speech-out.js,
           taste.js, picks.js, storage.js, location.js, history.html
tests/     over 300 automated tests, including a pretend microphone, voice, Claude, Qloo and map
scripts/   checks against the real services (below)
docs/      plan.md and deploy.md
```

## Settings

Everything is optional except the two keys. The names and defaults are in `.env.example`.

| Setting | What it does | Default |
|---|---|---|
| `ANTHROPIC_API_KEY`, `QLOO_API_KEY` | Your keys | required |
| `NION_MODEL` | Which Claude model answers | `claude-haiku-5-5` |
| `NION_DAILY_BUDGET_USD`, `NION_TOTAL_BUDGET_USD` | Estimated spending limits; Nion "rests" when reached | 2 and 8 |
| `NION_VISITOR_PER_MINUTE`, `NION_VISITOR_PER_HOUR`, `NION_IP_PER_HOUR` | How often one visitor may ask | 6, 40, 300 |
| `NION_MAX_IN_FLIGHT` | Questions answered at once | 6 |
| `NION_QLOO_RESERVE` | Rest when this few of Qloo's monthly calls are left | 150 |
| `TRUST_PROXY_HOPS`, `NION_IP_DEBUG` | Reading a visitor's address behind a host's proxy | 0, off |
| `NION_WARMUP` | Look up the demo's likely items at startup so the first question is quicker (0 turns it off) | on |

## Tests and checks

```
npm test                    # over 300 tests; no keys needed; nothing is spent
npm run check:qloo          # real Qloo and OpenStreetMap, no Claude: uses a few of Qloo's monthly calls
npm run check:taste         # real Claude and Qloo: SPENDS Anthropic credit (about 3 cents for everything)
npm run check:taste -- memory   # one group: basics, memory or location
```

`check:replies` and `check:speed` are older checks from before Qloo was added and are not part of this version's
checks. Nothing here prints your keys.

## Privacy

- **Your voice** is turned into text by Chrome's speech service, so the audio leaves your computer.
- **What you say or type, your taste list and your name** go from your browser to this server, then to Claude
  (Anthropic) and, as names and tags, to Qloo. The server logs counts and estimated cost, never what was said.
- **A place you name, or your GPS position,** goes to OpenStreetMap's free lookup to find the place. A GPS position
  is kept only in the page's memory until it closes.
- **Your name, taste list and History** are kept only in your browser's storage on your device. Nion has no accounts
  and no database. The page also keeps a random id in your browser so a busy server can slow one visitor down
  without affecting others.
- Qloo's responses are not stored and not included in this repository.

## Known limits

- Voice needs Chrome and an open page with the screen on. Typing works elsewhere.
- On laptop speakers the microphone also hears Nion, so interrupting by voice is less reliable. Earphones fix it, and
  the Stop button always works.
- Qloo's coverage varies by place and category, and its tags can be loose (a sushi place can appear for ramen).
- When a limit is reached (see Settings) Nion says it is resting instead of answering.

## Putting it online

See [docs/deploy.md](docs/deploy.md). A `render.yaml` is included.

## License and credits

MIT, see [LICENSE](LICENSE). Depends on Express, the Anthropic SDK and tz-lookup (CC0). Taste data from [Qloo](https://www.qloo.com/). Answers from Claude by
[Anthropic](https://www.anthropic.com/). Place lookups use data from OpenStreetMap, © OpenStreetMap contributors,
available under the [ODbL](https://www.openstreetmap.org/copyright).
