import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createToolDefinitions } from "../src/tools.js";
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
    ["exec", "project-web-1", "curl", "--proto", "=http,https", "--proto-redir", "=http,https", "http://localhost"]
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

test("runScript rejects scripts that have MCP backups", async () => {
  const { runner, calls } = createRunner();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-script-"));
  await fs.writeFile(path.join(root, "start"), "#!/bin/sh\necho PWNED\n");
  await fs.mkdir(path.join(root, ".mcp-backups", "start"), { recursive: true });
  await fs.writeFile(path.join(root, ".mcp-backups", "start", "9999-evil.conf"), "x\n");
  const config = loadConfig({ composeProjectDir: root }, root);

  await assert.rejects(
    () => runScript({ config, runner, name: "start" }),
    /MCP backups/
  );
  assert.equal(calls.length, 0);
});

async function assertRejected(argv, pattern = /exec_in argument rejected/, options = {}) {
  const { runner, calls } = createRunner();
  await assert.rejects(
    () => execIn({ runner, cwd: "D:/srv/project", container: "project-web-1", argv, ...options }),
    pattern,
    `expected rejection: ${JSON.stringify(argv)}`
  );
  assert.equal(calls.length, 0, `runner must not be called: ${JSON.stringify(argv)}`);
}

async function assertAllowed(argv, expected, options = {}) {
  const { runner, calls } = createRunner();
  await execIn({ runner, cwd: "D:/srv/project", container: "project-web-1", argv, ...options });
  assert.deepEqual(calls[1].args, ["exec", "project-web-1", ...(expected ?? argv)], JSON.stringify(argv));
}

test("grep cannot read secrets or recurse", async () => {
  await assertRejected(["grep", "-a", ".", "/proc/1/environ"]);
  await assertRejected(["grep", ".", "/proc/1/environ"]);
  await assertRejected(["grep", "-r", "secret", "/etc"]);
  await assertRejected(["grep", "-R", "secret", "/etc/nginx"]);
  await assertRejected(["grep", "--recursive", "secret", "/etc/nginx"]);
  await assertRejected(["grep", "-f", "/etc/nginx/nginx.conf", "/etc/nginx/nginx.conf"]);
  await assertRejected(["grep", "x", "/run/secrets/db_password"]);
  await assertRejected(["grep", "x", "/var/run/secrets/kubernetes.io/token"]);
  await assertRejected(["grep", "x", "/etc/nginx/../shadow"]);
  await assertRejected(["grep", "x", "/etc/nginx/.env"]);
  await assertRejected(["grep", "x", "/etc/nginx/app.env"]);
  await assertRejected(["grep", "x", "/etc/passwd"]);
  await assertRejected(["grep", "x", "relative/path"]);
  await assertRejected(["grep", "x"]);
  await assertRejected(["grep", "-m", "x", "y", "/etc/nginx/nginx.conf"]);
});

test("grep on allowed paths with safe flags is permitted", async () => {
  await assertAllowed(["grep", "-n", "server_name", "/etc/nginx/nginx.conf"]);
  await assertAllowed(["grep", "-inE", "error|warn", "/var/log/nginx/error.log"]);
  await assertAllowed(["grep", "-m", "5", "-c", "GET", "/var/log/nginx/access.log"]);
});

test("grep path prefixes are configurable but forbidden paths stay blocked", async () => {
  const options = { grepPathPrefixes: ["/app/logs/"] };
  await assertAllowed(["grep", "x", "/app/logs/a.log"], undefined, options);
  await assertRejected(["grep", "x", "/etc/nginx/nginx.conf"], /outside the allowed prefixes/, options);
  await assertRejected(["grep", "x", "/app/logs/.env"], /not allowed/, options);
  const config = loadConfig({ execGrepPathPrefixes: ["/app/logs"] }, "D:/srv/project");
  assert.deepEqual(config.execGrepPathPrefixes, ["/app/logs/"]);
  assert.throws(() => loadConfig({ execGrepPathPrefixes: ["relative"] }, "D:/srv/project"), /absolute/);
  assert.deepEqual(loadConfig({}, "D:/srv/project").execGrepPathPrefixes, ["/etc/nginx/", "/var/log/nginx/"]);
});

test("curl cannot write files, read local files or load config", async () => {
  await assertRejected(["curl", "-o", "/tmp/x", "http://a"]);
  await assertRejected(["curl", "--output", "/tmp/x", "http://a"]);
  await assertRejected(["curl", "-O", "http://a/file"]);
  await assertRejected(["curl", "-T", "/etc/hostname", "http://a"]);
  await assertRejected(["curl", "-K", "/tmp/cfg", "http://a"]);
  await assertRejected(["curl", "--config", "/tmp/cfg", "http://a"]);
  await assertRejected(["curl", "-c", "/tmp/jar", "http://a"]);
  await assertRejected(["curl", "-D", "/tmp/h", "http://a"]);
  await assertRejected(["curl", "--create-dirs", "http://a"]);
  await assertRejected(["curl", "-d", "@/etc/hostname", "http://a"]);
  await assertRejected(["curl", "--data-binary", "@/etc/hostname", "http://a"]);
  await assertRejected(["curl", "-F", "f=@/etc/hostname", "http://a"]);
  await assertRejected(["curl", "-H", "@/etc/hostname", "http://a"]);
  await assertRejected(["curl", "file:///etc/passwd"]);
  await assertRejected(["curl", "ftp://a/file"]);
  await assertRejected(["curl", "-sS"]);
  await assertRejected(["curl", "--", "http://a"]);
});

test("curl diagnostics are allowed and restricted to http(s)", async () => {
  const forced = ["--proto", "=http,https", "--proto-redir", "=http,https"];
  await assertAllowed(["curl", "-sS", "http://localhost/health"], ["curl", ...forced, "-sS", "http://localhost/health"]);
  await assertAllowed(
    ["curl", "-sSI", "-m", "5", "-H", "Host: example.com", "https://localhost/"],
    ["curl", ...forced, "-sSI", "-m", "5", "-H", "Host: example.com", "https://localhost/"]
  );
  await assertAllowed(
    ["curl", "-X", "POST", "-d", "a=b", "http://localhost/hook"],
    ["curl", ...forced, "-X", "POST", "-d", "a=b", "http://localhost/hook"]
  );
});

test("wget must write to stdout only", async () => {
  await assertRejected(["wget", "-O", "/tmp/x", "http://a"]);
  await assertRejected(["wget", "-qO", "/tmp/x", "http://a"]);
  await assertRejected(["wget", "--output-document=/tmp/x", "http://a"]);
  await assertRejected(["wget", "-P", "/tmp", "http://a"]);
  await assertRejected(["wget", "--directory-prefix=/tmp", "http://a"]);
  await assertRejected(["wget", "-o", "/tmp/log", "http://a"]);
  await assertRejected(["wget", "-a", "/tmp/log", "http://a"]);
  await assertRejected(["wget", "-i", "/tmp/list"]);
  await assertRejected(["wget", "--post-file=/etc/hostname", "http://a"]);
  await assertRejected(["wget", "--config=/tmp/cfg", "http://a"]);
  await assertRejected(["wget", "-b", "http://a"]);
  await assertRejected(["wget", "ftp://a/file"]);
  await assertAllowed(["wget", "-qO-", "http://a"], ["wget", "-O", "-", "-q", "http://a"]);
  await assertAllowed(["wget", "-O", "-", "--timeout=5", "https://a"], ["wget", "-O", "-", "--timeout=5", "https://a"]);
  await assertAllowed(["wget", "http://a"], ["wget", "-O", "-", "http://a"]);
});

test("nginx only allows test and version flags", async () => {
  await assertRejected(["nginx", "-s", "stop"]);
  await assertRejected(["nginx", "-s", "reload"]);
  await assertRejected(["nginx", "-c", "/tmp/evil.conf", "-t"]);
  await assertRejected(["nginx", "-g", "daemon off;"]);
  await assertRejected(["nginx", "-p", "/tmp"]);
  await assertRejected(["nginx"]);
  await assertRejected(["nginx", "-t", "-q"]);
  for (const flag of ["-t", "-T", "-v", "-V"]) {
    await assertAllowed(["nginx", flag]);
  }
});

test("ls, test, getent and nslookup keep working but block forbidden paths", async () => {
  await assertAllowed(["ls", "-la", "/etc/nginx"]);
  await assertAllowed(["ls", "/var/log/nginx"]);
  await assertAllowed(["test", "-f", "/etc/nginx/nginx.conf"]);
  await assertAllowed(["getent", "hosts", "db"]);
  await assertAllowed(["nslookup", "example.com"]);
  await assertAllowed(["nslookup", "-type=MX", "example.com"]);
  await assertRejected(["ls", "/proc"]);
  await assertRejected(["ls", "-l", "/proc/1/"]);
  await assertRejected(["ls", "/run/secrets"]);
  await assertRejected(["ls", "-R", "/etc"]);
  await assertRejected(["ls", "/app/.env"]);
  await assertRejected(["test", "-r", "/proc/1/environ"]);
  await assertRejected(["test", "-f", "/app/../etc/shadow"]);
  await assertRejected(["getent", "shadow"]);
  await assertRejected(["getent", "-s", "files", "hosts"]);
  await assertRejected(["nslookup", "-debug", "example.com"]);
  await assertRejected(["nslookup", "example.com;id"]);
});

test("execIn rejects NUL bytes and non-string argv items", async () => {
  await assertRejected(["curl", "http://a\0b"], /NUL/);
  await assertRejected(["ls", 42], /strings/);
});

test("exec_in tool is not annotated as read-only", () => {
  const config = loadConfig({}, "D:/srv/project");
  const tool = createToolDefinitions({ config, runner: createRunner().runner }).find((t) => t.name === "exec_in");
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.annotations.openWorldHint, true);
});
