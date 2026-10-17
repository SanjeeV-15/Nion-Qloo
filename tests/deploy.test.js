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
