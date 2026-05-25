import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/claude-code.js";

const SKIP = process.env.RUN_E2E !== "1";

test("real Claude Code SDK turn yields text and respects read-only", { skip: SKIP }, async () => {
  const vault = mkdtempSync(join(tmpdir(), "soc-e2e-"));
  // Seed vault with a known file so we can verify retrieval works.
  mkdirSync(join(vault, "Context"), { recursive: true });
  writeFileSync(join(vault, "Context", "organization.md"),
    "---\ntype: org\n---\n\n# Acme Cabinets\n\nWe build cabinets in Boise.\n");

  let gotText = false;
  let sawWriteTool = false;
  let claudeSessionId = null;

  for await (const event of runTurn({
    prompt: "What is the name of the shop in this vault?",
    vaultPath: vault,
    systemPrompt: "You are Shop OS Chat. Read-only. Answer concretely.",
    claudeSessionId: null,
  })) {
    if (event.type === "text") gotText = true;
    if (event.type === "session") claudeSessionId = event.claudeSessionId;
    if (event.type === "tool_use" && ["Edit", "Write", "Bash"].includes(event.name)) {
      sawWriteTool = true;
    }
  }

  assert.ok(gotText, "should have yielded at least one text delta");
  assert.equal(sawWriteTool, false, "must not call any write tool");
  assert.ok(claudeSessionId, "should have captured a Claude session id");

  rmSync(vault, { recursive: true, force: true });
});
