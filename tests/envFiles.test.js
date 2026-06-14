import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { listBackupsTool, readFileTool } from "../src/fileOps.js";
import { maskEnv, parseEnv, readEnv, setEnvVar } from "../src/envFiles.js";

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-env-"));
  await fs.writeFile(path.join(root, ".env"), [
    "# primary env",
    "NORMAL_HOST=example.test",
    "DB_PASSWORD=secret",
    "SERVICE_API_KEY=secret",
    "SESSION_TOKEN=secret",
    "PLAIN_VALUE=visible",
    ""
  ].join("\n"));
  await fs.writeFile(path.join(root, "strata.env"), "STRATA_HOST=strata.test\n");
  return {
    root,
    config: loadConfig({ composeProjectDir: root }, root)
  };
}

test("parseEnv returns key value entries and ignores comments", () => {
  assert.deepEqual(parseEnv("# comment\nA=1\nEMPTY=\n"), {
    A: "1",
    EMPTY: ""
  });
});

test("maskEnv masks protected keys", () => {
  const masked = maskEnv({
    NORMAL_HOST: "example.test",
    DB_PASSWORD: "secret",
    SERVICE_API_KEY: "secret",
    SESSION_TOKEN: "secret",
    PLAIN_VALUE: "visible"
  }, ["*PASSWORD*", "*API_KEY*", "*SECRET*", "*TOKEN*"]);

  assert.deepEqual(masked, {
    NORMAL_HOST: "example.test",
    DB_PASSWORD: "****",
    SERVICE_API_KEY: "****",
    SESSION_TOKEN: "****",
    PLAIN_VALUE: "visible"
  });
});

test("readEnv reads configured env files and masks protected values", async () => {
  const { config } = await createProject();

  const result = await readEnv({ config });

  assert.equal(result.files[".env"].NORMAL_HOST, "example.test");
  assert.equal(result.files[".env"].DB_PASSWORD, "****");
  assert.equal(result.files[".env"].SERVICE_API_KEY, "****");
  assert.equal(result.files[".env"].SESSION_TOKEN, "****");
  assert.equal(result.files[".env"].PLAIN_VALUE, "visible");
  assert.equal(result.files["strata.env"].STRATA_HOST, "strata.test");
});

test("readEnv includes masked compose environment for a service", async () => {
  const { config } = await createProject();

  const result = await readEnv({
    config,
    service: "web",
    composeConfig: {
      services: {
        web: {
          environment: {
            NORMAL_HOST: "compose.test",
            API_TOKEN: "secret"
          }
        }
      }
    }
  });

  assert.deepEqual(result.environment, {
    NORMAL_HOST: "compose.test",
    API_TOKEN: "****"
  });
});

test("setEnvVar updates an existing non-protected key and creates backup", async () => {
  const { config } = await createProject();

  await setEnvVar({
    config,
    file: ".env",
    key: "NORMAL_HOST",
    value: "changed.test"
  });

  const content = await readFileTool(config, ".env");
  assert.match(content, /# primary env/);
  assert.match(content, /NORMAL_HOST=changed\.test/);
  assert.match(content, /PLAIN_VALUE=visible/);
  assert.equal((await listBackupsTool(config, ".env")).length, 1);
});

test("setEnvVar appends a new non-protected key", async () => {
  const { config } = await createProject();

  await setEnvVar({
    config,
    file: ".env",
    key: "NEW_HOST",
    value: "new.test"
  });

  assert.match(await readFileTool(config, ".env"), /NEW_HOST=new\.test\n$/);
});

test("setEnvVar rejects protected keys and unconfigured env files", async () => {
  const { config } = await createProject();

  await assert.rejects(
    () => setEnvVar({ config, file: ".env", key: "DB_PASSWORD", value: "changed" }),
    /protected env key/
  );
  await assert.rejects(
    () => setEnvVar({ config, file: "other.env", key: "NORMAL_HOST", value: "changed" }),
    /not configured env file/
  );
});
