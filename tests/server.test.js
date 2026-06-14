import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

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
  const child = spawn(process.execPath, ["src/server.js"], {
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
