import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { findFreePort, PORT_RANGE_START, PORT_RANGE_END } from "../src/port.js";

test("findFreePort returns a port in the configured range", async () => {
  const port = await findFreePort();
  assert.ok(port >= PORT_RANGE_START && port <= PORT_RANGE_END,
    `port ${port} should be in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
});

test("findFreePort skips a port that is in use", async () => {
  // Occupy the first port in the range and confirm findFreePort returns a later one.
  const blocker = createServer();
  await new Promise(r => blocker.listen(PORT_RANGE_START, "127.0.0.1", r));
  try {
    const port = await findFreePort();
    assert.notEqual(port, PORT_RANGE_START,
      "should not return the occupied port");
    assert.ok(port > PORT_RANGE_START && port <= PORT_RANGE_END);
  } finally {
    blocker.close();
  }
});

test("findFreePort throws if the entire range is occupied", async () => {
  // Open servers on the entire range to force exhaustion.
  const servers = [];
  try {
    for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
      const s = createServer();
      // Best-effort; if one fails (already in use externally), skip it.
      try {
        await new Promise((res, rej) => {
          s.once("error", rej);
          s.listen(p, "127.0.0.1", res);
        });
        servers.push(s);
      } catch {
        /* port already taken outside our control; skip */
      }
    }
    await assert.rejects(findFreePort(), /no free port/i);
  } finally {
    for (const s of servers) s.close();
  }
});
