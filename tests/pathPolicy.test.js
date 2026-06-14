import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import {
  canCopyDestination,
  canDelete,
  canRead,
  canWrite,
  resolveProjectPath
} from "../src/pathPolicy.js";

const config = loadConfig({}, "D:/srv/project");

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
  assert.equal(canRead(config, "C:/Users/martin/.ssh/id_ed25519"), false);
  assert.throws(
    () => resolveProjectPath(config, "C:/Users/martin/.ssh/id_ed25519"),
    /outside compose project/i
  );
});
