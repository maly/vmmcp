import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  findConfigPath,
  loadConfig,
  loadConfigFile
} from "../src/config.js";

test("loadConfig returns proposal defaults", () => {
  const config = loadConfig({}, "D:/srv/project");

  assert.equal(config.composeProjectDir, "D:\\srv\\project");
  assert.deepEqual(config.writableGlobs, [
    "nginx-vhost/*",
    "*.conf"
  ]);
  assert.deepEqual(config.readableGlobs, [
    "docker-compose.yml",
    "nginx-vhost/*",
    "*.conf",
    "start",
    "update"
  ]);
  assert.deepEqual(config.denyGlobs, [".ssh/*", "**/id_rsa*", "**/id_ed25519*"]);
  assert.deepEqual(config.envFiles, [".env", "strata.env"]);
  assert.deepEqual(config.envProtectedPatterns, [
    "*PASSWORD*",
    "*API_KEY*",
    "*SECRET*",
    "*TOKEN*"
  ]);
  assert.deepEqual(config.allowedScripts, ["start", "update"]);
  assert.deepEqual(
    config.allowedScripts.filter((script) => config.writableGlobs.includes(script)),
    []
  );
});

test("loadConfig accepts explicit config object overrides", () => {
  const config = loadConfig({
    composeProjectDir: "C:/apps/example",
    writableGlobs: ["sites/*.conf"],
    readableGlobs: ["docker-compose.yml", ".env"],
    denyGlobs: [".ssh/*", "**/private*"],
    envFiles: [".env", "local.env"],
    envProtectedPatterns: ["*PASSWORD*", "*TOKEN*"],
    allowedScripts: ["start", "update"]
  }, "D:/unused");

  assert.equal(config.composeProjectDir, "C:\\apps\\example");
  assert.deepEqual(config.writableGlobs, ["sites/*.conf"]);
  assert.deepEqual(config.readableGlobs, ["docker-compose.yml", ".env"]);
  assert.deepEqual(config.denyGlobs, [".ssh/*", "**/private*"]);
  assert.deepEqual(config.envFiles, [".env", "local.env"]);
  assert.deepEqual(config.envProtectedPatterns, ["*PASSWORD*", "*TOKEN*"]);
  assert.deepEqual(config.allowedScripts, ["start", "update"]);
});

test("loadConfigFile reads JSON config from disk", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-config-"));
  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    composeProjectDir: "./project",
    writableGlobs: ["vhosts/*.conf"],
    readableGlobs: ["docker-compose.yml", ".env"],
    denyGlobs: [".ssh/*"],
    envFiles: [".env"],
    envProtectedPatterns: ["*PASSWORD*"],
    allowedScripts: ["start"]
  }));

  const config = await loadConfigFile(configPath);

  assert.equal(config.composeProjectDir, path.resolve(root, "project"));
  assert.deepEqual(config.writableGlobs, ["vhosts/*.conf"]);
  assert.deepEqual(config.readableGlobs, ["docker-compose.yml", ".env"]);
  assert.deepEqual(config.denyGlobs, [".ssh/*"]);
  assert.deepEqual(config.envFiles, [".env"]);
  assert.deepEqual(config.envProtectedPatterns, ["*PASSWORD*"]);
  assert.deepEqual(config.allowedScripts, ["start"]);
});

test("findConfigPath supports --config and defaults to config.json", () => {
  assert.equal(
    findConfigPath(["node", "src/server.js", "--config", "custom.json"], "D:/app"),
    "D:\\app\\custom.json"
  );
  assert.equal(
    findConfigPath(["node", "src/server.js"], "D:/app"),
    "D:\\app\\config.json"
  );
});
