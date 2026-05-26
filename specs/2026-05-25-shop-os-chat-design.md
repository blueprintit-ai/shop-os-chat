---
type: design-spec
project: shop-os-chat
date: 2026-05-25
status: approved
approved-by: Glenn
tags: [shop-os, design-spec, chat, foundation, sdk-claude-code]
---

## Overview

Shop OS Chat is a branded, locally-served, read-only chat surface bundled with [[Projects/shop-os-installer|Shop OS Foundation]]. The shop owner already has full Claude Code access against the vault. This surface exists so employees (and the owner, when they want a softer interface than Claude Code's developer panel) can ask vault-aware questions without write capability.

A Node sidecar invokes the customer's installed Claude Code via the official `@anthropic-ai/claude-code` SDK with a strict tool whitelist (read-only) and `cwd` pointed at the vault folder. A static browser frontend handles the chat UI. Every ended session writes a transcript markdown file into `vault/Chats/`, which itself becomes searchable vault content. No `ANTHROPIC_API_KEY` is involved anywhere; auth piggybacks on the customer's Claude subscription via Claude Code.

## Goals

- Give employees a safe, read-only path to the vault's knowledge without exposing Claude Code's full UI.
- Brand the experience as "Shop OS Chat," not Claude Code, so it feels like a product the owner bought rather than a developer tool they're hosting.
- Ship as part of the existing [[Projects/shop-os-installer|npx installer]] with zero new prerequisites beyond Foundation's existing stack ([[Claude]] Max, Node, Claude Code, Obsidian).
- Auto-save every conversation into the vault as searchable content the owner can later reference via Claude Code.
- Enforce read-only at the SDK level (tool whitelist), not at the prompt level. Prompt-only restriction is theatre; an unprivileged tool list is real.

## Non-goals (out of scope for v1)

- Multi-user authentication, password gating, or any per-employee permission model beyond "you typed your name."
- LAN access. Localhost binding only. If employees need it from their own machines, that is a v2 conversation about network exposure and access control.
- Real-time collaboration (two people typing into the same conversation simultaneously).
- Sidebar of past conversations with click-to-resume. Each session is self-contained; the transcript file IS the record.
- Web search, web fetch, or any internet egress beyond the Claude API calls themselves.
- Custom tool sets per employee. Everyone gets the same read-only whitelist.
- A separate `foundation-chat` license entitlement. Same Foundation license validates the chat.

## User flow (end to end)

1. **Customer runs the installer.** The existing [[Projects/shop-os-installer|npx installer]] picks up a new step `[6/6] Installing Shop OS Chat`, which globally installs `@blueprintit/shop-os-chat` via npm and writes a launcher script into the vault root.

2. **Vault now contains a launcher.** Inside the vault folder, alongside `CLAUDE.md` and `Raw/`, there is now a `Shop OS Chat.command` (Mac) or `Shop OS Chat.bat` (Windows). Visible in Finder / File Explorer, double-clickable.

3. **Marco walks up to the shop computer and double-clicks the launcher.** A terminal window opens (this is the Node sidecar's stdout). The script derives the vault path from its own location (`$(dirname "$0")` on Mac, `%~dp0` on Windows) and invokes `shop-os-chat "<vault-path>"`. The sidecar boots on the first free port starting at 7777, then opens the default browser to `http://localhost:7777`.

4. **Name prompt (first visit only).** The browser page shows a centered card asking "Who's chatting?" with a text field and a "Continue" button. The entered name persists in browser `localStorage` keyed by the vault path's hash. Subsequent visits from the same browser skip this step.

5. **Chat.** Standard layout. Header reads `Shop OS Chat — Marco`. Centered message stream with markdown rendering. Single-line input at the bottom. "End conversation" button at the top right. On first message after the name prompt, the frontend POSTs `/new-session` with `{name}` and gets back `{sessionId}`. The server records the name against the sessionId server-side. Subsequent prompts POST `/chat` with `{sessionId, prompt}`. The server invokes Claude Code via the SDK with the tool whitelist, streams JSON events back via Server-Sent Events. The page renders the response token by token.

6. **Read-only enforcement is invisible to Marco when he asks read questions** ("What was the Smith quote total?"). When he asks a write question ("Add a note that Smith called today"), the model has no write tools available and explains that he should ask [[Glenn]] or open Claude Code directly. This behavior is reinforced by the system prompt but enforced by the absent tools.

7. **End conversation.** Two paths converge on the same `/end-session` handler:
   - Marco clicks "End conversation." The frontend POSTs `{sessionId, name, transcript}` to `/end-session`. The server writes `vault/Chats/2026-05-25-1432-marco.md`. The page resets to a fresh empty chat (no name prompt; name is still in localStorage).
   - Marco closes the tab. The frontend's `beforeunload` handler uses `navigator.sendBeacon('/end-session', ...)` to flush the transcript. Same server-side handler, same file written.

8. **Shutdown.** Marco closes the terminal window the launcher opened. The Node process terminates. Next launch is a fresh boot.

## Architecture

Three components, all on the customer's machine, all owned by us:

### Node sidecar (the server)

- Bare `node:http` server. No Express, no framework. Single executable file (or a small handful of focused modules).
- Endpoints:
  - `GET /` returns the static HTML page (read from disk at boot, served from memory).
  - `GET /assets/*` serves bundled CSS, JS, and the `marked.js` library inlined into the package.
  - `POST /new-session` returns `{sessionId, claudeSessionId}`. Initializes an in-memory session entry.
  - `POST /chat` accepts `{sessionId, prompt}`, spawns Claude Code with `--resume <claudeSessionId>`, streams SSE events back from the subprocess stdout (line-buffered JSON).
  - `POST /end-session` accepts `{sessionId, name, transcript}`, writes the markdown file, deletes the in-memory entry.
- Session state: `Map<sessionId, { claudeSessionId, name, startedAt, lastActivityAt }>`. Sessions expire from memory 1 hour after `lastActivityAt`.
- Server picks the first available port from 7777-7790. Exits with a clear error if all are taken.
- Localhost binding only (`server.listen(port, "127.0.0.1")`).

### Browser frontend (the chat page)

- One HTML file, one JS file, one CSS file. No framework. No CDN. No `fetch` to anywhere except the local sidecar.
- `marked.js` bundled inline (~25 KB) for markdown rendering.
- Code blocks render as monospace blocks with parchment background, matching the [[Projects/shop-os-installer|installer's]] PDF aesthetic.
- Wikilinks of the form `[[Note Name]]` rendered as clickable text that opens `obsidian://open?vault=<vault-name>&file=<note-name>` in a new tab. Obsidian intercepts the URL scheme and jumps to the note.
- Streaming via `EventSource` against `/chat` (SSE). Token-by-token render.
- localStorage key: `shop-os-chat:name:<vault-hash>` for the employee name.
- "End conversation" button POSTs the rendered conversation transcript as markdown to `/end-session`. `beforeunload` fires the same POST via `sendBeacon`.

### Claude Code subprocess (the brain)

- Invoked per `/chat` call. Cold start per message is acceptable for v1 (latency dominated by model response anyway).
- Command shape: `claude -p <prompt> --cwd <vault-path> --output-format stream-json --resume <claudeSessionId> --allowed-tools Read Glob Grep --system-prompt <prompt-text>`.
- `--cwd` ensures all tool calls scope to the customer's vault.
- `--resume <claudeSessionId>` continues the conversation thread across messages.
- `--allowed-tools` is the load-bearing security control. The model literally cannot call `Edit`, `Write`, `Bash`, `Task`, etc. because they are not present in its available tool list.
- `--system-prompt` injects the role and constraints (see below).

> [!note] SDK invocation form
> If the `@anthropic-ai/claude-code` SDK exposes a Node API rather than (or in addition to) the CLI, prefer the Node API to avoid spawning subprocesses. The CLI form documented here is the fallback that we know works today. The implementation plan should verify the SDK surface before locking in subprocess vs in-process.

### Tool whitelist (security boundary)

**Allowed:**

- `Read` — open and read any vault file
- `Glob` — find files by pattern
- `Grep` — search file contents

**Blocked (explicitly excluded from `--allowed-tools`):**

- `Edit`, `Write`, `NotebookEdit` — no file mutation
- `Bash` — no shell access (which would route around write restrictions trivially)
- `Task` — no subagent spawning (a subagent could be invoked with write tools, defeating the whitelist)
- `WebSearch`, `WebFetch` — no internet egress beyond the model API itself
- All MCP tools — out of scope for v1

The whitelist is the security boundary. The system prompt is the *user experience* boundary (it explains the constraint when Claude declines a write request). Both are present; only the whitelist is trusted.

### System prompt

Populated at session start. Auto-discovers shop name and owner from `Context/organization.md` and `Context/operator.md` if they exist, otherwise uses sensible defaults:

```
You are Shop OS Chat for {SHOP_NAME}. You are speaking with {EMPLOYEE_NAME}, a member of the team.

You can read any file in this vault to answer questions. You can search across notes, summarize content, pull up customer history, supplier pricing, past job records, contract terms, and anything else stored in the vault.

You CANNOT write, edit, modify, or delete any file. Those tools are not available to you. If {EMPLOYEE_NAME} asks you to create a note, update a record, log a call, or change anything in the vault, politely explain that you can only answer questions. Direct them to ask {OWNER_NAME} or to open Claude Code directly if they need to make changes.

Be helpful, concrete, and reference specific files when answering. Wherever you cite a vault entity (a customer, a supplier, a project, a person), use [[wikilink]] form so {EMPLOYEE_NAME} can click through to that note in Obsidian.

Conversation date: {TODAY}
```

## Vault changes

### New folder: `vault/Chats/`

Created on first chat that ends with a save. Contains:

- `CLAUDE.md` — short routing doc explaining this folder holds employee chat transcripts; tells Claude Code these are first-class vault content and can be searched/summarized when the owner asks.
- `YYYY-MM-DD-HHmm-<slug>.md` — one file per ended session. Filename uses the local timezone, time at session START.

### Transcript file format

```yaml
---
type: chat-transcript
project: shop-os-chat
date: 2026-05-25
user: marco
started: 14:32
ended: 14:51
turn-count: 8
tags: [chat-transcript, shop-os-chat]
---
```

Body alternates `## User` and `## Assistant` sections. The Assistant's wikilinks are preserved verbatim so the transcript itself becomes a hub: a future Claude Code session searching for `[[Smith Quote]]` will find this transcript as a backlink.

### New launcher in vault root

- Mac: `Shop OS Chat.command`, executable, derives vault path from `$(dirname "$0")`, calls `shop-os-chat "$VAULT_PATH"`.
- Windows: `Shop OS Chat.bat`, derives vault path from `%~dp0`, calls `shop-os-chat "%VAULT_PATH%"`.

Both scripts are short enough to read at a glance. Owner can edit them if they want to (e.g., add `--port 8080`).

## Packaging

### New npm package: `@blueprintit/shop-os-chat`

- New public GitHub repo: `github.com/blueprintit-ai/shop-os-chat`.
- Published as `@blueprintit/shop-os-chat`.
- Binary: `shop-os-chat <vault-path>`.
- Runtime dependencies:
  - `@anthropic-ai/claude-code` (Claude Code SDK).
  - `marked` (bundled into the static page output, not a runtime dep of the server).
- Node 18+ engine requirement (matches the installer).
- Repo layout:
  ```
  shop-os-chat/
    bin/shop-os-chat.js         — entry point, arg parsing, port binding
    src/server.js               — http handlers, session state
    src/claude-code.js          — SDK invocation, tool whitelist, system prompt
    src/transcript.js           — markdown transcript builder
    src/license.js              — license file read + validation
    public/index.html           — static chat page
    public/app.js               — frontend logic (vanilla)
    public/style.css            — parchment + monospace styling
    public/marked.min.js        — bundled markdown renderer
    package.json
    README.md
  ```

### Installer integration

The [[Projects/shop-os-installer|`shop-os-installer`]] package gains a new step. Versioning: bump to v0.2.0 (minor; meaningful new feature). New step pseudocode:

```
[6/6] Installing Shop OS Chat
  · npm install -g @blueprintit/shop-os-chat (with --silent fallback if user lacks global perms)
  · Write `Shop OS Chat.command` (Mac) or `Shop OS Chat.bat` (Windows) into vault root
  · chmod +x on Mac
  · ok "Shop OS Chat installed"
```

Final "Next steps" output updates:

```
Next steps:
  1. Open the Claude Code app and pick your vault folder (Applications / Start menu)
  2. In the Claude prompt, run /obsidian:os-setup to personalize your vault
  3. Walk through the onboarding interview
  4. To let your team chat with the vault, double-click "Shop OS Chat" in your vault folder
```

## License gating

- On boot, `shop-os-chat` reads `~/.shopos/license.json` (written by the installer).
- Validates locally first: license exists, `valid_until` is in the future (or null for perpetual), `entitlements` includes `"foundation"`.
- Optionally re-validates against the license server (`/validate` endpoint) once per day; caches result. Skipped if offline.
- If validation fails: terminal prints a clear renewal message with a link to support, exits with non-zero status. Browser does not open.
- Same Foundation entitlement; no new `foundation-chat` SKU. À-la-carte sale is explicitly out of scope per [[Glenn]]'s call on 2026-05-25.

## Error handling at launch

| Condition | Behavior |
|---|---|
| Claude Code binary not on PATH | Terminal prints "Claude Code is not installed. Get it at https://claude.ai/code, then try again." Exits. |
| Claude Code not signed in | First `/chat` call fails. Page renders a clear error card: "Open Claude Code first and sign in, then refresh this page." |
| License missing | "License file not found. Reinstall Shop OS or contact support." Exits. |
| License expired | "Your Shop OS license expired on {date}. Reply to your welcome email to renew." Exits. |
| License revoked | "This Shop OS license has been revoked. Contact support." Exits. |
| Ports 7777-7790 all taken | "No free port available in the range 7777-7790. Close another instance of Shop OS Chat and try again." Exits. |
| Vault folder missing (launcher moved out of vault) | "Cannot find the vault folder for this launcher. Move Shop OS Chat.command back into your vault folder." Exits. |
| Vault folder has no write access (chmod issue) | "Cannot write to the vault folder. Check folder permissions." Exits before binding port. |

All terminal errors are formatted with the same red `!` prefix the installer uses, for visual consistency.

## Observability and quality

- Server logs each session start, end, and chat turn to stdout in a single line: `{ts, sessionId, name, event, ...}`. The terminal window the customer launched is enough to debug.
- No remote logging, no telemetry, no opt-in/opt-out flag. The customer's data stays on their machine.
- Transcripts are the durable record of any session; the owner's audit trail is `vault/Chats/`.

## Open implementation questions for the plan

The design is approved; these are tactical questions for the implementation phase, not product decisions:

1. **SDK API surface verification.** Confirm whether `@anthropic-ai/claude-code` exposes a programmatic Node API (preferred) or only CLI invocation (subprocess fallback). Plan should branch on the answer.
2. **Streaming format.** Confirm the exact event schema emitted by `--output-format stream-json` and how to map it to SSE events on the wire (probably 1:1 passthrough, but worth a smoke test).
3. **Cold start latency.** Measure subprocess spawn time on a typical mini-PC. If it adds more than ~500ms per turn, the implementation plan may want to keep a long-lived Claude Code process and pipe through it instead.
4. **Localstorage hash.** What hash function for keying name persistence per vault? A simple sha-256 of the vault path is fine; `crypto.subtle.digest` in the browser, no deps.
5. **Markdown library size.** If `marked` is too large (~25 KB minified), consider `micromark` or a hand-rolled minimal renderer. Decision deferred to the plan.

## Success criteria

The implementation is complete when:

1. A fresh customer runs the v0.2.0 installer end-to-end on a clean machine and ends up with a working `Shop OS Chat.command` (or `.bat`) in the vault root, with no manual steps beyond the existing installer prompts.
2. Double-clicking the launcher opens the browser to a working chat page within 5 seconds on a typical mini-PC.
3. An employee can ask a vault-aware question and get a streaming, markdown-rendered, wikilink-aware answer in under 10 seconds for typical-sized vaults.
4. Asking the assistant to write or edit anything is gracefully declined with a clear explanation, and no write tool calls appear in the model's tool-use trace (verified by inspecting the SDK event stream).
5. Closing the chat (either via "End conversation" or tab close) reliably writes a transcript to `vault/Chats/` with correct frontmatter and conversation body.
6. Revoking the customer's license via the [[Projects/shop-os-license-server|admin dashboard]] causes the chat to refuse to start on next launch within one validation cycle (1 day max, or immediately if the dev runs `--revalidate-now`).
