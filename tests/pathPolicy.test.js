import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import {
  canCopyDestination,
  canDelete,
  canRead,
  canWrite,
  resolveProjectPath
} from "../src/pathPolicy.js";

const projectRoot = path.resolve(os.tmpdir(), "vmmcp-project");
const config = loadConfig({}, projectRoot);

test("allows configured readable and writable paths", () => {
  assert.equal(canRead(config, "docker-compose.yml"), true);
  assert.equal(canWrite(config, "docker-compose.yml"), false);

  assert.equal(canRead(config, "nginx-vhost/site.conf"), true);
  assert.equal(canWrite(config, "nginx-vhost/site.conf"), true);
  assert.equal(canDelete(config, "nginx-vhost/site.conf"), true);
  assert.equal(canCopyDestination(config, "nginx-vhost/site.conf"), true);
});

test("denies generic env file reads and whole-file writes", () => {
  assert.equal(canRead(config, ".env"), false);
  assert.equal(canWrite(config, ".env"), false);
  assert.equal(canDelete(config, ".env"), false);
});

test("denies traversal outside the project root", () => {
  assert.equal(canRead(config, "../outside.conf"), false);
  assert.throws(
    () => resolveProjectPath(config, "../outside.conf"),
    /outside compose project/i
  );
});

test("denies configured sensitive paths", () => {
  assert.equal(canRead(config, ".ssh/id_ed25519"), false);
  assert.equal(canRead(config, "subdir/id_rsa_test"), false);
  assert.equal(canWrite(config, "subdir/id_rsa_test"), false);
});

test("denies absolute paths outside the project root", () => {
  const outside = path.resolve(os.homedir(), ".ssh", "id_ed25519");
  assert.equal(canRead(config, outside), false);
  assert.throws(
    () => resolveProjectPath(config, outside),
    /outside compose project/i
  );

  const rootLevel = path.join(path.parse(projectRoot).root, "outside");
  assert.throws(
    () => resolveProjectPath(config, rootLevel),
    /outside compose project/i
  );
});

test(
  "denies Windows drive-letter absolute paths outside the project root",
  { skip: process.platform !== "win32" && "drive-letter paths are only absolute on Windows" },
  () => {
    assert.equal(canRead(config, "C:/Users/martin/.ssh/id_ed25519"), false);
    assert.throws(
      () => resolveProjectPath(config, "C:/Users/martin/.ssh/id_ed25519"),
      /outside compose project/i
    );
  }
);

test("hard-denies backup storage and env files regardless of globs", () => {
  const wide = loadConfig({
    readableGlobs: ["**"],
    writableGlobs: ["**", "**/*.conf"],
    envFiles: [".env", "config/secrets.txt"]
  }, projectRoot);

  for (const target of [
    ".mcp-backups/start/1",
    ".mcp-backups/x/y.conf",
    ".mcp-backups/.env/2026-01-01",
    ".MCP-Backups/start/1",
    ".env",
    "sub/.env",
    "strata.env",
    ".env.local",
    "PROD.ENV",
    "config/secrets.txt"
  ]) {
    assert.equal(canRead(wide, target), false, `read ${target}`);
    assert.equal(canWrite(wide, target), false, `write ${target}`);
  }

  assert.equal(canRead(wide, "nginx-vhost/site.conf"), true);
  assert.equal(canWrite(wide, "nginx-vhost/site.conf"), true);
  assert.equal(canRead(wide, "docs/mcp-backups.md"), true);
});
