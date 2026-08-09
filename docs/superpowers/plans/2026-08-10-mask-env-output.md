# Mask Environment Values in Tool Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centrally redact environment values from `inspect` and `compose_config` MCP responses without changing unrelated fields or the existing `read_env` behavior.

**Architecture:** Add a shape-aware filter at the single successful-tool serialization boundary in `src/tools.js`. Extend the existing `maskEnv` primitive for Docker's object and `KEY=value` array representations; invoke it with a wildcard for structured Docker configuration while leaving the already-masked `read_env` result unchanged.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk`, Node built-in test runner, no new dependencies.

---

### Task 1: Add protocol-level regression coverage

**Files:**
- Modify: `tests/server.test.js:106-201`

- [ ] **Step 1: Extend the MCP fixture with production-shaped Docker responses**

Change `createMcpFixture` to accept Docker results and create a configured env file:

```js
async function createMcpFixture({
  composeConfig = { services: {} },
  inspectResult = []
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-mcp-server-"));
  await fs.mkdir(path.join(root, "nginx-vhost"));
  await fs.writeFile(path.join(root, "docker-compose.yml"), "services: {}\n");
  await fs.writeFile(path.join(root, ".env"), "DB_PASSWORD=secret\nNORMAL_HOST=visible.test\n");
  await fs.writeFile(path.join(root, "nginx-vhost", "app.conf"), "old\n");
  const calls = [];
  const rows = [{ Name: "project-web-1", Service: "web" }];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (args[0] === "compose" && args[1] === "ps") {
      return { stdout: JSON.stringify(rows), stderr: "", code: 0 };
    }
    if (args[0] === "compose" && args[1] === "config") {
      return { stdout: JSON.stringify(composeConfig), stderr: "", code: 0 };
    }
    if (args[0] === "inspect") {
      return { stdout: JSON.stringify(inspectResult), stderr: "", code: 0 };
    }
    if (args[0] === "exec") {
      return { stdout: "exec ok\n", stderr: "", code: 0 };
    }
    return { stdout: "[]", stderr: "", code: 0 };
  };
  return { root, calls, runner, config: loadConfig({ composeProjectDir: root }, root) };
}
```

- [ ] **Step 2: Add a protocol helper**

Add after `createMcpFixture`:

```js
async function withMcpClient(fixture, callback) {
  const server = createServer({ config: fixture.config, runner: fixture.runner });
  const client = new Client({ name: "vm-mcp-devtools-test", version: "0.0.0" });
  const { clientTransport, serverTransport } = createLinkedTransports();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}
```

- [ ] **Step 3: Write the failing `inspect` test**

Append:

```js
test("inspect masks every environment value and preserves other fields", async () => {
  const inspectResult = [{
    Id: "container-id",
    Config: {
      Image: "nginx:1.27",
      Env: ["DB_PASSWORD=hunter2", "VIRTUAL_HOST=app.example.test", "EMPTY="],
      Labels: { "com.docker.compose.service": "web" }
    },
    ContainerConfig: { Env: ["DEPLOY_ENV=production"] },
    State: { Status: "running" },
    NetworkSettings: { Networks: { default: { IPAddress: "172.18.0.2" } } },
    Mounts: [{ Source: "/srv/app", Destination: "/app" }],
    HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "8080" }] } }
  }];
  const fixture = await createMcpFixture({ inspectResult });
  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({
      name: "inspect",
      arguments: { container: "project-web-1" }
    });
    const result = JSON.parse(response.content[0].text);
    assert.deepEqual(result[0].Config.Env, [
      "DB_PASSWORD=****",
      "VIRTUAL_HOST=****",
      "EMPTY=****"
    ]);
    assert.deepEqual(result[0].ContainerConfig.Env, ["DEPLOY_ENV=****"]);
    for (const plaintext of ["hunter2", "app.example.test", "production"]) {
      assert.equal(JSON.stringify(result).includes(plaintext), false);
    }
    assert.equal(result[0].Config.Image, inspectResult[0].Config.Image);
    assert.deepEqual(result[0].Config.Labels, inspectResult[0].Config.Labels);
    assert.deepEqual(result[0].State, inspectResult[0].State);
    assert.deepEqual(result[0].NetworkSettings, inspectResult[0].NetworkSettings);
    assert.deepEqual(result[0].Mounts, inspectResult[0].Mounts);
    assert.deepEqual(result[0].HostConfig, inspectResult[0].HostConfig);
  });
});
```

- [ ] **Step 4: Write the failing `compose_config` test**

Append:

```js
test("compose_config masks object and array environment values", async () => {
  const composeConfig = {
    name: "project",
    services: {
      web: {
        image: "nginx:1.27",
        environment: { API_TOKEN: "secret-token", VIRTUAL_HOST: "app.example.test" },
        ports: ["8080:80"],
        labels: { role: "frontend" }
      },
      worker: {
        image: "worker:latest",
        environment: ["DEPLOY_ENV=production", "EMPTY="]
      }
    },
    networks: { default: { name: "project_default" } }
  };
  const fixture = await createMcpFixture({ composeConfig });
  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({ name: "compose_config", arguments: {} });
    const result = JSON.parse(response.content[0].text);
    assert.deepEqual(result.services.web.environment, {
      API_TOKEN: "****",
      VIRTUAL_HOST: "****"
    });
    assert.deepEqual(result.services.worker.environment, ["DEPLOY_ENV=****", "EMPTY=****"]);
    for (const plaintext of ["secret-token", "app.example.test", "production"]) {
      assert.equal(JSON.stringify(result).includes(plaintext), false);
    }
    assert.equal(result.services.web.image, composeConfig.services.web.image);
    assert.deepEqual(result.services.web.ports, composeConfig.services.web.ports);
    assert.deepEqual(result.services.web.labels, composeConfig.services.web.labels);
    assert.deepEqual(result.networks, composeConfig.networks);
  });
});
```

- [ ] **Step 5: Add the `read_env` compatibility test**

Append:

```js
test("read_env keeps its existing pattern-based masking", async () => {
  const fixture = await createMcpFixture();
  await withMcpClient(fixture, async (client) => {
    const response = await client.callTool({ name: "read_env", arguments: {} });
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.files[".env"].DB_PASSWORD, "****");
    assert.equal(result.files[".env"].NORMAL_HOST, "visible.test");
  });
});
```

- [ ] **Step 6: Verify RED**

Run `node --test tests/server.test.js`.

Expected: the new `inspect` and `compose_config` tests fail because plaintext values are serialized; the `read_env` compatibility test passes.

### Task 2: Implement the central response filter

**Files:**
- Modify: `src/envFiles.js:37-44`
- Create: `src/outputFilter.js`
- Modify: `src/tools.js:15,47-53,255-266`
- Test: `tests/server.test.js`

- [ ] **Step 1: Extend the existing `maskEnv` primitive**

Replace `maskEnv` in `src/envFiles.js`:

```js
export function maskEnv(entries, protectedPatterns) {
  if (Array.isArray(entries)) {
    return entries.map((entry) => {
      if (typeof entry !== "string") return entry;
      const index = entry.indexOf("=");
      if (index === -1) return entry;
      const key = entry.slice(0, index);
      const masked = maskEnv({ [key]: entry.slice(index + 1) }, protectedPatterns);
      return `${key}=${masked[key]}`;
    });
  }
  if (!entries || typeof entries !== "object") return entries;
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      isProtectedKey(key, protectedPatterns) ? "****" : value
    ])
  );
}
```

- [ ] **Step 2: Create `src/outputFilter.js`**

```js
import { maskEnv } from "./envFiles.js";

const ALL_ENV_KEYS = ["*"];

function maskProperty(parent, property) {
  if (!parent || typeof parent !== "object" || !(property in parent)) return parent;
  return { ...parent, [property]: maskEnv(parent[property], ALL_ENV_KEYS) };
}

function maskNestedProperty(parent, nestedProperty, property) {
  const nested = parent[nestedProperty];
  if (!nested || typeof nested !== "object" || !(property in nested)) return parent;
  return { ...parent, [nestedProperty]: maskProperty(nested, property) };
}

function maskInspect(value) {
  if (!Array.isArray(value)) return value;
  return value.map((container) => {
    if (!container || typeof container !== "object" || Array.isArray(container)) return container;
    const withConfigMasked = maskNestedProperty(container, "Config", "Env");
    return maskNestedProperty(withConfigMasked, "ContainerConfig", "Env");
  });
}

function maskComposeConfig(value) {
  if (!value?.services || typeof value.services !== "object") return value;
  return {
    ...value,
    services: Object.fromEntries(
      Object.entries(value.services).map(([name, service]) => [
        name,
        maskProperty(service, "environment")
      ])
    )
  };
}

export function filterToolOutput(toolName, value) {
  if (toolName === "inspect") return maskInspect(value);
  if (toolName === "compose_config") return maskComposeConfig(value);
  return value;
}
```

- [ ] **Step 3: Route every successful result through the filter**

In `src/tools.js`, import `filterToolOutput`, change the result builder, and pass the tool name:

```js
import { filterToolOutput } from "./outputFilter.js";

function toolResult(toolName, value) {
  const filtered = filterToolOutput(toolName, value);
  if (typeof filtered === "string") {
    return { content: [{ type: "text", text: filtered }] };
  }
  return { content: [{ type: "text", text: jsonText(filtered) }] };
}

// In registerTools:
return toolResult(request.params.name, await handler(request.params.arguments ?? {}));
```

- [ ] **Step 4: Verify GREEN**

Run `node --test tests/server.test.js tests/envFiles.test.js`.

Expected: all focused tests pass, including existing `maskEnv` and `readEnv` coverage.

- [ ] **Step 5: Review and commit atomically with push**

Run:

```powershell
git diff --check
git diff -- src/envFiles.js src/outputFilter.js src/tools.js tests/server.test.js
git add -- src/envFiles.js src/outputFilter.js src/tools.js tests/server.test.js
git commit -m "fix: mask environment values in docker responses"
if ($LASTEXITCODE -eq 0) { git push }
```

Expected: whitespace check passes, the diff is limited to the requested behavior, the commit succeeds, and it is immediately pushed.

### Task 3: Audit and verify the complete server

**Files:**
- Review: `src/tools.js`, `src/docker.js`, `src/fileOps.js`, `src/execIn.js`, `src/envFiles.js`, `src/outputFilter.js`
- Review: `tests/server.test.js`

- [ ] **Step 1: Audit every registered tool by result shape**

Confirm against `createToolDefinitions` and its handlers:

```text
ps              structured status without an environment block
compose_config  structured service configuration, centrally filtered
logs            free-form output, outside approved scope
inspect         structured container configuration, centrally filtered
read_file       free-form content, outside approved scope
read_env        existing pattern-based mask retained
exec_in         constrained free-form output, outside approved scope
mutations       command/file results without structured environment blocks
list_backups    backup identifiers only
run_script      free-form output, outside approved scope
```

Expected: no structured container/service configuration response bypasses the common filter.

- [ ] **Step 2: Run complete verification**

Run:

```powershell
npm test
npm run lint --if-present
node --check src/envFiles.js
node --check src/outputFilter.js
node --check src/tools.js
node --check tests/server.test.js
```

Expected: tests report zero failures; syntax checks exit 0. `package.json` currently has no lint script, so the lint invocation exits 0 without adding a dependency or unrelated script.

- [ ] **Step 3: Review requirements and request code review**

Check each item before review:

```text
[ ] inspect retains env names and no original env values
[ ] inspect preserves asserted image, labels, networks, status, ports, and mounts
[ ] inspect masks VIRTUAL_HOST and DEPLOY_ENV
[ ] compose_config masks object and array environment forms
[ ] read_env retains pattern-based behavior
[ ] one common successful-response path invokes the filter
[ ] existing maskEnv and **** token are reused
[ ] no dependency was added
```

Ask the code reviewer to compare `2b90ab6..HEAD` with `docs/superpowers/specs/2026-08-10-mask-env-output-design.md`, looking especially for unmasked environment shapes, input mutation, or unintended non-env redaction. Resolve Critical or Important findings with another RED/GREEN cycle, then commit and immediately push any fix.

- [ ] **Step 4: Run final fresh verification**

Run:

```powershell
npm test
npm run lint --if-present
git diff --check 2b90ab6..HEAD
git status --short --branch
```

Expected: zero test failures, successful lint invocation, no whitespace errors, and a clean `codex/mask-env-output` worktree tracking its remote branch.
