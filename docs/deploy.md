# Putting Nion online (Render)

The hackathon needs a live link that judges can use for free until Nov 16. This is how Nion gets one.
Some steps are yours alone (accounts, payment, typing your keys). Each step says who does it.

## What you need first

- A **public GitHub repository** for the code. You push it; it must show the MIT license in its About box.
- A **Render account** (render.com). The cheapest always-on plan is `0.5c-512mb` (it used to be called
  Starter). Check the price on Render's pricing page before you subscribe. The free plan sleeps after a
  while and takes about a minute to wake, which is a bad first impression for a judge.
- Your two API keys, ready to type into Render. **Never paste them in a chat or into a file in the repo.**

## 1. Before the first push (done)

Qloo asks that its response data is not published in the public repo. The history was cleaned of real place
names (replaced with made-up ones) and of private notes before anything was pushed. `git log -p` shows none.

## 2. Create the repo and push (you, or me with your yes)

1. On github.com create a new **public** repository (no README, no license: they are already here).
2. Add it as the remote and push `main`. SSH keys or browser sign-in only.

## 3. Create the service on Render (you)

1. In Render choose **New, then Blueprint**, and pick the repository. Render reads `render.yaml`.
2. It asks for `ANTHROPIC_API_KEY` and `QLOO_API_KEY`. Type them into those fields.
3. Confirm the plan and create it. The first build takes a few minutes.
4. Open the address Render gives you (it ends in `.onrender.com`). It is https, which phones need for the
   microphone.

## 4. Check it (me, once you give me the address)

- The page loads, typing works, a taste question gets real picks, and the Maps link opens.
- **How many proxies sit in front of the server.** Per-visitor limits need each visitor's real address. On Render
  this was measured with `NION_IP_DEBUG=1` and `/api/whoami`: the connection comes through a local proxy, Render's
  and Cloudflare's, so `TRUST_PROXY_HOPS` is **3** (set in `render.yaml`). A value of 1 makes every visitor look like
  Render's internal address. Turn `NION_IP_DEBUG` off afterwards (delete it in Render's Environment tab).

## 5. Keep your credit safe

- `NION_DAILY_BUDGET_USD` (2) and `NION_TOTAL_BUDGET_USD` (8) stop spending: when one is reached, Nion says it is
  resting. They are estimates held in memory, so a restart resets them. The prepaid balance on the Claude
  account is the real backstop, and you already get an email when it runs out.
- One visitor may ask 6 questions a minute and 40 an hour. Up to 6 questions are answered at once.
- When fewer than 150 of Qloo's 10,000 monthly calls are left, Nion rests rather than fail halfway.
- Change any of these in Render's Environment tab; the names are listed in `.env.example`.

## 6. Before judging starts

- **Switch off the free plan.** `render.yaml` is on the free plan for testing. Change `plan: free` to
  `plan: 0.5c-512mb` (the cheapest always-on plan, formerly Starter), push, and let Render apply it. The free plan
  sleeps after 15 idle minutes and takes about a minute to wake, it can be restarted or suspended at any time, and
  its restarts reset the spending counters. Change the plan in `render.yaml`, not only in the dashboard, or a later
  sync could undo it.

- In `render.yaml` change `autoDeployTrigger` to `off` (or turn off auto-deploy in Render) so a late push
  cannot break a working demo.
- The README links the live demo address. It stays the same when the plan changes, so nothing to update there.
- Keep the service running until Nov 16. You can cancel it after the judging period.
- Test once more in a fresh browser window with no saved taste, as a judge would.
