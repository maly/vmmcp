import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

function waitForJsonRpcResponse(child, id) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for response ${id}; stdout=${output}`));
    }, 2000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      for (const line of output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            clearTimeout(timeout);
            resolve(message);
          }
        } catch {
          // Ignore partial lines until more data arrives.
        }
      }
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before response; code=${code}`));
    });
  });
}

test("stdio server responds to initialize", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-stdio-"));
  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify({ composeProjectDir: root }));

  const child = spawn(process.execPath, ["src/server.js", "--config", configPath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const responsePromise = waitForJsonRpcResponse(child, 1);

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "vm-mcp-devtools-test",
          version: "0.0.0"
        }
      }
    })}\n`);

    const response = await responsePromise;

    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, 1);
    assert.equal(response.error, undefined);
    assert.equal(response.result.serverInfo.name, "vm-mcp-devtools");
  } finally {
    child.kill();
  }
});

function createLinkedTransports() {
  const clientTransport = {
    async start() {},
    async send(message) {
      queueMicrotask(() => serverTransport.onmessage?.(message));
    },
    async close() {
      clientTransport.onclose?.();
    }
  };
  const serverTransport = {
    async start() {},
    async send(message) {
      queueMicrotask(() => clientTransport.onmessage?.(message));
    },
    async close() {
      serverTransport.onclose?.();
    }
  };
  return { clientTransport, serverTransport };
}

async function createMcpFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-server-"));
  await fs.mkdir(path.join(root, "nginx-vhost"));
  await fs.writeFile(path.join(root, "docker-compose.yml"), "services: {}\n");
  await fs.writeFile(path.join(root, "nginx-vhost", "app.conf"), "old\n");

  const calls = [];
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (args[0] === "compose" && args[1] === "ps") {
      return { stdout: JSON.stringify(rows), stderr: "", code: 0 };
    }
    if (args[0] === "exec") {
      return { stdout: "exec ok\n", stderr: "", code: 0 };
    }
    return { stdout: "[]", stderr: "", code: 0 };
  };

  return {
    root,
    calls,
    runner,
    config: loadConfig({ composeProjectDir: root }, root)
  };
}

test("MCP tools list and representative calls work through protocol", async () => {
  const fixture = await createMcpFixture();
  const server = createServer({
    config: fixture.config,
    runner: fixture.runner
  });
  const client = new Client({ name: "vm-mcp-devtools-test", version: "0.0.0" });
  const { clientTransport, serverTransport } = createLinkedTransports();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "compose_config",
      "compose_down",
      "compose_pull",
      "compose_up",
      "copy_file",
      "delete_file",
      "exec_in",
      "inspect",
      "list_backups",
      "logs",
      "ps",
      "read_env",
      "read_file",
      "restart",
      "restore_file",
      "run_script",
      "set_env_var",
      "write_file"
    ].sort());

    const psResult = await client.callTool({ name: "ps", arguments: {} });
    assert.deepEqual(JSON.parse(psResult.content[0].text), [{ Name: "project-web-1", Service: "web" }]);

    const readResult = await client.callTool({
      name: "read_file",
      arguments: { path: "docker-compose.yml" }
    });
    assert.equal(readResult.content[0].text, "services: {}\n");

    await client.callTool({
      name: "write_file",
      arguments: { path: "nginx-vhost/app.conf", content: "new\n" }
    });
    await client.callTool({
      name: "restore_file",
      arguments: { path: "nginx-vhost/app.conf" }
    });
    assert.equal(await fs.readFile(path.join(fixture.root, "nginx-vhost", "app.conf"), "utf8"), "old\n");

    const execResult = await client.callTool({
      name: "exec_in",
      arguments: {
        container: "project-web-1",
        argv: ["curl", "http://localhost"]
      }
    });
    assert.match(execResult.content[0].text, /exec ok/);
  } finally {
    await client.close();
    await server.close();
  }
});
