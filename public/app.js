// Shop OS Chat — frontend
const $ = (sel) => document.querySelector(sel);

const els = {
  nameCard: $("#name-card"),
  nameInput: $("#name-input"),
  nameSubmit: $("#name-submit"),
  chat: $("#chat"),
  who: $("#who"),
  messages: $("#messages"),
  composer: $("#composer"),
  prompt: $("#prompt"),
  send: $("#send"),
  end: $("#end"),
};

const STATE = {
  name: null,
  sessionId: null,
  turns: [],
  vaultHash: null, // populated after sha-256 of window.location to namespace localStorage
};

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function init() {
  // Namespace per origin so multiple installs on the same machine don't collide.
  STATE.vaultHash = (await sha256Hex(window.location.origin)).slice(0, 12);
  const storedName = localStorage.getItem(`shop-os-chat:name:${STATE.vaultHash}`);
  if (storedName) {
    await startSession(storedName);
  } else {
    showNamePrompt();
  }
}

function showNamePrompt() {
  els.nameCard.hidden = false;
  els.chat.hidden = true;
  els.nameInput.focus();
}

function showChat() {
  els.nameCard.hidden = true;
  els.chat.hidden = false;
  els.who.textContent = STATE.name;
  els.prompt.focus();
}

async function startSession(name) {
  STATE.name = name;
  localStorage.setItem(`shop-os-chat:name:${STATE.vaultHash}`, name);
  const res = await fetch("/new-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) { toast("Server error starting session."); return; }
  const { sessionId } = await res.json();
  STATE.sessionId = sessionId;
  STATE.turns = [];
  els.messages.innerHTML = "";
  showChat();
}

els.nameSubmit.addEventListener("click", async () => {
  const name = els.nameInput.value.trim();
  if (!name) return;
  await startSession(name);
});
els.nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.nameSubmit.click();
});

els.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = els.prompt.value.trim();
  if (!prompt) return;
  els.prompt.value = "";
  appendMessage("user", STATE.name, prompt);
  STATE.turns.push({ role: "user", content: prompt });
  await streamChat(prompt);
});

async function streamChat(prompt) {
  const assistantNode = appendMessage("assistant", "Shop OS", "");
  const bodyNode = assistantNode.querySelector(".body");
  let text = "";

  const res = await fetch("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: STATE.sessionId, prompt }),
  });
  if (!res.ok || !res.body) {
    bodyNode.textContent = "Sorry, something went wrong contacting Claude. Open Claude Code first and sign in, then refresh this page.";
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Each SSE record ends with \n\n
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const rec = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
      const dataLine = rec.split("\n").find(l => l.startsWith("data: "));
      if (!dataLine) continue;
      let event;
      try { event = JSON.parse(dataLine.slice(6)); } catch { continue; }
      if (event.type === "text") {
        text += event.delta;
        bodyNode.innerHTML = renderMarkdown(text);
        els.messages.scrollTop = els.messages.scrollHeight;
      } else if (event.type === "done") {
        STATE.turns.push({ role: "assistant", content: text });
      } else if (event.type === "error") {
        bodyNode.textContent = "Sorry, something went wrong: " + (event.message || "unknown");
      }
    }
  }
}

function appendMessage(role, who, content) {
  const node = document.createElement("div");
  node.className = `msg ${role}`;
  node.innerHTML = `<span class="who"></span><div class="body"></div>`;
  node.querySelector(".who").textContent = who;
  node.querySelector(".body").innerHTML = renderMarkdown(content);
  els.messages.appendChild(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}

function renderMarkdown(md) {
  // Render markdown, then post-process wikilinks
  let html = window.marked.parse(md);
  // Replace [[Target|Display]] or [[Target]] with clickable obsidian:// links
  const vaultName = guessVaultName();
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
    const text = display || target;
    const href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(target)}`;
    return `<a class="wikilink" href="${href}">${escapeHtml(text)}</a>`;
  });
  return html;
}

function guessVaultName() {
  // The server only knows the vault path. Best effort: last path segment.
  // The customer always sees the same vault name since this app runs per-vault.
  return window.SHOP_OS_VAULT_NAME || "Shop OS Vault";
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// End conversation
els.end.addEventListener("click", async () => {
  await endSession();
});
async function endSession() {
  // Save transcript only if there's something worth saving.
  if (STATE.sessionId && STATE.turns.length > 0) {
    const payload = JSON.stringify({ sessionId: STATE.sessionId, turns: STATE.turns });
    // Prefer sendBeacon for tab-close reliability; fall back to fetch.
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/end-session", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/end-session", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
    }
  }
  // Reset everything and return to the name prompt so the next person
  // walking up to the shop computer identifies themselves fresh.
  STATE.sessionId = null;
  STATE.turns = [];
  STATE.name = null;
  localStorage.removeItem(`shop-os-chat:name:${STATE.vaultHash}`);
  els.messages.innerHTML = "";
  els.nameInput.value = "";
  showNamePrompt();
}
window.addEventListener("beforeunload", () => {
  if (STATE.sessionId && STATE.turns.length > 0) {
    const payload = JSON.stringify({ sessionId: STATE.sessionId, turns: STATE.turns });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/end-session", new Blob([payload], { type: "application/json" }));
    }
  }
});

init();
