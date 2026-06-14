import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig returns proposal defaults", () => {
  const config = loadConfig({}, "D:/srv/project");

  assert.equal(config.composeProjectDir, "D:\\srv\\project");
  assert.deepEqual(config.writableGlobs, [
    "docker-compose.yml",
    "nginx-vhost/*",
    "*.conf",
    "start",
    "update"
  ]);
  assert.deepEqual(config.readableGlobs, [
    "docker-compose.yml",
    "nginx-vhost/*",
    "*.conf",
    "start",
    "update",
    ".env",
    "strata.env",
    "*.env"
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
});

test("loadConfig accepts comma-separated env overrides", () => {
  const config = loadConfig({
    COMPOSE_PROJECT_DIR: "C:/apps/example",
    WRITABLE_GLOBS: "docker-compose.yml,sites/*.conf",
    READABLE_GLOBS: "docker-compose.yml,.env",
    DENY_GLOBS: ".ssh/*,**/private*",
    ENV_FILES: ".env,local.env",
    ENV_PROTECTED_PATTERNS: "*PASSWORD*,*TOKEN*",
    ALLOWED_SCRIPTS: "start,update"
  }, "D:/unused");

  assert.equal(config.composeProjectDir, "C:\\apps\\example");
  assert.deepEqual(config.writableGlobs, ["docker-compose.yml", "sites/*.conf"]);
  assert.deepEqual(config.readableGlobs, ["docker-compose.yml", ".env"]);
  assert.deepEqual(config.denyGlobs, [".ssh/*", "**/private*"]);
  assert.deepEqual(config.envFiles, [".env", "local.env"]);
  assert.deepEqual(config.envProtectedPatterns, ["*PASSWORD*", "*TOKEN*"]);
  assert.deepEqual(config.allowedScripts, ["start", "update"]);
});
