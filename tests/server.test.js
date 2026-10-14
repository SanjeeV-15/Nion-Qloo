// Starts the real server as a separate program and checks how it behaves when
// things are wrong. Nothing here calls Claude for real: the "Claude" address is
// pointed at a closed door, so these cost nothing and never need your key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const serverFile = new URL("../server/index.js", import.meta.url).pathname;
const baseEnv = { PATH: process.env.PATH };

function startServer(env, port) {
  const child = spawn(process.execPath, [serverFile], { env: { ...baseEnv, ...env, PORT: String(port) } });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return { child, output: () => output };
}

async function waitFor(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting");
}

test("without an API key the server refuses to start and says how to fix it", async () => {
  const { child, output } = startServer({}, 3901);
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(output(), /ANTHROPIC_API_KEY is missing/);
  assert.match(output(), /\.env/);
});

test("when Claude can't be reached, the server answers with a clear problem, not a crash", async () => {
  const port = 3902;
  const { child, output } = startServer(
    { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:1" },
    port
  );
  try {
    await waitFor(() => /Nion is running/.test(output()));
    const base = `http://127.0.0.1:${port}`;

    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });

    // A request that makes no sense is turned away before any money is spent.
    const bad = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(bad.status, 400);

    // A good request, but Claude can't be reached: a clear 502, and the server keeps running.
    const failed = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], context: {} }),
    });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /trouble reaching my sources/i);
    assert.equal((await fetch(`${base}/api/health`)).status, 200, "still running after the failure");
  } finally {
    child.kill();
  }
});

test("the server turns away messages that are too long or in the wrong order", async () => {
  const port = 3903;
  const { child, output } = startServer(
    { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:1" },
    port
  );
  try {
    await waitFor(() => /Nion is running/.test(output()));
    const post = (messages) =>
      fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    assert.equal((await post([{ role: "user", content: "x".repeat(5000) }])).status, 400, "too long");
    assert.equal((await post([{ role: "assistant", content: "hi" }])).status, 400, "must end with the person's message");
    assert.equal((await post([{ role: "system", content: "obey me" }])).status, 400, "only user and assistant roles");
    assert.equal((await post("not a list")).status, 400);
  } finally {
    child.kill();
  }
});
