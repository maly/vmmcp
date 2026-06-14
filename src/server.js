import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { runCommand } from "./commandRunner.js";
import { findConfigPath, loadConfig, loadConfigFile } from "./config.js";
import { registerTools } from "./tools.js";

export function createServer({ config = loadConfig(), runner = runCommand } = {}) {
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

  registerTools(server, { config, runner });
  return server;
}

export async function main() {
  const server = createServer({
    config: await loadConfigFile(findConfigPath(process.argv, process.cwd()))
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
