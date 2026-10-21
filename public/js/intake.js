// The "tell Nion what you love" box.
//
// A new visitor can say a few favourites: artists, films or shows (Qloo suggests real matches as they type), a food,
// and, only if they want, an age range. All of it is optional, and it all stays on this device. When they press
// "Start with my taste" the choices become the taste Nion starts from, so Qloo reacts to *their* taste from the
// first question.
//
// The page's elements are passed in (and so are `make`, `fetchImpl` and the timers), so this can be tested
// without a browser. Every word that comes from Qloo is put on the page as text, never as HTML.

import { addPick, removePick, mixSuggestions, intakeToTaste, AGE_CHOICES, FOOD_CHOICES } from "./taste.js";

const MIN_CHARS = 2; // ask Qloo for suggestions only once there is something to go on
const PAUSE_MS = 300; // ...and only when the person pauses typing, to save Qloo's calls
const MAX_PER_FIELD = 3;

/**
 * el: { artistInput, artistOptions, artistPicked, showInput, showOptions, showPicked, foods, ages, start }
 * onStart({ taste, age }) is called when the person presses "Start with my taste".
 */
export function createIntake({ el, make, fetchImpl, visitorId, onStart, schedule = setTimeout, cancel = clearTimeout }) {
  const state = { artists: [], shows: [], foods: [], age: undefined };

  const fields = {
    artist: { input: el.artistInput, options: el.artistOptions, picked: el.artistPicked, kinds: ["artist"], list: "artists" },
    show: { input: el.showInput, options: el.showOptions, picked: el.showPicked, kinds: ["movie", "tv_show"], list: "shows" },
  };
  const timers = {};
  const turns = {}; // the newest request for each box, so a slow old answer never replaces a newer one

  function button(text, className, onClick, label) {
    const node = make("button");
    node.type = "button";
    node.className = className;
    node.textContent = text;
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", onClick);
    return node;
  }

  function updateStart() {
    el.start.disabled = intakeToTaste(state).length === 0;
  }

  // ----- picks (the chips under each box) -----
  function renderPicked(name) {
    const field = fields[name];
    field.picked.replaceChildren();
    for (const pick of state[field.list]) {
      field.picked.append(
        button(`${pick.name} ×`, "chip", () => {
          state[field.list] = removePick(state[field.list], pick);
          renderPicked(name);
          updateStart();
        }, `Remove ${pick.name}`)
      );
    }
  }

  function choose(name, suggestion) {
    const field = fields[name];
    state[field.list] = addPick(state[field.list], suggestion, MAX_PER_FIELD);
    field.input.value = "";
    field.options.replaceChildren();
    field.options.hidden = true;
    renderPicked(name);
    updateStart();
  }

  // ----- suggestions from Qloo, as the person types -----
  async function suggest(kinds, text) {
    const lists = await Promise.all(
      kinds.map(async (kind) => {
        try {
          const response = await fetchImpl(`/api/suggest?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(text)}`, {
            headers: { "X-Nion-Visitor": visitorId() },
          });
          if (!response.ok) return [];
          const data = await response.json();
          return (Array.isArray(data?.suggestions) ? data.suggestions : []).filter((s) => typeof s?.name === "string" && s.name.trim());
        } catch {
          return []; // typing never shows an error: it just offers nothing
        }
      })
    );
    return mixSuggestions(lists, 5);
  }

  function renderOptions(name, suggestions) {
    const field = fields[name];
    field.options.replaceChildren();
    for (const suggestion of suggestions) {
      const row = make("li");
      const label = suggestion.detail ? `${suggestion.name} · ${suggestion.detail}` : suggestion.name;
      row.append(button(label, "intake-option", () => choose(name, suggestion)));
      field.options.append(row);
    }
    field.options.hidden = suggestions.length === 0;
    field.options.firstSuggestion = suggestions[0];
  }

  for (const name of Object.keys(fields)) {
    const field = fields[name];
    turns[name] = 0;
    field.input.addEventListener("input", () => {
      const text = String(field.input.value ?? "").replace(/\s+/g, " ").trim();
      cancel(timers[name]);
      const mine = ++turns[name];
      if (text.length < MIN_CHARS) {
        renderOptions(name, []);
        return;
      }
      timers[name] = schedule(async () => {
        const found = await suggest(field.kinds, text);
        if (mine === turns[name]) renderOptions(name, found);
      }, PAUSE_MS);
    });
    // Enter takes the first suggestion, so the keyboard works without reaching for a mouse.
    field.input.addEventListener("keydown", (event) => {
      if (event?.key !== "Enter") return;
      event.preventDefault?.();
      const first = field.options.firstSuggestion;
      if (first && !field.options.hidden) choose(name, first);
    });
  }

  // ----- foods (tap any) and age range (tap one, or none) -----
  const foodButtons = FOOD_CHOICES.map((food) => {
    const node = button(food, "chip", () => {
      state.foods = state.foods.includes(food) ? state.foods.filter((f) => f !== food) : [...state.foods, food];
      node.setAttribute("aria-pressed", String(state.foods.includes(food)));
      node.dataset.on = state.foods.includes(food) ? "yes" : "";
      updateStart();
    });
    node.setAttribute("aria-pressed", "false");
    return node;
  });
  el.foods.replaceChildren();
  el.foods.append(...foodButtons);

  const ageOptions = [{ value: undefined, label: "Prefer not to say" }, ...AGE_CHOICES];
  const ageButtons = ageOptions.map((choice) => {
    const node = button(choice.label, "chip", () => {
      state.age = choice.value;
      ageButtons.forEach((other, i) => {
        other.setAttribute("aria-pressed", String(ageOptions[i].value === state.age));
        other.dataset.on = ageOptions[i].value === state.age ? "yes" : "";
      });
    });
    node.setAttribute("aria-pressed", String(choice.value === undefined));
    node.dataset.on = choice.value === undefined ? "yes" : "";
    return node;
  });
  el.ages.replaceChildren();
  el.ages.append(...ageButtons);

  el.start.addEventListener("click", () => {
    const taste = intakeToTaste(state);
    if (taste.length === 0) return;
    onStart({ taste, age: state.age });
  });

  updateStart();

  return {
    /** Clears everything the person picked (used when they forget their taste). */
    reset() {
      state.artists = [];
      state.shows = [];
      state.foods = [];
      state.age = undefined;
      for (const name of Object.keys(fields)) {
        fields[name].input.value = "";
        renderOptions(name, []);
        renderPicked(name);
      }
      foodButtons.forEach((node) => {
        node.setAttribute("aria-pressed", "false");
        node.dataset.on = "";
      });
      ageButtons.forEach((node, i) => {
        node.setAttribute("aria-pressed", String(ageOptions[i].value === undefined));
        node.dataset.on = ageOptions[i].value === undefined ? "yes" : "";
      });
      updateStart();
    },
    state,
  };
}
