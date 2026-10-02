// Command line entry: `node dist/serve/cli.js serve [--port 8787] [--host 127.0.0.1] [--api-key KEY] [--cors ORIGINS]`.

import { parseArgs } from "node:util";
import { createAssistant } from "../assistant/index.js";
import { createServer } from "./server.js";

const [command, ...rest] = process.argv.slice(2);
if (command !== "serve") {
  console.error("usage: serve [--port 8787] [--host 127.0.0.1] [--api-key KEY] [--cors ORIGINS]");
  process.exit(command === undefined ? 0 : 1);
}

const { values } = parseArgs({
  args: rest,
  options: {
    port: { type: "string", default: "8787" },
    host: { type: "string", default: "127.0.0.1" },
    "api-key": { type: "string" },
    cors: { type: "string" },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid port: ${values.port}`);
  process.exit(1);
}
const apiKey = values["api-key"] ?? process.env.NOODLE_API_KEY;
const assistant = createAssistant();
// Browser chat UIs that call it directly need their origin allowed: --cors http://localhost:3000
const cors = values.cors?.split(",").map((x) => x.trim()).filter(Boolean);
const server = createServer(assistant, { ...(apiKey ? { apiKey } : {}), ...(cors ? { cors } : {}) });
server.listen(port, values.host, () => {
  const auth = apiKey ? "required" : "not required";
  console.log(`${assistant.name} listening on http://${values.host}:${port} (api key ${auth})`);
});
