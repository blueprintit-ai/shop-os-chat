#!/usr/bin/env node
import { resolve, basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { findFreePort } from "../src/port.js";
import { readLicense, validateLicense } from "../src/license.js";
import { createServer } from "../src/server.js";

const c = {
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
  dim:   (s) => `\x1b[2m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
};

function die(msg) {
  console.error(c.red("! ") + msg);
  process.exit(1);
}

function openBrowser(url) {
  const cmd = platform() === "darwin" ? `open "${url}"`
            : platform() === "win32"  ? `start "" "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd, () => { /* best effort */ });
}

function parseArgs(argv) {
  const args = { vault: null, noBrowser: false, port: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--no-browser") args.noBrowser = true;
    else if (a === "--port") args.port = parseInt(argv[++i], 10);
    else if (!args.vault) args.vault = a;
  }
  return args;
}

function help() {
  console.log(`
Shop OS Chat — local read-only chat surface for Shop OS Foundation vaults.

Usage:  shop-os-chat <vault-path> [options]

Options:
  --no-browser    Do not auto-open the browser
  --port <N>      Use a specific port instead of auto-picking 7777-7790
  --help, -h      Show this message
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); process.exit(0); }

  if (!args.vault) die("Missing vault path. Run: shop-os-chat <vault-path>");
  const vaultPath = resolve(args.vault);
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    die(`Vault folder not found: ${vaultPath}\nMove "Shop OS Chat.command" back into your vault folder.`);
  }

  // License gate
  const license = readLicense();
  const lr = validateLicense(license);
  if (!lr.ok) die(lr.error);

  console.log(c.bold(c.cyan("Shop OS Chat")));
  console.log(c.dim(`  vault: ${vaultPath}`));
  console.log(c.dim(`  customer: ${license.customer ?? "unknown"}`));

  const port = args.port ?? await findFreePort().catch(() => null);
  if (!port) die("No free port available in 7777-7790. Close another Shop OS Chat instance and try again.");

  const server = createServer({ vaultPath });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(c.green("✓") + ` Listening at ${c.cyan(url)}`);
    console.log(c.dim("  Press Ctrl-C to stop."));
    if (!args.noBrowser) {
      setTimeout(() => openBrowser(url), 250);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n" + c.dim("Stopping..."));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref?.();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => die(err.message || String(err)));
