import { createServer } from "node:http";

export const PORT_RANGE_START = 7777;
export const PORT_RANGE_END = 7790;

function tryPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreePort() {
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (await tryPort(p)) return p;
  }
  throw new Error(`No free port available in ${PORT_RANGE_START}-${PORT_RANGE_END}.`);
}
