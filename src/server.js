import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { registerTools } from "./tools.js";

export function createServer() {
  const server = new Server(
    {
      name: "vm-mcp-devtools",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerTools(server);
  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
