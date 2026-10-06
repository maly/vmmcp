import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { setEnvVar } from "../src/envFiles.js";
import { runScript } from "../src/execIn.js";
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

function wideConfig(root, overrides = {}) {
  return loadConfig({
    composeProjectDir: root,
    writableGlobs: ["**/*.conf", "nginx-vhost/*"],
    readableGlobs: ["docker-compose.yml", "start", "update", "**"],
    ...overrides
  }, root);
}

test("writeFileTool rejects writes into .mcp-backups even with wide globs", async () => {
  const { root } = await createProject();
  const config = wideConfig(root);

  await assert.rejects(
    () => writeFileTool(config, ".mcp-backups/x/y.conf", "evil\n"),
    /not writable/
  );
  await assert.rejects(
    () => copyFileTool(config, "nginx-vhost/app.conf", ".mcp-backups/start/1.conf"),
    /not writable/
  );
});

test("readFileTool rejects env files and their backups even with ** glob", async () => {
  const { root } = await createProject();
  const config = wideConfig(root);
  const { backupId } = await setEnvVar({ config, file: ".env", key: "PLAIN", value: "x" });

  await assert.rejects(() => readFileTool(config, ".env"), /not readable/);
  await assert.rejects(
    () => readFileTool(config, `.mcp-backups/.env/${backupId}`),
    /not readable/
  );
  await assert.rejects(
    () => copyFileTool(config, `.mcp-backups/.env/${backupId}`, "nginx-vhost/leak.conf"),
    /not readable/
  );
  await assert.rejects(
    () => listBackupsTool(config, `.mcp-backups/.env/${backupId}`),
    /not readable/
  );
  const misconfigured = wideConfig(root, { envFiles: [".env", ".mcp-backups/start"] });
  assert.deepEqual(await listBackupsTool(misconfigured, ".mcp-backups/start"), []);
  await assert.rejects(
    () => restoreFileTool(misconfigured, ".mcp-backups/start"),
    /No backups available/
  );
});

test("restoreFileTool rejects readable but non-writable files", async () => {
  const { root } = await createProject();
  await fs.writeFile(path.join(root, "start"), "#!/bin/sh\necho ok\n");
  await fs.mkdir(path.join(root, ".mcp-backups", "start"), { recursive: true });
  await fs.writeFile(path.join(root, ".mcp-backups", "start", "1"), "#!/bin/sh\necho old\n");
  const config = wideConfig(root);

  await assert.rejects(() => restoreFileTool(config, "start", "1"), /not restorable/);
  assert.equal(await fs.readFile(path.join(root, "start"), "utf8"), "#!/bin/sh\necho ok\n");
});

test("restoreFileTool still restores configured env files", async () => {
  const { root, config } = await createProject();
  const { backupId } = await setEnvVar({ config, file: "strata.env", key: "PLAIN", value: "changed" });

  await restoreFileTool(config, "strata.env", backupId);

  assert.equal(await fs.readFile(path.join(root, "strata.env"), "utf8"), "PLAIN=value\n");
});

test("restoreFileTool rejects backups that are not regular files", async () => {
  const { root, config } = await createProject();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-outside-"));
  const dir = path.join(root, ".mcp-backups", "nginx-vhost", "app.conf");
  await fs.mkdir(dir, { recursive: true });
  await fs.symlink(outside, path.join(dir, "1"), "junction");

  await assert.rejects(
    () => restoreFileTool(config, "nginx-vhost/app.conf", "1"),
    /not a regular file/
  );
});

test("restoreFileTool rejects backups resolving outside .mcp-backups", async () => {
  const { root, config } = await createProject();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-outside-"));
  await fs.mkdir(path.join(outside, "nginx-vhost", "app.conf"), { recursive: true });
  await fs.writeFile(path.join(outside, "nginx-vhost", "app.conf", "1"), "evil\n");
  await fs.symlink(outside, path.join(root, ".mcp-backups"), "junction");

  await assert.rejects(
    () => restoreFileTool(config, "nginx-vhost/app.conf", "1"),
    /outside \.mcp-backups/
  );
  assert.equal(await readFileTool(config, "nginx-vhost/app.conf"), "old config\n");
});

test("fake backup -> restore start -> run_script scenario is blocked", async () => {
  const { root } = await createProject();
  await fs.writeFile(path.join(root, "start"), "#!/bin/sh\necho ok\n");
  const config = wideConfig(root);
  const calls = [];
  const runner = async (file, args) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "", code: 0 };
  };

  await assert.rejects(
    () => writeFileTool(config, ".mcp-backups/start/9999-evil.conf", "#!/bin/sh\necho PWNED\n"),
    /not writable/
  );
  assert.deepEqual(await listBackupsTool(config, "start"), []);
  await assert.rejects(() => restoreFileTool(config, "start", "9999-evil.conf"), /not restorable/);
  assert.equal(await fs.readFile(path.join(root, "start"), "utf8"), "#!/bin/sh\necho ok\n");

  await runScript({ config, runner, name: "start" });
  assert.equal(calls.length, 1);
});
