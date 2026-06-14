import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { execIn, runScript } from "../src/execIn.js";

function createRunner() {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    return {
      stdout: args?.[1] === "ps" ? JSON.stringify(rows) : "ok\n",
      stderr: "",
      code: 0
    };
  };
  return { runner, calls };
}

test("execIn runs allowed binaries inside known containers", async () => {
  const { runner, calls } = createRunner();

  const result = await execIn({
    runner,
    cwd: "D:/srv/project",
    container: "project-web-1",
    argv: ["curl", "http://localhost"]
  });

  assert.equal(result.stdout, "ok\n");
  assert.deepEqual(calls.map((call) => call.args), [
    ["compose", "ps", "--format", "json"],
    ["exec", "project-web-1", "curl", "http://localhost"]
  ]);
});

test("execIn allows nginx diagnostics", async () => {
  const { runner, calls } = createRunner();

  await execIn({
    runner,
    cwd: "D:/srv/project",
    container: "project-web-1",
    argv: ["nginx", "-t"]
  });

  assert.deepEqual(calls[1].args, ["exec", "project-web-1", "nginx", "-t"]);
});

test("execIn rejects empty argv and shell binaries", async () => {
  const { runner } = createRunner();

  await assert.rejects(
    () => execIn({ runner, cwd: "D:/srv/project", container: "project-web-1", argv: [] }),
    /non-empty argv/
  );
  await assert.rejects(
    () => execIn({
      runner,
      cwd: "D:/srv/project",
      container: "project-web-1",
      argv: ["sh", "-c", "cat /etc/passwd"]
    }),
    /not allowed/
  );
  await assert.rejects(
    () => execIn({ runner, cwd: "D:/srv/project", container: "project-web-1", argv: ["bash"] }),
    /not allowed/
  );
});

test("execIn rejects raw container disclosure binaries", async () => {
  for (const binary of ["env", "cat", "head", "tail"]) {
    const { runner, calls } = createRunner();

    await assert.rejects(
      () => execIn({
        runner,
        cwd: "D:/srv/project",
        container: "project-web-1",
        argv: [binary]
      }),
      /not allowed/
    );
    assert.equal(calls.length, 0);
  }
});

test("execIn rejects unknown containers before docker exec", async () => {
  const { runner, calls } = createRunner();

  await assert.rejects(
    () => execIn({
      runner,
      cwd: "D:/srv/project",
      container: "other-db-1",
      argv: ["curl", "http://localhost"]
    }),
    /Unknown compose container/
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["compose", "ps", "--format", "json"]);
});

test("runScript runs only configured scripts without shell", async () => {
  const { runner, calls } = createRunner();
  const config = loadConfig({ composeProjectDir: "D:/srv/project" }, "D:/srv/project");

  await runScript({ config, runner, name: "start" });

  assert.equal(calls[0].file, path.join(config.composeProjectDir, "start"));
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.cwd, config.composeProjectDir);

  await assert.rejects(
    () => runScript({ config, runner, name: "deploy" }),
    /not allowed/
  );
});

test("runScript rejects scripts writable through file policy", async () => {
  const { runner, calls } = createRunner();
  const config = loadConfig({
    composeProjectDir: "D:/srv/project",
    writableGlobs: ["start"],
    allowedScripts: ["start"]
  }, "D:/srv/project");

  await assert.rejects(
    () => runScript({ config, runner, name: "start" }),
    /writable through MCP/
  );
  assert.equal(calls.length, 0);
});
