# Nion for the Qloo Agentic Hackathon: Plan

Status: draft for Sanjeev's approval. Nothing below is built yet.
Deadline: Oct 30, 2026, 11:45 pm Eastern. Target: submit Oct 28. Plan written Oct 14.

## What we are building

Nion is a hands-free voice companion for travelers. New in this version: Nion knows your taste
and picks things *for you*, using Qloo's taste graph, instead of reading the same nearby list
to everyone. Claude is the brain that talks; Qloo is the tool that knows what people love.

## What a judge experiences

1. Opens the live link. Says (or types) "Hey Nion, I'm hungry."
2. Nion asks **one** short question if it knows nothing yet ("What's a food you love?"), then
   answers right away. If it already knows ("you like ramen"), it asks first: "Want ramen places near you?"
3. On a yes, Nion speaks the top few picks with a short reason ("close, and it matches your taste").
   The screen quietly lists the same picks under the circle: name, distance, why.
4. Same idea for music and film (taste carries across: a music taste can pick films), and for
   travel ("what would I like in Lisbon?").
5. Judges who do not want to talk can type, and can load a clearly labeled demo profile.

## Scope

**Polished (in the demo):** food near you; music and film; travel destinations.
**Supported by the same tool, tuned only if time allows:** fashion brands, podcasts, books, TV.
**Not doing:** reminders, email, to-do lists, accounts, a database, a native phone app.
**Decided:** keep the name Nion. Reuse the copied voice engine. Voice first, with a quiet list on screen.

## How taste is learned

- Named thing ("music like Radiohead") -> used directly as the taste signal. No questions.
- Vague ask ("I'm hungry") -> use the taste we have, or ask one short question for that area.
- Yes/no on suggestions -> remembered and used next time.
- Never more than one taste question before giving a result.
- Nion only says "I know you like X" when it really learned X. The profile lives in the browser
  (like the saved name), and is sent with each request. The server stores nothing.

## How it works

```
Browser page (voice in/out, typed box, suggestions list, taste profile)
   -> POST /api/chat (conversation, name, taste profile, place)
Server
   -> Claude (default Haiku 5.5, one setting to swap) with a tool: ask_qloo
        ask_qloo -> server/qloo.js
            1. /search: turn named things into Qloo IDs
            2. /v2/insights: places, destinations, films, music... filtered by place and taste
   <- spoken reply + structured suggestions for the screen
```

- All Qloo access is in one file (`server/qloo.js`), so if its behavior differs from the docs,
  we fix one place.
- Tested so far (read-only probe, Oct 14): places near a point with distance, address, hours and a
  taste-match score; cuisine tags (ramen worked); cross-taste picks for films, TV, music, brands,
  books, podcasts and destinations. Video games failed on the type name.
- Known issues to solve: a spoken city name (`filter.geocode.name`) returned nothing, so we
  convert a spoken city to coordinates ourselves (free OpenStreetMap lookup, like Nion's
  existing location code); the plain "restaurant" tag returned bars and venues, so we filter by cuisine
  and category tags; Qloo has no ready "why" sentence, so Nion builds it from overlapping tags.
- Qloo rules: keys work only with hackathon.api.qloo.com; no Qloo response data in the public repo.
  We cache privately only if needed.
- **Qloo limits (found in slice 1, from Qloo's own response headers):** 5 calls a second and
  10,000 calls a month on the key. A taste question needs about 2 to 3 calls, so the month covers
  roughly 3,000 to 5,000 questions. The adapter spaces calls out, retries once on "too many
  requests", and remembers name lookups. Slice 7 adds a monthly guard: when the allowance runs low,
  Nion says the demo is resting instead of failing. Higher limits can be asked for in Qloo's Discord.

## Build order (each slice: tests, commit, your check; no pushes without your yes)

| # | Slice | Target | You can check |
|---|---|---|---|
| 1 | Qloo adapter with a pretend Qloo for free tests | Oct 15 | `npm test` passes; one real call returns places |
| 2 | Claude uses the Qloo tool; replies built for the ear; web search off for taste questions | Oct 16 | Ask "where should I eat", hear picks with reasons |
| 3 | Taste profile, one-question flow, yes/no learning, demo profile | Oct 17-18 | The first-minute experience above |
| 4 | Screen: typed input and the suggestions list | Oct 19-20 | Works with no microphone |
| 5 | Location: GPS and spoken city for food and travel | Oct 21 | "I'm in Lisbon" returns Lisbon picks |
| 6 | Find and fix the "talks over me" bug | Oct 22 | No overlap in a 10-minute session |
| 7 | Host it: https address, per-visitor limits, friendly "demo is resting" message | Oct 23-24 | A phone and a laptop, both on the live link |
| 8 | Judge test-drive, README, cleanup | Oct 25-27 | Fresh browser, no setup, works first time |
| - | Submit | Oct 28 | You write the Devpost copy; I only check facts and spelling |

Buffer: Oct 29-30. If we slip, slices 6 and the lighter categories go first, never slices 1-4 or 7.

## Money ($20 total, set by you)

- Hosting: Render Starter, about $7 a month, so the demo is always awake. The free tier sleeps
  after 15 idle minutes and takes about a minute to wake, which would be a poor first impression.
- API: about $10 to $13 left. On Haiku a question costs a fraction of a cent (estimate, not
  measured), so this covers thousands of questions.
- Safety: prepaid credit that runs out is a natural hard stop, you already get the email, plus a
  per-visitor question limit in the app.
- I will not run any paid script (reply checks, speed checks) without telling you first.

## Decisions for you

1. **Hosting:** Render Starter for the demo month. (My recommendation. Fly and Railway are cheaper
   but usage-based, so harder to predict.)
2. **Web search:** keep it available for non-taste questions, capped at one search per answer, or
   remove it completely to save money? (Recommend: keep, capped.)
3. **Brain model:** start on Haiku 5.5; move up to Sonnet 5.5 only if answers sound weak.
   Nemotron on Nebius stays an option behind the same setting, tested only if there is time.

## Risks

- Hosting on a public link is the main risk: judges use your credit. Limits and the cap cover it.
- Chrome only for voice. The typed box and the list make the demo work for everyone else.
- Nion occasionally mishears "Hey Nion". The existing backup button and typed box remain.
- Qloo may behave differently from the docs. The single adapter file contains that risk.
- The "New and Existing" rule has a garbled sentence. Consider asking Devpost support to confirm that
  a project started Oct 11 inside the period counts as new.

## Working rules

- Everything lives in `nion-qloo`. `voice-companion` and `nion-nebius` are never touched.
- Keys only in `.env`, never in chat or commits. Secret scan before every commit.
- No pushing, publishing or submitting without your explicit yes.
- Submission text, video narration and survey answers are yours.
- No device-code login. Hosting and GitHub sign-in use the browser or SSH keys.
