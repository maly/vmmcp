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

async function createMcpFixture({
  composeConfig = { services: {} },
  inspectResult = []
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-server-"));
  await fs.mkdir(path.join(root, "nginx-vhost"));
  await fs.writeFile(path.join(root, "docker-compose.yml"), "services: {}\n");
  await fs.writeFile(path.join(root, ".env"), [
    "DB_PASSWORD=secret",
    "NORMAL_HOST=visible.test",
    ""
  ].join("\n"));
  await fs.writeFile(path.join(root, "nginx-vhost", "app.conf"), "old\n");

  const calls = [];
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (args[0] === "compose" && args[1] === "ps") {
      return { stdout: JSON.stringify(rows), stderr: "", code: 0 };
    }
    if (args[0] === "compose" && args[1] === "config") {
      return { stdout: JSON.stringify(composeConfig), stderr: "", code: 0 };
    }
    if (args[0] === "inspect") {
      return { stdout: JSON.stringify(inspectResult), stderr: "", code: 0 };
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

async function withMcpClient(fixture, callback) {
  const server = createServer({
    config: fixture.config,
    runner: fixture.runner
  });
  const client = new Client({ name: "vm-mcp-devtools-test", version: "0.0.0" });
  const { clientTransport, serverTransport } = createLinkedTransports();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
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

test("inspect masks every environment value and preserves other fields", async () => {
  const inspectedContainer = {
    Config: {
      Image: "example/web:latest",
      Env: [
        "DB_PASSWORD=hunter2",
        "VIRTUAL_HOST=app.example.test",
        "EMPTY="
      ],
      Labels: { "com.example.role": "web" }
    },
    ContainerConfig: {
      Env: ["DEPLOY_ENV=production"]
    },
    State: { Status: "running" },
    NetworkSettings: { Networks: { default: { IPAddress: "172.18.0.2" } } },
    Mounts: [{ Type: "bind", Source: "/srv/app", Destination: "/app" }],
    HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "8080" }] } }
  };
  const fixture = await createMcpFixture({ inspectResult: [inspectedContainer] });

  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({
      name: "inspect",
      arguments: { container: "project-web-1" }
    });
    const text = response.content[0].text;
    const [result] = JSON.parse(text);

    assert.deepEqual(result.Config.Env, [
      "DB_PASSWORD=****",
      "VIRTUAL_HOST=****",
      "EMPTY=****"
    ]);
    assert.deepEqual(result.ContainerConfig.Env, ["DEPLOY_ENV=****"]);
    assert.doesNotMatch(text, /hunter2|app\.example\.test|production/);
    assert.equal(result.Config.Image, inspectedContainer.Config.Image);
    assert.deepEqual(result.Config.Labels, inspectedContainer.Config.Labels);
    assert.deepEqual(result.State, inspectedContainer.State);
    assert.deepEqual(result.NetworkSettings, inspectedContainer.NetworkSettings);
    assert.deepEqual(result.Mounts, inspectedContainer.Mounts);
    assert.deepEqual(result.HostConfig.PortBindings, inspectedContainer.HostConfig.PortBindings);
  });
});

test("compose_config masks object and array environment values", async () => {
  const composeConfig = {
    services: {
      web: {
        image: "example/web:latest",
        ports: ["8080:80"],
        labels: { "com.example.role": "web" },
        environment: {
          API_TOKEN: "secret-token",
          VIRTUAL_HOST: "app.example.test"
        }
      },
      worker: {
        image: "example/worker:latest",
        environment: ["DEPLOY_ENV=production", "EMPTY="]
      }
    },
    networks: { default: { name: "example_default" } }
  };
  const fixture = await createMcpFixture({ composeConfig });

  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({ name: "compose_config", arguments: {} });
    const text = response.content[0].text;
    const result = JSON.parse(text);

    assert.deepEqual(result.services.web.environment, {
      API_TOKEN: "****",
      VIRTUAL_HOST: "****"
    });
    assert.deepEqual(result.services.worker.environment, [
      "DEPLOY_ENV=****",
      "EMPTY=****"
    ]);
    assert.doesNotMatch(text, /secret-token|app\.example\.test|production/);
    assert.equal(result.services.web.image, composeConfig.services.web.image);
    assert.deepEqual(result.services.web.ports, composeConfig.services.web.ports);
    assert.deepEqual(result.services.web.labels, composeConfig.services.web.labels);
    assert.equal(result.services.worker.image, composeConfig.services.worker.image);
    assert.deepEqual(result.networks, composeConfig.networks);
  });
});

test("read_env keeps its existing pattern-based masking", async () => {
  const fixture = await createMcpFixture();

  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({ name: "read_env", arguments: {} });
    const result = JSON.parse(response.content[0].text);

    assert.equal(result.files[".env"].DB_PASSWORD, "****");
    assert.equal(result.files[".env"].NORMAL_HOST, "visible.test");
  });
});
