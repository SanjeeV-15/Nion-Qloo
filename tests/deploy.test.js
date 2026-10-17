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

test("the demo stays awake on a paid plan and the Node version is pinned", () => {
  assert.doesNotMatch(read("render.yaml"), /plan: free/);
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
