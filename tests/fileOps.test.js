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

test("copyFileTool copies bytes without masking", async () => {
  const { config } = await createProject();

  await copyFileTool(config, "strata.env", "nginx-vhost/strata.env.copy");

  assert.equal(await readFileTool(config, "nginx-vhost/strata.env.copy"), "PLAIN=value\n");
});

test("writeFileTool rejects whole-file env writes", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => writeFileTool(config, ".env", "SECRET=changed\n"),
    /not writable/
  );
});
