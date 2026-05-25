import { createServer as createHttpServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore } from "./sessions.js";
import { writeTranscript } from "./transcript.js";
import { runTurn as defaultRunTurn } from "./claude-code.js";
import { buildSystemPrompt } from "./system-prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("Body too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, { "content-type": "application/json; charset=utf-8" }, JSON.stringify(obj));
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function serveStatic(req, res, path) {
  if (!existsSync(path)) {
    return send(res, 404, { "content-type": "text/plain" }, "Not found");
  }
  const ext = extname(path).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(path));
}

export function createServer({ vaultPath, runTurn = defaultRunTurn }) {
  const sessions = new SessionStore();
  const gcTimer = setInterval(() => sessions.gc(), 10 * 60 * 1000);
  gcTimer.unref?.();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        const indexPath = join(PUBLIC_DIR, "index.html");
        if (!existsSync(indexPath)) {
          return send(res, 404, { "content-type": "text/plain" }, "Not found");
        }
        // Inject the real vault name so obsidian:// wikilinks in the frontend
        // resolve to the customer's actual vault, not a hard-coded fallback.
        const html = readFileSync(indexPath, "utf8")
          .replace(/__VAULT_NAME__/g, escapeAttr(basename(vaultPath)));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        const rel = url.pathname.slice("/assets/".length);
        if (rel.includes("..")) {
          return send(res, 400, { "content-type": "text/plain" }, "Bad path");
        }
        return serveStatic(req, res, join(PUBLIC_DIR, rel));
      }

      if (req.method === "POST" && url.pathname === "/new-session") {
        const body = await readJsonBody(req);
        if (!body.name || typeof body.name !== "string") {
          return sendJson(res, 400, { error: "name is required" });
        }
        const s = sessions.create({ name: body.name.trim() });
        return sendJson(res, 200, { sessionId: s.id });
      }

      if (req.method === "POST" && url.pathname === "/chat") {
        const body = await readJsonBody(req);
        const session = sessions.get(body.sessionId);
        if (!session) return sendJson(res, 404, { error: "Unknown sessionId" });
        if (!body.prompt || typeof body.prompt !== "string") {
          return sendJson(res, 400, { error: "prompt is required" });
        }
        sessions.recordTurn(session.id, { role: "user", content: body.prompt });

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        });
        const systemPrompt = buildSystemPrompt({ vaultPath, name: session.name });
        let assistantText = "";
        try {
          for await (const event of runTurn({
            prompt: body.prompt,
            vaultPath,
            systemPrompt,
            claudeSessionId: session.claudeSessionId,
          })) {
            if (event.type === "session" && event.claudeSessionId) {
              sessions.setClaudeSessionId(session.id, event.claudeSessionId);
            }
            if (event.type === "text") assistantText += event.delta;
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
          if (assistantText) {
            sessions.recordTurn(session.id, { role: "assistant", content: assistantText });
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        }
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/end-session") {
        const body = await readJsonBody(req);
        const session = sessions.get(body.sessionId);
        if (!session) return sendJson(res, 404, { error: "Unknown sessionId" });
        if (Array.isArray(body.turns) && body.turns.length > 0) {
          session.turns = body.turns;
        }
        writeTranscript(vaultPath, session);
        sessions.end(session.id);
        return send(res, 204, {}, "");
      }

      return send(res, 404, { "content-type": "text/plain" }, "Not found");
    } catch (err) {
      console.error("[server] error", err);
      try { sendJson(res, 500, { error: err.message }); } catch {}
    }
  });

  return server;
}
