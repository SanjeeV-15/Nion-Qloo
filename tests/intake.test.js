// Tests the "tell Nion what you love" box (public/js/intake.js) with pretend page elements, a pretend Qloo
// suggestion service and a timer the test controls, so typing and pauses can be played back exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createIntake } from "../public/js/intake.js";

function element() {
  return {
    children: [],
    handlers: {},
    attrs: {},
    dataset: {},
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    className: "",
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    click() {
      return this.handlers.click?.();
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
  };
}

// Builds the box. `answers` maps "kind|text" to the suggestions the pretend service gives.
function setup({ answers = {}, fail = false } = {}) {
  const el = {
    artistInput: element(), artistOptions: element(), artistPicked: element(),
    showInput: element(), showOptions: element(), showPicked: element(),
    foods: element(), ages: element(), start: element(),
  };
  const requests = [];
  const timers = [];
  const started = [];
  const intake = createIntake({
    el,
    make: () => element(),
    fetchImpl: async (url, options) => {
      const u = new URL(url, "https://nion.test");
      requests.push({ kind: u.searchParams.get("kind"), q: u.searchParams.get("q"), headers: options?.headers });
      if (fail === "throw") throw new TypeError("fetch failed");
      if (fail === "status") return { ok: false, json: async () => ({}) };
      const key = `${u.searchParams.get("kind")}|${u.searchParams.get("q")}`;
      return { ok: true, json: async () => ({ suggestions: answers[key] ?? [] }) };
    },
    visitorId: () => "visitor-1",
    onStart: (choice) => started.push(choice),
    schedule: (fn) => {
      timers.push({ fn, cancelled: false });
      return timers.length - 1;
    },
    cancel: (id) => {
      if (timers[id]) timers[id].cancelled = true;
    },
  });
  // Types into a box and lets the pause pass, so the suggestions are asked for and shown.
  const type = async (box, text) => {
    const input = box === "artist" ? el.artistInput : el.showInput;
    input.value = text;
    input.handlers.input();
    const live = timers.filter((t) => !t.cancelled);
    if (live.length) {
      const last = live.at(-1);
      last.cancelled = true;
      await last.fn();
    }
  };
  const options = (box) => (box === "artist" ? el.artistOptions : el.showOptions);
  const labels = (node) => node.children.map((row) => row.children[0].textContent);
  const picked = (box) => (box === "artist" ? el.artistPicked : el.showPicked).children.map((chip) => chip.textContent);
  return { el, intake, requests, timers, started, type, options, labels, picked };
}

const radiohead = { name: "Radiohead", kind: "artist" };
const bladeRunner = { name: "Blade Runner 2049", kind: "movie", detail: "2017" };

test("nothing is asked for until there are two letters, and the options stay hidden", async () => {
  const t = setup({ answers: { "artist|Radiohead": [radiohead] } });
  await t.type("artist", "R");
  assert.equal(t.requests.length, 0);
  assert.equal(t.options("artist").hidden, true);
});

test("after a pause in typing, Qloo's suggestions are asked for once, with the visitor's id, and shown", async () => {
  const t = setup({ answers: { "artist|Radioh": [radiohead, { name: "Radio Havanna", kind: "artist" }] } });
  await t.type("artist", "Radioh");
  assert.equal(t.requests.length, 1);
  assert.deepEqual(t.requests[0], { kind: "artist", q: "Radioh", headers: { "X-Nion-Visitor": "visitor-1" } });
  assert.deepEqual(t.labels(t.options("artist")), ["Radiohead", "Radio Havanna"]);
  assert.equal(t.options("artist").hidden, false);
});

test("typing quickly asks only once: the earlier pause is cancelled", async () => {
  const t = setup({ answers: { "artist|Radio": [radiohead] } });
  t.el.artistInput.value = "Ra";
  t.el.artistInput.handlers.input();
  t.el.artistInput.value = "Radio";
  t.el.artistInput.handlers.input();
  assert.equal(t.timers.filter((x) => !x.cancelled).length, 1, "only the latest pause is waiting");
});

test("a suggestion with detail shows it, and tapping one adds a chip, clears the box, and enables Start", async () => {
  const t = setup({ answers: { "movie|Blade Ru": [bladeRunner], "tv_show|Blade Ru": [] } });
  assert.equal(t.el.start.disabled, true, "nothing picked yet");
  await t.type("show", "Blade Ru");
  assert.deepEqual(t.labels(t.options("show")), ["Blade Runner 2049 · 2017"]);
  t.options("show").children[0].children[0].click();
  assert.deepEqual(t.picked("show"), ["Blade Runner 2049 ×"]);
  assert.equal(t.el.showInput.value, "");
  assert.equal(t.options("show").hidden, true);
  assert.equal(t.el.start.disabled, false);
});

test("a chip can be taken off again, and Start goes back to disabled", async () => {
  const t = setup({ answers: { "artist|Radioh": [radiohead] } });
  await t.type("artist", "Radioh");
  t.options("artist").children[0].children[0].click();
  t.el.artistPicked.children[0].click();
  assert.deepEqual(t.picked("artist"), []);
  assert.equal(t.el.start.disabled, true);
});

test("only three can be picked in one box", async () => {
  const names = ["A One", "B Two", "C Three", "D Four"];
  const answers = Object.fromEntries(names.map((n) => [`artist|${n}`, [{ name: n, kind: "artist" }]]));
  const t = setup({ answers });
  for (const n of names) {
    await t.type("artist", n);
    t.options("artist").children[0].children[0].click();
  }
  assert.deepEqual(t.picked("artist"), ["A One ×", "B Two ×", "C Three ×"]);
});

test("films and shows are both asked for, and take turns in the list", async () => {
  const t = setup({
    answers: {
      "movie|Black": [{ name: "Black Swan", kind: "movie", detail: "2010" }, { name: "Black Hawk Down", kind: "movie" }],
      "tv_show|Black": [{ name: "Black Mirror", kind: "tv_show" }],
    },
  });
  await t.type("show", "Black");
  assert.deepEqual(t.requests.map((r) => r.kind).sort(), ["movie", "tv_show"]);
  assert.deepEqual(t.labels(t.options("show")), ["Black Swan · 2010", "Black Mirror", "Black Hawk Down"]);
});

test("a show is kept as a show and a film as a film", async () => {
  const t = setup({
    answers: { "movie|Black": [{ name: "Black Swan", kind: "movie" }], "tv_show|Black": [{ name: "Black Mirror", kind: "tv_show" }] },
  });
  await t.type("show", "Black");
  t.options("show").children[0].children[0].click();
  await t.type("show", "Black");
  t.options("show").children[1].children[0].click();
  t.el.foods.children[0].click(); // ramen
  t.el.start.click();
  assert.deepEqual(t.started[0].taste.map((x) => [x.name, x.kind]), [["Black Swan", "movie"], ["Black Mirror", "tv_show"], ["ramen", "food"]]);
});

test("a slow old answer never replaces a newer one", async () => {
  const pending = [];
  const el = {
    artistInput: element(), artistOptions: element(), artistPicked: element(),
    showInput: element(), showOptions: element(), showPicked: element(),
    foods: element(), ages: element(), start: element(),
  };
  const timers = [];
  createIntake({
    el,
    make: () => element(),
    fetchImpl: (url) =>
      new Promise((resolve) => pending.push({ q: new URL(url, "https://nion.test").searchParams.get("q"), resolve })),
    visitorId: () => "v",
    onStart() {},
    schedule: (fn) => (timers.push(fn), timers.length - 1),
    cancel() {},
  });
  el.artistInput.value = "Rad";
  el.artistInput.handlers.input();
  const first = timers.at(-1)();
  el.artistInput.value = "Radio";
  el.artistInput.handlers.input();
  const second = timers.at(-1)();
  // The newer one answers first, then the older one arrives late.
  pending[1].resolve({ ok: true, json: async () => ({ suggestions: [{ name: "Newer", kind: "artist" }] }) });
  await second;
  pending[0].resolve({ ok: true, json: async () => ({ suggestions: [{ name: "Older", kind: "artist" }] }) });
  await first;
  assert.deepEqual(el.artistOptions.children.map((row) => row.children[0].textContent), ["Newer"]);
});

test("if Qloo cannot be reached, typing offers nothing and shows no error", async () => {
  for (const fail of ["throw", "status"]) {
    const t = setup({ fail });
    await t.type("artist", "Radioh");
    assert.equal(t.options("artist").hidden, true);
    assert.deepEqual(t.labels(t.options("artist")), []);
  }
});

test("Enter takes the first suggestion", async () => {
  const t = setup({ answers: { "artist|Radioh": [radiohead, { name: "Radio Havanna", kind: "artist" }] } });
  await t.type("artist", "Radioh");
  let prevented = false;
  t.el.artistInput.handlers.keydown({ key: "Enter", preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.deepEqual(t.picked("artist"), ["Radiohead ×"]);
  t.el.artistInput.handlers.keydown({ key: "a", preventDefault() {} }); // any other key does nothing
  assert.deepEqual(t.picked("artist"), ["Radiohead ×"]);
});

test("foods can be switched on and off, and the age range is one choice or none", () => {
  const t = setup();
  const foods = t.el.foods.children;
  foods[0].click();
  foods[1].click();
  foods[0].click();
  assert.equal(foods[0].dataset.on, "");
  assert.equal(foods[1].dataset.on, "yes");
  assert.equal(foods[1].attrs["aria-pressed"], "true");

  const ages = t.el.ages.children;
  assert.deepEqual(ages.map((b) => b.textContent), ["Prefer not to say", "35 or younger", "36 to 55", "55 or older"]);
  assert.equal(ages[0].dataset.on, "yes", "no age is the starting choice");
  ages[2].click();
  assert.equal(ages[2].dataset.on, "yes");
  assert.equal(ages[0].dataset.on, "");
  ages[3].click();
  assert.equal(ages[2].dataset.on, "", "only one at a time");
  ages[0].click();
  t.el.start.click();
  assert.equal(t.started[0].age, undefined, "'prefer not to say' gives no age");
});

test("Start hands over the picks and the age, and does nothing when nothing was picked", async () => {
  const t = setup({ answers: { "artist|Radioh": [radiohead] } });
  t.el.start.click();
  assert.equal(t.started.length, 0, "nothing picked: nothing starts, even if the button is clicked");
  t.el.ages.children[2].click(); // an age alone is not a taste
  t.el.start.click();
  assert.equal(t.started.length, 0, "an age on its own is not enough");

  await t.type("artist", "Radioh");
  t.options("artist").children[0].children[0].click();
  t.el.foods.children[0].click();
  t.el.start.click();
  assert.deepEqual(t.started, [
    { taste: [{ name: "Radiohead", kind: "artist", opinion: "like" }, { name: "ramen", kind: "food", opinion: "like" }], age: "36_to_55" },
  ]);
});

test("reset clears the picks, the foods and the age", async () => {
  const t = setup({ answers: { "artist|Radioh": [radiohead] } });
  await t.type("artist", "Radioh");
  t.options("artist").children[0].children[0].click();
  t.el.foods.children[2].click();
  t.el.ages.children[3].click();
  t.intake.reset();
  assert.deepEqual(t.picked("artist"), []);
  assert.equal(t.el.foods.children[2].dataset.on, "");
  assert.equal(t.el.ages.children[0].dataset.on, "yes");
  assert.equal(t.el.ages.children[3].dataset.on, "");
  assert.equal(t.el.start.disabled, true);
  assert.equal(t.el.artistInput.value, "");
});

test("words from Qloo are put on the page as text, never as markup", async () => {
  const t = setup({ answers: { "artist|Evil": [{ name: '<img src=x onerror="alert(1)">', kind: "artist" }] } });
  await t.type("artist", "Evil");
  const button = t.options("artist").children[0].children[0];
  assert.equal(button.textContent, '<img src=x onerror="alert(1)">');
  assert.equal("innerHTML" in button, false, "it never touches innerHTML");
});
