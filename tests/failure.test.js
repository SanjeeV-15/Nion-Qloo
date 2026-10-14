import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure } from "../server/failure.js";

test("a used-up credit balance is recognised (Anthropic reports it as a 400)", () => {
  const error = Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });
  assert.equal(classifyFailure(error), "credit");
});

test("a rejected key, a busy service, and anything else", () => {
  assert.equal(classifyFailure(Object.assign(new Error("invalid x-api-key"), { status: 401 })), "key");
  assert.equal(classifyFailure(Object.assign(new Error("forbidden"), { status: 403 })), "key");
  assert.equal(classifyFailure(Object.assign(new Error("slow down"), { status: 429 })), "busy");
  assert.equal(classifyFailure(Object.assign(new Error("overloaded"), { status: 529 })), "busy");
  assert.equal(classifyFailure(new Error("connect ECONNREFUSED")), undefined);
  assert.equal(classifyFailure(undefined), undefined);
});
