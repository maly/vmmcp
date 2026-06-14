import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import {
  copyFileTool,
  deleteFileTool,
  listBackupsTool,
  readFileTool,
  restoreFileTool,
  writeFileTool
} from "../src/fileOps.js";

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-fileops-"));
  await fs.mkdir(path.join(root, "nginx-vhost"));
  await fs.writeFile(path.join(root, "docker-compose.yml"), "services: {}\n");
  await fs.writeFile(path.join(root, "nginx-vhost", "app.conf"), "old config\n");
  await fs.writeFile(path.join(root, ".env"), "SECRET=value\n");
  await fs.writeFile(path.join(root, "strata.env"), "PLAIN=value\n");
  return {
    root,
    config: loadConfig({ composeProjectDir: root }, root)
  };
}

test("readFileTool returns allowed file contents", async () => {
  const { config } = await createProject();

  const content = await readFileTool(config, "docker-compose.yml");

  assert.equal(content, "services: {}\n");
});

test("writeFileTool rejects compose file writes by default", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => writeFileTool(config, "docker-compose.yml", "services:\n  bad:\n    image: attacker\n"),
    /not writable/
  );
});

test("writeFileTool creates a backup before overwriting", async () => {
  const { config } = await createProject();

  await writeFileTool(config, "nginx-vhost/app.conf", "new config\n");

  assert.equal(await readFileTool(config, "nginx-vhost/app.conf"), "new config\n");
  const backups = await listBackupsTool(config, "nginx-vhost/app.conf");
  assert.equal(backups.length, 1);

  await restoreFileTool(config, "nginx-vhost/app.conf");

  assert.equal(await readFileTool(config, "nginx-vhost/app.conf"), "old config\n");
});

test("deleteFileTool creates a backup before deletion", async () => {
  const { config } = await createProject();

  await deleteFileTool(config, "nginx-vhost/app.conf");

  await assert.rejects(() => readFileTool(config, "nginx-vhost/app.conf"), /ENOENT/);
  const backups = await listBackupsTool(config, "nginx-vhost/app.conf");
  assert.equal(backups.length, 1);

  await restoreFileTool(config, "nginx-vhost/app.conf", backups[0]);

  assert.equal(await readFileTool(config, "nginx-vhost/app.conf"), "old config\n");
});

test("copyFileTool rejects env file sources", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => copyFileTool(config, "strata.env", "nginx-vhost/strata.env.copy"),
    /not readable/
  );
});

test("writeFileTool rejects whole-file env writes", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => writeFileTool(config, ".env", "SECRET=changed\n"),
    /not writable/
  );
});

test("readFileTool rejects raw env file reads", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => readFileTool(config, ".env"),
    /not readable/
  );
  await assert.rejects(
    () => readFileTool(config, "strata.env"),
    /not readable/
  );
  await assert.rejects(
    () => readFileTool(config, "other.env"),
    /not readable/
  );
});

test("readFileTool rejects symlink escapes from allowed paths", async () => {
  const { root, config } = await createProject();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-outside-"));
  await fs.writeFile(path.join(outside, "secret.conf"), "outside secret\n");
  await fs.rm(path.join(root, "nginx-vhost"), { recursive: true, force: true });
  await fs.symlink(outside, path.join(root, "nginx-vhost"), "junction");

  await assert.rejects(
    () => readFileTool(config, "nginx-vhost/secret.conf"),
    /outside compose project/
  );
});

test("writeFileTool rejects dangling symlink ancestors", async () => {
  const { root, config } = await createProject();
  const missingOutside = path.join(os.tmpdir(), `vm-mcp-missing-${Date.now()}`);
  await fs.rm(path.join(root, "nginx-vhost"), { recursive: true, force: true });
  await fs.symlink(missingOutside, path.join(root, "nginx-vhost"), "junction");

  await assert.rejects(
    () => writeFileTool(config, "nginx-vhost/app.conf", "new config\n"),
    /outside compose project|symlink/i
  );
});
