import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeConfig,
  composeDown,
  composePull,
  composeUp,
  inspect,
  logs,
  ps,
  restart
} from "../src/docker.js";
import {
  assertKnownContainer,
  assertKnownService,
  listProjectContainers
} from "../src/containers.js";

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

test("logs validates a known container before reading logs", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return {
      stdout: args[1] === "ps" ? JSON.stringify(rows) : "line one\nline two\n",
      stderr: "",
      code: 0
    };
  };

  const result = await logs({ runner, cwd: "D:/srv/project", container: "project-web-1" });

  assert.equal(result, "line one\nline two\n");
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls.map((call) => call.args), [
    ["compose", "ps", "--format", "json"],
    ["logs", "--tail", "200", "project-web-1"]
  ]);
});

test("logs accepts an explicit tail", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return {
      stdout: args[1] === "ps" ? JSON.stringify(rows) : "line\n",
      stderr: "",
      code: 0
    };
  };

  await logs({ runner, cwd: "D:/srv/project", container: "project-web-1", tail: 50 });

  assert.deepEqual(calls[1].args, ["logs", "--tail", "50", "project-web-1"]);
});

test("logs rejects unknown containers before docker logs", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const { calls } = createRunner(JSON.stringify(rows));
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: JSON.stringify(rows), stderr: "", code: 0 };
  };

  await assert.rejects(
    () => logs({ runner, cwd: "D:/srv/project", container: "other-db-1" }),
    /Unknown compose container/
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["compose", "ps", "--format", "json"]);
});

test("inspect validates a known container before docker inspect", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return {
      stdout: args[1] === "ps" ? JSON.stringify(rows) : '[{"Name":"/project-web-1"}]',
      stderr: "",
      code: 0
    };
  };

  const result = await inspect({ runner, cwd: "D:/srv/project", container: "project-web-1" });

  assert.deepEqual(result, [{ Name: "/project-web-1" }]);
  assert.equal(calls[0].file, "docker");
  assert.deepEqual(calls.map((call) => call.args), [
    ["compose", "ps", "--format", "json"],
    ["inspect", "project-web-1"]
  ]);
});

test("inspect rejects unknown containers before docker inspect", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: JSON.stringify(rows), stderr: "", code: 0 };
  };

  await assert.rejects(
    () => inspect({ runner, cwd: "D:/srv/project", container: "other-db-1" }),
    /Unknown compose container/
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["compose", "ps", "--format", "json"]);
});

test("listProjectContainers filters compose project labels when present", async () => {
  const rows = [
    {
      Name: "project-web-1",
      Service: "web",
      Labels: "com.docker.compose.project=project,com.docker.compose.service=web"
    },
    {
      Name: "other-db-1",
      Service: "db",
      Labels: "com.docker.compose.project=other,com.docker.compose.service=db"
    }
  ];
  const { runner } = createRunner(JSON.stringify(rows));

  const project = await listProjectContainers({ runner, cwd: "D:/srv/project" });

  assert.deepEqual([...project.services], ["web"]);
  assert.deepEqual([...project.containers], ["project-web-1"]);
});

test("known service and container assertions reject unknown values", () => {
  const project = {
    services: new Set(["web"]),
    containers: new Set(["project-web-1"])
  };

  assert.doesNotThrow(() => assertKnownService(project, "web"));
  assert.doesNotThrow(() => assertKnownContainer(project, "project-web-1"));
  assert.throws(() => assertKnownService(project, "db"), /Unknown compose service/);
  assert.throws(() => assertKnownContainer(project, "other-db-1"), /Unknown compose container/);
});

test("composeUp validates service before running mutation", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const { calls } = createRunner(JSON.stringify(rows));
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: calls.length === 1 ? JSON.stringify(rows) : "", stderr: "", code: 0 };
  };

  await assert.rejects(
    () => composeUp({ runner, cwd: "D:/srv/project", service: "db" }),
    /Unknown compose service/
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["compose", "ps", "--format", "json"]);
});

test("compose mutation wrappers run expected argv for known inputs", async () => {
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: args[1] === "ps" ? JSON.stringify(rows) : "", stderr: "", code: 0 };
  };

  await composeUp({
    runner,
    cwd: "D:/srv/project",
    service: "web",
    forceRecreate: true
  });
  await composePull({ runner, cwd: "D:/srv/project", service: "web" });
  await composeDown({ runner, cwd: "D:/srv/project" });
  await restart({ runner, cwd: "D:/srv/project", container: "project-web-1" });

  assert.deepEqual(calls.map((call) => call.args), [
    ["compose", "ps", "--format", "json"],
    ["compose", "up", "-d", "--force-recreate", "web"],
    ["compose", "ps", "--format", "json"],
    ["compose", "pull", "web"],
    ["compose", "down"],
    ["compose", "ps", "--format", "json"],
    ["restart", "project-web-1"]
  ]);
});
