import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt } from "../src/system-prompt.js";

function withTempVault(setup, fn) {
  const dir = mkdtempSync(join(tmpdir(), "shopos-vault-"));
  setup(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("buildSystemPrompt includes employee name", () => {
  withTempVault(() => {}, (vault) => {
    const p = buildSystemPrompt({ vaultPath: vault, name: "Marco" });
    assert.match(p, /Marco/);
  });
});

test("buildSystemPrompt extracts shop name from Context/organization.md heading", () => {
  withTempVault((dir) => {
    mkdirSync(join(dir, "Context"), { recursive: true });
    writeFileSync(join(dir, "Context", "organization.md"),
      "---\ntype: org-context\n---\n\n# Acme Cabinets\n\nWe build cabinets.\n");
  }, (vault) => {
    const p = buildSystemPrompt({ vaultPath: vault, name: "Marco" });
    assert.match(p, /Acme Cabinets/);
  });
});

test("buildSystemPrompt extracts owner name from Context/operator.md", () => {
  withTempVault((dir) => {
    mkdirSync(join(dir, "Context"), { recursive: true });
    writeFileSync(join(dir, "Context", "operator.md"),
      "---\ntype: operator-context\nowner: Glenn Chua\n---\n\n# Operator\n");
  }, (vault) => {
    const p = buildSystemPrompt({ vaultPath: vault, name: "Marco" });
    assert.match(p, /Glenn Chua/);
  });
});

test("buildSystemPrompt uses sensible defaults when Context files are missing", () => {
  withTempVault(() => {}, (vault) => {
    const p = buildSystemPrompt({ vaultPath: vault, name: "Marco" });
    assert.match(p, /Shop OS Chat/);
    assert.match(p, /the shop owner/i);
  });
});

test("buildSystemPrompt always states the read-only constraint", () => {
  withTempVault(() => {}, (vault) => {
    const p = buildSystemPrompt({ vaultPath: vault, name: "Marco" });
    assert.match(p, /cannot.*write|read-only|tools.*not available/i);
  });
});
