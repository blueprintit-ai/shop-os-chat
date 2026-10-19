import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { vaultDecision, buildQueryOptions } from "../src/claude-code.js";
import { createServer } from "../src/server.js";

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), "chat-sec-"));
  const vault = join(root, "vault");
  mkdirSync(join(vault, "Notes"), { recursive: true });
  writeFileSync(join(vault, "Notes", "a.md"), "hi");
  writeFileSync(join(root, "secret.txt"), "nope");
  symlinkSync(join(root, "secret.txt"), join(vault, "Notes", "link.md"));
  return { root, vault, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("vaultDecision allows vault paths and refuses anything outside", () => {
  const v = makeVault();
  try {
    const ok = (tool, input) => assert.equal(vaultDecision(tool, input, v.vault).deny, false, JSON.stringify(input));
    const no = (tool, input) => assert.equal(vaultDecision(tool, input, v.vault).deny, true, JSON.stringify(input));
    ok("Read", { file_path: join(v.vault, "Notes", "a.md") });
    ok("Read", { file_path: "Notes/a.md" });
    ok("Glob", { pattern: "**/*.md" });
    ok("Grep", { pattern: "hi", path: "Notes" });
    no("Read", { file_path: join(v.root, "secret.txt") });
    no("Read", { file_path: "../secret.txt" });
    no("Read", { file_path: join(v.vault, "Notes", "link.md") });
    no("Read", { file_path: "/etc/passwd" });
    no("Glob", { pattern: "/Users/**/.ssh/*" });
    no("Grep", { pattern: "x", path: "/" });
  } finally { v.cleanup(); }
});

test("buildQueryOptions installs the vault hook, which blocks an outside read", async () => {
  const v = makeVault();
  try {
    const opts = buildQueryOptions({ vaultPath: v.vault, systemPrompt: "x" });
    const hook = opts.hooks.PreToolUse[0].hooks[0];
    const out = await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(v.root, "secret.txt") } });
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.deepEqual(await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "Notes/a.md" } }), {});
  } finally { v.cleanup(); }
});

function call(port, { method = "GET", path = "/", host, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: host ?? `127.0.0.1:${port}`, "content-type": "application/json" };
    if (origin) headers.origin = origin;
    const r = request({ host: "127.0.0.1", port, method, path, headers }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on("error", reject);
    r.end(method === "GET" ? undefined : "{}");
  });
}

test("server refuses foreign Host names and cross-site POSTs", async () => {
  const v = makeVault();
  const server = createServer({ vaultPath: v.vault, runTurn: async function* () {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    assert.equal(await call(port, { host: `attacker.example:${port}` }), 421);
    assert.equal(await call(port, { host: "localhost:1" }), 421);
    assert.notEqual(await call(port, { host: `localhost:${port}` }), 421);
    assert.equal(await call(port, { method: "POST", path: "/new-session", origin: "http://evil.example" }), 403);
    assert.notEqual(await call(port, { method: "POST", path: "/new-session", origin: `http://127.0.0.1:${port}` }), 403);
  } finally {
    await new Promise((r) => server.close(r));
    v.cleanup();
  }
});
