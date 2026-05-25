import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.js";

async function startServer({ vaultPath, fakeRunTurn }) {
  const server = createServer({
    vaultPath,
    runTurn: fakeRunTurn,
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}` };
}

test("GET / returns the index.html shell", async () => {
  const vault = mkdtempSync(join(tmpdir(), "v-"));
  const { server, base } = await startServer({ vaultPath: vault, fakeRunTurn: null });
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /html/);
    const body = await res.text();
    assert.match(body, /Shop OS Chat/);
  } finally {
    server.close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("POST /new-session returns a sessionId", async () => {
  const vault = mkdtempSync(join(tmpdir(), "v-"));
  const { server, base } = await startServer({ vaultPath: vault, fakeRunTurn: null });
  try {
    const res = await fetch(`${base}/new-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Marco" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.sessionId, "string");
    assert.ok(body.sessionId.length > 0);
  } finally {
    server.close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("POST /chat streams SSE events from runTurn", async () => {
  const vault = mkdtempSync(join(tmpdir(), "v-"));
  async function* fakeRunTurn() {
    yield { type: "session", claudeSessionId: "fake-cc-1" };
    yield { type: "text", delta: "Hello, " };
    yield { type: "text", delta: "Marco." };
    yield { type: "done", text: "Hello, Marco.", stats: { duration_ms: 12 } };
  }
  const { server, base } = await startServer({ vaultPath: vault, fakeRunTurn });
  try {
    const newRes = await fetch(`${base}/new-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Marco" }),
    });
    const { sessionId } = await newRes.json();
    const chatRes = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, prompt: "hi" }),
    });
    assert.equal(chatRes.status, 200);
    assert.match(chatRes.headers.get("content-type"), /event-stream/);
    const text = await chatRes.text();
    assert.match(text, /data:.*"type":"text"/);
    assert.match(text, /data:.*"type":"done"/);
  } finally {
    server.close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("POST /chat rejects unknown sessionId", async () => {
  const vault = mkdtempSync(join(tmpdir(), "v-"));
  const { server, base } = await startServer({ vaultPath: vault, fakeRunTurn: null });
  try {
    const res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "nope", prompt: "hi" }),
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("POST /end-session writes a transcript file", async () => {
  const vault = mkdtempSync(join(tmpdir(), "v-"));
  const { server, base } = await startServer({ vaultPath: vault, fakeRunTurn: null });
  try {
    const newRes = await fetch(`${base}/new-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Marco" }),
    });
    const { sessionId } = await newRes.json();
    const endRes = await fetch(`${base}/end-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        turns: [
          { role: "user", content: "test?" },
          { role: "assistant", content: "yes" },
        ],
      }),
    });
    assert.equal(endRes.status, 204);
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(join(vault, "Chats")).filter(f => f !== "CLAUDE.md");
    assert.equal(files.length, 1);
    assert.match(files[0], /-marco\.md$/);
  } finally {
    server.close();
    rmSync(vault, { recursive: true, force: true });
  }
});
