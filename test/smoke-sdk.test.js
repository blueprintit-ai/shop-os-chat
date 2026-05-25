import { test } from "node:test";
import assert from "node:assert/strict";
import { query } from "@anthropic-ai/claude-agent-sdk";

// This test verifies the SDK exposes the async-iterable query() function
// the rest of the plan depends on. It does NOT actually call Claude — it
// only checks the import resolves and the function has the expected shape.
test("@anthropic-ai/claude-agent-sdk exposes query() function", () => {
  assert.equal(typeof query, "function", "query should be a function");
});

test("query() returns an async iterable when called", () => {
  // We pass minimal args. If the SDK is misconfigured (no Claude Code installed)
  // the iterable may yield an error event; that is OK for this smoke test.
  // We just want to confirm the call returns an async-iterable.
  const result = query({ prompt: "hi", options: { maxTurns: 0 } });
  assert.equal(typeof result[Symbol.asyncIterator], "function",
    "query() result should be async-iterable");
});
