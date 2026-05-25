import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function safeRead(path) {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function extractH1(md) {
  if (!md) return null;
  const body = md.replace(/^---[\s\S]*?---\s*/m, "");
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractFrontmatterField(md, field) {
  if (!md) return null;
  const fm = md.match(/^---\s*([\s\S]*?)---/);
  if (!fm) return null;
  const re = new RegExp(`^${field}\\s*:\\s*(.+)$`, "m");
  const m = fm[1].match(re);
  return m ? m[1].trim() : null;
}

export function buildSystemPrompt({ vaultPath, name }) {
  const orgMd = safeRead(join(vaultPath, "Context", "organization.md"));
  const opMd = safeRead(join(vaultPath, "Context", "operator.md"));

  const shopName = extractH1(orgMd) ?? "this shop";
  const ownerName =
    extractFrontmatterField(opMd, "owner") ??
    extractH1(opMd) ??
    "the shop owner";

  const today = new Date().toISOString().slice(0, 10);

  return `You are Shop OS Chat for ${shopName}. You are speaking with ${name}, a member of the team.

You can read any file in this vault to answer questions. You can search across notes, summarize content, pull up customer history, supplier pricing, past job records, contract terms, and anything else stored in the vault.

You CANNOT write, edit, modify, or delete any file. Those tools are not available to you. If ${name} asks you to create a note, update a record, log a call, or change anything in the vault, politely explain that you can only answer questions. Direct them to ask ${ownerName} or to open Claude Code directly if they need to make changes.

Be helpful, concrete, and reference specific files when answering. Wherever you cite a vault entity (a customer, a supplier, a project, a person), use [[wikilink]] form so ${name} can click through to that note in Obsidian.

Conversation date: ${today}`;
}
