import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the deployment config holds no secret, only places for the owner to type them", () => {
  const yaml = read("render.yaml");
  assert.match(yaml, /key: ANTHROPIC_API_KEY\s+sync: false/);
  assert.match(yaml, /key: QLOO_API_KEY\s+sync: false/);
  assert.doesNotMatch(yaml, /sk-ant-/);
});

test("the deployment starts the server without a .env file, which Render does not have", () => {
  const yaml = read("render.yaml");
  assert.match(yaml, /startCommand: node server\/index\.js/);
  assert.doesNotMatch(yaml, /--env-file/);
  assert.match(yaml, /healthCheckPath: \/api\/health/);
});

test("the plan is one we know, and the free test setting is flagged as temporary", () => {
  const yaml = read("render.yaml");
  assert.match(yaml, /^\s+plan: (free|0\.5c-512mb)\s*$/m);
  // While it is on the free plan, the file must say so, and say what to change before judging.
  if (/^\s+plan: free\s*$/m.test(yaml)) {
    assert.match(yaml, /TEMPORARY/);
    assert.match(yaml, /BEFORE JUDGING/);
    assert.match(yaml, /plan: 0\.5c-512mb/);
  }
});

test("the Node version is pinned", () => {
  assert.match(read(".node-version"), /^22\s*$/);
});

test("every setting the server reads is described in .env.example", () => {
  const server = read("server/index.js");
  const example = read(".env.example");
  const used = new Set([...server.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]));
  // These are for tests and for the paths the host sets itself.
  for (const internal of ["PORT", "QLOO_BASE_URL", "NOMINATIM_URL", "NODE_ENV"]) used.delete(internal);
  for (const name of used) assert.match(example, new RegExp(`${name}=`), `${name} is not in .env.example`);
});

test("the real key file is never tracked", () => {
  assert.match(read(".gitignore"), /^\.env$/m);
});

test("the README documents every setting and every check, and holds no key", () => {
  const readme = read("README.md");
  const example = read(".env.example");
  // Every setting in .env.example (set or commented out) is explained in the README.
  const settings = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z_]+)=/gm)].map((m) => m[1]));
  for (const name of settings) assert.ok(readme.includes(name), `${name} is not in the README`);
  // Every script that still belongs to this version is mentioned.
  for (const script of ["npm test", "npm run check:qloo", "npm run check:taste", "npm start"]) {
    assert.ok(readme.includes(script), `${script} is not in the README`);
  }
  assert.doesNotMatch(readme, /sk-ant-[A-Za-z0-9_-]{10,}/);
  assert.match(readme, /MIT/);
});

test("nothing in the repo points at tools that are not in it", () => {
  assert.doesNotMatch(read("package.json"), /cloudflared|\.tools/);
});

test("the proxy depth is the one measured on Render, not the guess", () => {
  assert.match(read("render.yaml"), /key: TRUST_PROXY_HOPS\s+value: "3"/);
  assert.doesNotMatch(read("render.yaml"), /key: NION_IP_DEBUG/, "the diagnostic is switched on in the dashboard, never set in the file");
});

test("the README has no unfinished marker and links the live demo", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /TODO/);
  assert.match(readme, /\*\*Live demo:\*\* https:\/\/[a-z0-9-]+\.onrender\.com/);
});

test("the page offers a few things to try, each a real question the app can answer", () => {
  const html = read("public/index.html");
  const row = html.slice(html.indexOf('id="chips"'), html.indexOf("</div>", html.indexOf('id="chips"')));
  const chips = [...row.matchAll(/class="chip"[^>]*data-say="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(chips.length >= 3 && chips.length <= 5, `expected 3 to 5 suggestions, found ${chips.length}`);
  for (const text of chips) assert.ok(text.length > 3 && text.length <= 100, text);
  // The labels say what they ask, so a visitor is never surprised.
  for (const text of chips) assert.ok(html.includes(`>${text}</button>`), `${text} has a different label`);
  assert.match(html, /role="group" aria-label="Things to try"/);
});

test("the first thing to do sits right under the examples, and the picks have a place for who did what", () => {
  const html = read("public/index.html");
  assert.equal((html.match(/id="demo-taste"/g) ?? []).length, 1, "one demo-taste button");
  assert.ok(html.indexOf('id="chips"') < html.indexOf('id="demo-taste"'), "after the examples");
  assert.ok(html.indexOf('id="demo-taste"') < html.indexOf('id="reply-card"'), "before the answer, so it is seen first");
  assert.match(html, /<section id="start-here"[^>]*>[\s\S]*id="demo-taste"[\s\S]*<\/section>/, "inside the start panel");
  const picks = html.slice(html.indexOf('id="picks"'), html.indexOf("</section>", html.indexOf('id="picks"')));
  assert.match(picks, /id="picks-made-qloo"/);
  assert.match(picks, /id="picks-made-claude"/);
  // Every one of these is looked up by the page script, so none can be renamed in one place only.
  const app = read("public/js/app.js");
  assert.match(html, /id="off"[^>]*hidden/, "Turn off Nion starts hidden, until Nion is on");
  for (const id of ["start-here", "start-steps", "picks-made-qloo", "picks-made-claude", "demo-taste", "off", "intake-music-genres", "intake-screen-genres"]) {
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`), `${id} is used by app.js`);
  }
});

test("the 'where are you?' buttons are hidden until Nion asks, and each one is something Nion accepts as a place", () => {
  const html = read("public/index.html");
  const start = html.indexOf('id="place-chips"');
  assert.ok(start > 0 && /id="place-chips"[^>]*hidden/.test(html), "hidden at the start");
  const row = html.slice(start, html.indexOf("</div>", start));
  const says = [...row.matchAll(/data-say="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(says.includes("use my location"));
  assert.ok(says.length >= 3 && says.length <= 5);
  assert.match(html, /role="group" aria-label="Where are you\?"/);
});

test("the 'hidden' attribute always hides, even on elements that set their own display", () => {
  // Found in a real browser: the place buttons were meant to be hidden until Nion asks where you are, but a
  // row with display: flex stayed visible, and the tests (which only look at the attribute) could not see it.
  const css = read("public/css/styles.css");
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  // And the elements that rely on it are marked hidden in the page.
  const html = read("public/index.html");
  for (const id of ["place-chips", "reply-card", "picks", "stop"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*hidden`), `${id} should start hidden`);
  }
});
