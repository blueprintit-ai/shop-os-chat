import { test } from "node:test";
import assert from "node:assert/strict";
import { READ_ONLY_TOOLS, buildQueryOptions } from "../src/claude-code.js";

test("READ_ONLY_TOOLS is exactly Read/Glob/Grep", () => {
  assert.deepEqual([...READ_ONLY_TOOLS].sort(), ["Glob", "Grep", "Read"]);
});

test("buildQueryOptions enforces the read-only tool whitelist", () => {
  const opts = buildQueryOptions({
    vaultPath: "/some/vault",
    systemPrompt: "you are SOC",
    claudeSessionId: null,
  });
  assert.deepEqual([...opts.allowedTools].sort(), ["Glob", "Grep", "Read"]);
});

test("buildQueryOptions sets cwd to vault path", () => {
  const opts = buildQueryOptions({
    vaultPath: "/my/vault",
    systemPrompt: "x",
    claudeSessionId: null,
  });
  assert.equal(opts.cwd, "/my/vault");
});

test("buildQueryOptions passes systemPrompt through", () => {
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "you are SOC",
    claudeSessionId: null,
  });
  assert.equal(opts.systemPrompt, "you are SOC");
});

test("buildQueryOptions includes resume when claudeSessionId provided", () => {
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "x",
    claudeSessionId: "abc-123",
  });
  assert.equal(opts.resume, "abc-123");
});

test("buildQueryOptions omits resume when claudeSessionId is null", () => {
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "x",
    claudeSessionId: null,
  });
  assert.equal(opts.resume, undefined);
});

test("buildQueryOptions sets permissionMode to default (tool restriction enforced via allowedTools)", () => {
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "x",
    claudeSessionId: null,
  });
  assert.equal(opts.permissionMode, "default");
});

test("buildQueryOptions restricts available tools via `tools` (not just auto-approval)", () => {
  // The SDK distinguishes between `tools` (which tools EXIST in the session)
  // and `allowedTools` (which run without prompting). Without `tools`, the
  // model sees Bash/Edit/Write/etc. from the host's Claude Code config.
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "x",
    claudeSessionId: null,
  });
  assert.deepEqual([...opts.tools].sort(), ["Glob", "Grep", "Read"]);
});

test("buildQueryOptions disables filesystem settingSources for SDK isolation", () => {
  // Without settingSources:[] the SDK loads ~/.claude/settings.json and any
  // project .claude/settings.json from the cwd, dragging in the host
  // developer's allowlists, hooks, MCP servers, and skill plugins.
  const opts = buildQueryOptions({
    vaultPath: "/v",
    systemPrompt: "x",
    claudeSessionId: null,
  });
  assert.deepEqual(opts.settingSources, []);
});
