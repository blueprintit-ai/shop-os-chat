import { query } from "@anthropic-ai/claude-agent-sdk";
import { realpathSync } from "node:fs";
import { resolve, isAbsolute, sep, dirname } from "node:path";

// Frozen so a runtime mutation of this array cannot quietly expand the whitelist.
// This whitelist is the entire feature's read-only safety boundary.
export const READ_ONLY_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);

// Resolve symlinks for the deepest part of the path that exists, so a link
// inside the vault cannot point Read at the rest of the disk.
function realish(p) {
  let cur = p;
  const tail = [];
  for (;;) {
    try { return [realpathSync(cur), ...tail.reverse()].join(sep); } catch {}
    const up = dirname(cur);
    if (up === cur) return p;
    tail.push(cur.slice(up.length).replace(/^[\\/]+/, ""));
    cur = up;
  }
}

/**
 * Deny any Read/Glob/Grep that reaches outside the vault (absolute paths,
 * "..", or symlinks). The chat is read-only; this keeps it vault-only too.
 */
export function vaultDecision(toolName, input, vaultPath) {
  const root = realish(resolve(vaultPath));
  const inside = (p) => {
    if (typeof p !== "string" || !p) return true;
    if (p.includes("..")) return false;
    const full = realish(isAbsolute(p) ? resolve(p) : resolve(vaultPath, p));
    return full === root || full.startsWith(root + sep);
  };
  const candidates = toolName === "Read" ? [input?.file_path]
    : toolName === "Glob" ? [input?.path, input?.pattern]
    : toolName === "Grep" ? [input?.path, input?.glob]
    : [];
  for (const p of candidates) {
    if (!inside(p)) return { deny: true, message: "Only files inside this shop's vault can be read here." };
  }
  return { deny: false };
}

export function buildQueryOptions({ vaultPath, systemPrompt, claudeSessionId }) {
  const opts = {
    cwd: vaultPath,
    systemPrompt,
    // `tools` restricts the base set of built-in tools available to the model.
    // `allowedTools` is for auto-approval — it does NOT restrict availability.
    // We pass both so the whitelist is enforced AND those tools run without
    // prompting (the SDK has no user to prompt in our context).
    tools: [...READ_ONLY_TOOLS],
    allowedTools: [...READ_ONLY_TOOLS],
    // Isolate from the host machine's Claude Code config (user/project/local
    // settings.json, CLAUDE.md, hooks, MCP servers, project skill lists).
    // Without this, the developer's personal allowlist, hooks, and plugin
    // tools bleed into the customer's chat session.
    settingSources: [],
    permissionMode: "default",
    maxTurns: 20,
    // Read-only tools are auto-approved, so this hook is the enforcement point
    // that runs for every call: nothing outside the vault.
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hookInput) => {
              if (hookInput.hook_event_name !== "PreToolUse") return {};
              const d = vaultDecision(hookInput.tool_name, hookInput.tool_input, vaultPath);
              if (!d.deny) return {};
              return {
                decision: "block",
                reason: d.message,
                hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.message },
              };
            },
          ],
        },
      ],
    },
  };
  if (claudeSessionId) opts.resume = claudeSessionId;
  return opts;
}

/**
 * Run one user turn against Claude Code. Async-generator yields one of:
 *   { type: "session", claudeSessionId }      first message, captures the id for resume
 *   { type: "text", delta }                   partial assistant text
 *   { type: "tool_use", name, input }         Claude is about to call a tool
 *   { type: "tool_result", name, output }     tool returned (text we want to surface)
 *   { type: "done", text, stats }             final assembled response + usage
 *   { type: "error", message }                terminal error
 */
export async function* runTurn({ prompt, vaultPath, systemPrompt, claudeSessionId }) {
  const options = buildQueryOptions({ vaultPath, systemPrompt, claudeSessionId });
  let collected = "";
  let stats = null;
  try {
    for await (const event of query({ prompt, options })) {
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        yield { type: "session", claudeSessionId: event.session_id };
      } else if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            collected += block.text;
            yield { type: "text", delta: block.text };
          } else if (block.type === "tool_use") {
            yield { type: "tool_use", name: block.name, input: block.input };
          }
        }
      } else if (event.type === "user" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_result") {
            yield { type: "tool_result", name: block.tool_name ?? "tool", output: block.content };
          }
        }
      } else if (event.type === "result") {
        stats = {
          duration_ms: event.duration_ms,
          input_tokens: event.usage?.input_tokens,
          output_tokens: event.usage?.output_tokens,
        };
      }
    }
    yield { type: "done", text: collected, stats };
  } catch (err) {
    yield { type: "error", message: err?.message ?? String(err) };
  }
}
