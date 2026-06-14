# MCP Devtools Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin Node.js ESM MCP server that runs over stdio through SSH on a dev/stage VM and exposes a bounded set of Docker Compose, file, env, and diagnostic tools without giving Claude Code a free shell.

**Architecture:** The server is an ephemeral stdio MCP process launched by `ssh`, not a daemon and not an HTTP service. All host operations go through explicit capability modules: path policy, command runner, Docker/Compose tools, file operations with backups, env-file editing, and constrained `docker exec`. Mutating tools have fixed signatures and validate service/container/path inputs before doing work.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk` stdio transport, Node built-in test runner, Docker CLI, Docker Compose CLI.

---

## Source Requirements

Primary spec: `docs/proposal-mcp-devtools.md`.

Non-goals from the proposal:
- Do not implement a persistent daemon, systemd unit, HTTP transport, port listener, tunnel, or OAuth layer.
- Do not expose arbitrary SSH or shell access.
- Do not generate secrets, manage file permissions, edit protected env keys, or pull arbitrary images outside compose services.

## Proposed File Structure

- Create: `package.json` - project metadata, ESM mode, dependencies, and scripts.
- Create: `package-lock.json` - locked dependency graph after `npm install`.
- Create: `src/server.js` - MCP stdio bootstrap and tool registration.
- Create: `src/config.js` - environment parsing, defaults, and config validation.
- Create: `src/pathPolicy.js` - path normalization, allow/deny glob matching, and root containment checks.
- Create: `src/commandRunner.js` - child process wrapper that runs binaries with argv arrays and no shell.
- Create: `src/docker.js` - Docker Compose and Docker inspect/log/restart wrappers.
- Create: `src/containers.js` - compose-project service/container discovery and allowlist checks.
- Create: `src/fileOps.js` - read/write/copy/delete plus backup/list/restore.
- Create: `src/envFiles.js` - env file parsing, masking, and protected-key updates.
- Create: `src/execIn.js` - constrained `docker exec` implementation.
- Create: `src/tools.js` - MCP tool schemas mapped to implementation functions.
- Create: `tests/pathPolicy.test.js` - allow/deny/root-containment tests.
- Create: `tests/config.test.js` - config default and parsing tests.
- Create: `tests/docker.test.js` - mocked Docker command argv tests.
- Create: `tests/fileOps.test.js` - backup and file mutation tests using temp directories.
- Create: `tests/envFiles.test.js` - masking and key-level env editing tests.
- Create: `tests/execIn.test.js` - binary allowlist and no-shell tests.
- Create: `tests/server.test.js` - MCP initialize and representative tool smoke tests.
- Create: `docs/deploy-ssh.md` - SSH config and restricted `authorized_keys command=` deployment notes.

## Checkpoint 1: Project Skeleton and MCP Stdio Smoke

**Files:**
- Create: `package.json`
- Create: `src/server.js`
- Create: `src/tools.js`
- Create: `tests/server.test.js`

- [ ] **Step 1: Add package metadata and scripts**

Create `package.json` with ESM enabled, test script using Node's built-in test runner, and dependency on the MCP SDK.

Expected scripts:

```json
{
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: `package-lock.json` is created and install exits with code 0.

- [ ] **Step 3: Write an MCP initialize smoke test**

Add a test that starts `node src/server.js`, sends an MCP initialize request over stdin, and asserts that stdout contains a JSON-RPC response with the same `id`.

Run:

```powershell
npm test
```

Expected before implementation: FAIL because `src/server.js` does not exist or does not answer initialize.

- [ ] **Step 4: Implement minimal stdio MCP server**

Implement `src/server.js` with stdio transport and a server name such as `vm-mcp-devtools`. Register no-op or empty tool list through `src/tools.js`.

- [ ] **Step 5: Verify checkpoint**

Run:

```powershell
npm test
```

Expected: PASS for the initialize smoke test.

**Completion condition:** `node src/server.js` starts as a stdio MCP process, responds to initialize, and all current tests pass.

## Checkpoint 2: Config and Path Policy

**Files:**
- Create: `src/config.js`
- Create: `src/pathPolicy.js`
- Create: `tests/config.test.js`
- Create: `tests/pathPolicy.test.js`

- [ ] **Step 1: Write config tests**

Cover these defaults:

```js
COMPOSE_PROJECT_DIR = process.env.COMPOSE_PROJECT_DIR || process.cwd()
WRITABLE_GLOBS = ["docker-compose.yml", "nginx-vhost/*", "*.conf", "start", "update"]
READABLE_GLOBS = WRITABLE_GLOBS + [".env", "strata.env", "*.env"]
DENY_GLOBS = [".ssh/*", "**/id_rsa*", "**/id_ed25519*"]
ENV_FILES = [".env", "strata.env"]
ENV_PROTECTED_PATTERNS = ["*PASSWORD*", "*API_KEY*", "*SECRET*", "*TOKEN*"]
ALLOWED_SCRIPTS = ["start", "update"]
```

Run:

```powershell
npm test -- tests/config.test.js
```

Expected before implementation: FAIL because `src/config.js` does not exist.

- [ ] **Step 2: Write path policy tests**

Cover:
- `docker-compose.yml` is readable and writable.
- `nginx-vhost/site.conf` is readable and writable.
- `.env` is readable but not writable through `write_file`.
- `../outside.conf` is denied.
- `.ssh/id_ed25519` is denied.
- `subdir/id_rsa_test` is denied.
- Absolute paths outside `COMPOSE_PROJECT_DIR` are denied.

Run:

```powershell
npm test -- tests/pathPolicy.test.js
```

Expected before implementation: FAIL because `src/pathPolicy.js` does not exist.

- [ ] **Step 3: Implement config parsing**

Implement `loadConfig(env = process.env, cwd = process.cwd())` returning normalized arrays and absolute `composeProjectDir`.

- [ ] **Step 4: Implement path policy**

Implement exported functions:
- `resolveProjectPath(config, inputPath)`
- `canRead(config, inputPath)`
- `canWrite(config, inputPath)`
- `canDelete(config, inputPath)`
- `canCopyDestination(config, inputPath)`

All functions must deny paths outside `composeProjectDir` before checking allow globs.

- [ ] **Step 5: Verify checkpoint**

Run:

```powershell
npm test -- tests/config.test.js tests/pathPolicy.test.js
```

Expected: PASS.

**Completion condition:** Path policy enforces explicit read/write allowlists, hard deny globs, and root containment for every future file operation.

## Checkpoint 3: Safe Command Runner and Read-Only Docker Tools

**Files:**
- Create: `src/commandRunner.js`
- Create: `src/docker.js`
- Create: `tests/docker.test.js`

- [ ] **Step 1: Write command argv tests**

Use a fake runner to assert exact argv for:
- `ps()` -> `docker compose ps --format json`
- `composeConfig()` -> `docker compose config --format json`
- `logs("web", 200)` -> `docker logs --tail 200 web`
- `inspect("web")` -> `docker inspect web`

Run:

```powershell
npm test -- tests/docker.test.js
```

Expected before implementation: FAIL because `src/docker.js` does not exist.

- [ ] **Step 2: Implement command runner**

Implement `runCommand(file, args, options)` with `child_process.spawn`, `shell: false`, captured stdout/stderr, timeout support, and non-zero exit reporting.

- [ ] **Step 3: Implement read-only Docker wrappers**

Implement:
- `ps({ runner, cwd })`
- `composeConfig({ runner, cwd })`
- `logs({ runner, container, tail })`
- `inspect({ runner, container })`

The `tail` default is `200`. Ignore any `follow` argument at tool level.

- [ ] **Step 4: Verify checkpoint**

Run:

```powershell
npm test -- tests/docker.test.js
```

Expected: PASS.

**Completion condition:** Read-only Docker functions run only fixed binaries with explicit argv arrays and never construct shell command strings.

## Checkpoint 4: Compose Project Service and Container Allowlist

**Files:**
- Create: `src/containers.js`
- Modify: `src/docker.js`
- Modify: `tests/docker.test.js`

- [ ] **Step 1: Write allowlist tests**

Use mocked `docker compose ps --format json` output containing project containers and an unrelated container. Assert:
- Known compose service passes service validation.
- Known compose container passes container validation.
- Unknown service fails.
- Unknown container fails.
- Mutating wrapper functions reject unknown inputs before calling Docker.

Run:

```powershell
npm test -- tests/docker.test.js
```

Expected before implementation: FAIL because allowlist functions do not exist.

- [ ] **Step 2: Implement discovery**

Implement:
- `listProjectContainers({ runner, cwd })`
- `assertKnownService(projectState, service)`
- `assertKnownContainer(projectState, container)`

Prefer `docker compose ps --format json` as the project boundary. If Docker output includes labels, use compose labels as additional confirmation.

- [ ] **Step 3: Implement mutating Docker wrappers**

Implement:
- `composeUp({ runner, cwd, service, forceRecreate })`
- `composePull({ runner, cwd, service })`
- `composeDown({ runner, cwd })`
- `restart({ runner, container })`

Validate `service` and `container` against project discovery before running a mutating command.

- [ ] **Step 4: Verify checkpoint**

Run:

```powershell
npm test -- tests/docker.test.js
```

Expected: PASS.

**Completion condition:** Docker mutations cannot target services or containers outside the compose project.

## Checkpoint 5: File Operations and Backups

**Files:**
- Create: `src/fileOps.js`
- Create: `tests/fileOps.test.js`
- Modify: `src/tools.js`

- [ ] **Step 1: Write file operation tests**

Use `node:test` temp directories. Cover:
- `readFileTool("docker-compose.yml")` returns file contents.
- `writeFileTool("nginx-vhost/app.conf", content)` creates a backup before overwriting.
- `deleteFileTool("nginx-vhost/app.conf")` creates a backup before deletion.
- `copyFileTool("strata.env", "nginx-vhost/strata.env.copy")` copies bytes without masking.
- `writeFileTool(".env", content)` is rejected.
- `restoreFileTool(path)` restores the latest backup.
- `listBackupsTool(path)` returns available backup IDs.

Run:

```powershell
npm test -- tests/fileOps.test.js
```

Expected before implementation: FAIL because `src/fileOps.js` does not exist.

- [ ] **Step 2: Implement backup path strategy**

Store backups under:

```text
<COMPOSE_PROJECT_DIR>/.mcp-backups/<relative-path>/<ISO-timestamp>
```

Use timestamp strings safe for file names by replacing `:` with `-`.

- [ ] **Step 3: Implement file tools**

Implement:
- `readFileTool(config, path)`
- `writeFileTool(config, path, content)`
- `copyFileTool(config, src, dst)`
- `deleteFileTool(config, path)`
- `listBackupsTool(config, path)`
- `restoreFileTool(config, path, backupId)`

All operations must call path policy first. Mutations must create a backup before changing existing content.

- [ ] **Step 4: Verify checkpoint**

Run:

```powershell
npm test -- tests/fileOps.test.js tests/pathPolicy.test.js
```

Expected: PASS.

**Completion condition:** Every file mutation is reversible through `restore_file`, and file tools cannot read or write outside configured allowlists.

## Checkpoint 6: Env Read, Masking, and Key-Level Editing

**Files:**
- Create: `src/envFiles.js`
- Create: `tests/envFiles.test.js`
- Modify: `src/tools.js`

- [ ] **Step 1: Write env masking tests**

Fixtures should include:

```text
NORMAL_HOST=example.test
DB_PASSWORD=secret
SERVICE_API_KEY=secret
SESSION_TOKEN=secret
PLAIN_VALUE=visible
```

Assert protected values return masked, while normal values remain visible.

Run:

```powershell
npm test -- tests/envFiles.test.js
```

Expected before implementation: FAIL because `src/envFiles.js` does not exist.

- [ ] **Step 2: Write env editing tests**

Cover:
- Updating an existing non-protected key keeps other lines unchanged.
- Adding a new non-protected key appends one line.
- Editing `DB_PASSWORD`, `SERVICE_API_KEY`, `SESSION_TOKEN`, or any key matching protected patterns is rejected.
- Editing a file outside `ENV_FILES` is rejected.
- Editing creates a backup through `fileOps`.

- [ ] **Step 3: Implement env parsing and masking**

Implement:
- `parseEnv(content)`
- `maskEnv(entries, protectedPatterns)`
- `readEnv({ config, service })`

`readEnv` should combine configured env files when present and compose `environment:` values when available through `compose_config`. Protected keys must never be returned in plaintext.

- [ ] **Step 4: Implement key-level env updates**

Implement:
- `setEnvVar({ config, file, key, value })`

Validate the file against `ENV_FILES`, reject protected keys, preserve unrelated lines, and use file backup before writing.

- [ ] **Step 5: Verify checkpoint**

Run:

```powershell
npm test -- tests/envFiles.test.js tests/fileOps.test.js
```

Expected: PASS.

**Completion condition:** Env reads mask secrets, `.env` cannot be overwritten wholesale, and non-secret key edits are versioned and reversible.

## Checkpoint 7: Constrained `exec_in` and Allowed Scripts

**Files:**
- Create: `src/execIn.js`
- Create: `tests/execIn.test.js`
- Modify: `src/tools.js`

- [ ] **Step 1: Write `exec_in` allowlist tests**

Cover:
- `execIn("web", ["curl", "http://localhost"])` runs `docker exec web curl http://localhost`.
- `execIn("web", ["nginx", "-t"])` is allowed.
- Empty argv is rejected.
- `["sh", "-c", "cat /etc/passwd"]` is rejected.
- `["bash"]` is rejected.
- Unknown container is rejected before running Docker.

Run:

```powershell
npm test -- tests/execIn.test.js
```

Expected before implementation: FAIL because `src/execIn.js` does not exist.

- [ ] **Step 2: Implement binary allowlist**

Hard-code allowed binaries:

```js
["nginx", "cat", "grep", "curl", "wget", "getent", "nslookup", "env", "ls", "head", "tail", "test"]
```

Reject anything else as the first argv element.

- [ ] **Step 3: Implement `run_script`**

Implement `runScript({ config, runner, name })` with names restricted to `ALLOWED_SCRIPTS`. It should run the script file from `COMPOSE_PROJECT_DIR` with no shell expansion and reject names not in the allowlist.

- [ ] **Step 4: Verify checkpoint**

Run:

```powershell
npm test -- tests/execIn.test.js tests/docker.test.js
```

Expected: PASS.

**Completion condition:** Diagnostic execution supports only approved read-oriented binaries and approved scripts; no shell, pipes, redirects, or arbitrary commands are exposed.

## Checkpoint 8: MCP Tool Contracts and End-to-End Smoke

**Files:**
- Modify: `src/server.js`
- Modify: `src/tools.js`
- Modify: `tests/server.test.js`
- Create: `docs/deploy-ssh.md`

- [ ] **Step 1: Register all MCP tools**

Expose these tools with explicit schemas:
- `ps`
- `compose_config`
- `logs`
- `inspect`
- `read_file`
- `read_env`
- `exec_in`
- `compose_up`
- `compose_pull`
- `compose_down`
- `restart`
- `write_file`
- `set_env_var`
- `copy_file`
- `delete_file`
- `restore_file`
- `list_backups`
- `run_script`

- [ ] **Step 2: Write MCP tool smoke tests**

Start the server with a fixture project dir and mocked runner. Call representative tools through MCP:
- `ps`
- `read_file`
- `write_file`
- `restore_file`
- `exec_in`

Run:

```powershell
npm test -- tests/server.test.js
```

Expected before implementation: FAIL for unregistered tools.

- [ ] **Step 3: Implement consistent MCP errors**

Return structured errors for denied paths, unknown containers/services, protected env keys, rejected binaries, and failed Docker commands. Error messages should be specific enough for Claude Code to choose the next safe tool call.

- [ ] **Step 4: Write deployment notes**

Create `docs/deploy-ssh.md` with:
- install path on VM, for example `/home/cemedia/mcp-devtools/server.js`
- Claude Code MCP config using `ssh cemedia-test node /home/cemedia/mcp-devtools/server.js`
- restricted `authorized_keys` example using `command="node /home/cemedia/mcp-devtools/server.js"`
- note that the SSH key should be dedicated to this purpose
- note that the server is not a daemon and opens no port

- [ ] **Step 5: Verify full suite**

Run:

```powershell
npm test
```

Expected: PASS.

**Completion condition:** Claude Code can connect to the stdio server through SSH and execute the full safe debugging cycle: read config, inspect logs, make a versioned config change, restart a project container/service, and verify through logs or `exec_in`.

## Manual VM Acceptance Test

Run only after all automated tests pass and the server is deployed to `cemedia-test`.

- [ ] Configure Claude Code MCP server:

```json
{
  "mcpServers": {
    "cemedia-test": {
      "command": "ssh",
      "args": ["cemedia-test", "node", "/home/cemedia/mcp-devtools/server.js"]
    }
  }
}
```

- [ ] Call `ps`.

Expected: returns running containers for the compose project.

- [ ] Call `read_file("docker-compose.yml")`.

Expected: returns compose file content.

- [ ] Call `read_file("~/.ssh/id_ed25519")`.

Expected: denied.

- [ ] Call `read_env()` or `read_env(service)`.

Expected: protected values are masked.

- [ ] Call `write_file("nginx-vhost/test.conf", content)`, then `list_backups("nginx-vhost/test.conf")`, then `restore_file("nginx-vhost/test.conf")`.

Expected: write succeeds, backup is listed, restore succeeds.

- [ ] Call `exec_in(container, ["curl", "http://localhost"])`.

Expected: command executes inside a known project container.

- [ ] Call `exec_in(container, ["sh", "-c", "echo bad"])`.

Expected: denied.

**Completion condition:** The deployed server proves the intended workflow on the VM without interactive SSH shell access or any network listener.

## Commit Plan

Make one commit per checkpoint after its tests pass:

```powershell
git add package.json package-lock.json src tests
git commit -m "chore: scaffold mcp devtools server"
git push
```

Then use checkpoint-specific commit messages:
- `feat: add config and path policy`
- `feat: add read-only docker tools`
- `feat: restrict docker operations to compose project`
- `feat: add versioned file operations`
- `feat: add masked env file tools`
- `feat: add constrained container exec`
- `feat: expose mcp devtools contract`

Project rule from `AGENTS.md`: after every commit, push immediately.

## Self-Review

- Spec coverage: all proposal tools are mapped to checkpoints 3 through 8.
- Security coverage: path allow/deny, env protected keys, no shell command runner, compose container allowlist, and backup/restore are explicitly tested.
- Deployment coverage: SSH stdio architecture and restricted `authorized_keys command=` are documented in checkpoint 8.
- Known remaining risk: access to `docker.sock` remains equivalent to high host privilege, as stated in the proposal; this plan limits exposed MCP capabilities but does not reduce Docker's underlying host privilege model.
