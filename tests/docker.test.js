import assert from "node:assert/strict";
import { test } from "node:test";
import { composeConfig, inspect, logs, ps } from "../src/docker.js";

function createRunner(stdout = "") {
  const calls = [];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    return { stdout, stderr: "", code: 0 };
  };
  return { runner, calls };
}

test("ps runs docker compose ps with json output", async () => {
  const { runner, calls } = createRunner('[{"Name":"project-web-1","Service":"web"}]');

  const result = await ps({ runner, cwd: "D:/srv/project" });

  assert.deepEqual(result, [{ Name: "project-web-1", Service: "web" }]);
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, ["compose", "ps", "--format", "json"]);
  assert.equal(calls[0].options.cwd, "D:/srv/project");
});

test("composeConfig runs docker compose config with json output", async () => {
  const { runner, calls } = createRunner('{"services":{"web":{"image":"nginx"}}}');

  const result = await composeConfig({ runner, cwd: "D:/srv/project" });

  assert.deepEqual(result, { services: { web: { image: "nginx" } } });
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, ["compose", "config", "--format", "json"]);
});

test("logs runs docker logs with default tail", async () => {
  const { runner, calls } = createRunner("line one\nline two\n");

  const result = await logs({ runner, container: "web" });

  assert.equal(result, "line one\nline two\n");
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, ["logs", "--tail", "200", "web"]);
});

test("logs accepts an explicit tail", async () => {
  const { runner, calls } = createRunner("line\n");

  await logs({ runner, container: "web", tail: 50 });

  assert.deepEqual(calls[0].args, ["logs", "--tail", "50", "web"]);
});

test("inspect runs docker inspect and parses json", async () => {
  const { runner, calls } = createRunner('[{"Name":"/web"}]');

  const result = await inspect({ runner, container: "web" });

  assert.deepEqual(result, [{ Name: "/web" }]);
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls[0].args, ["inspect", "web"]);
});
