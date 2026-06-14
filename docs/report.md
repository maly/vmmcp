# Security Review: vm-mcp

## Scope

- Target: `D:\servers\tools\vm-mcp`
- Scan mode: repository-wide Codex Security scan
- Commit: `37407ef`
- Scan ID: `37407ef_20260614T203857+0200`
- Threat model: generated during Phase 1 and copied to `artifacts/01_context/threat_model.md`
- Discovery worklist: 12 source/config rows in `artifacts/02_discovery/deep_review_input.csv`
- Coverage ledger: `artifacts/03_coverage/repository_coverage_ledger.md`
- Validation: targeted Node harnesses against real modules where possible; Docker and destructive paths used fake runners; project tests passed 37/37
- Limitations: no live Docker daemon proof was run; symlink validation was deferred because Windows denied symlink creation with `EPERM`

### Scan Summary

| Field | Value |
|---|---|
| Reportable findings | 7 reportable, 1 deferred follow-up, 1 accepted-risk row |
| Severity mix | High: 4, Medium: 4, Low/accepted risk: 1 |
| Confidence mix | High: 7, Medium: 2 |
| Coverage | All 12 `deep_review_input.csv` rows have work-ledger receipts |
| Validation mode | Targeted module PoCs, static trace, existing tests |
| Markdown report | `C:\tmp\codex-security-scans\vm-mcp\37407ef_20260614T203857+0200\report.md` |
| HTML report | `C:\tmp\codex-security-scans\vm-mcp\37407ef_20260614T203857+0200\report.html` |

## Threat Model

`vm-mcp-devtools` is a small Node.js ESM MCP server intended to run on demand over stdio, usually through SSH to a dev or stage VM. It does not expose an HTTP port, OAuth layer, daemon, or tunnel. Its purpose is to give an agent a bounded set of operational tools for one configured Docker Compose project without granting a free interactive shell.

The primary runtime entrypoint is `src/server.js`, which loads `config.json` or a `--config` path and registers MCP tools from `src/tools.js`. The important product surfaces are Docker Compose inspection and mutation, known service/container discovery, project-scoped file operations, environment file parsing/masking/editing, constrained `docker exec`, allowlisted project scripts, and process execution through `spawn()` with `shell: false`.

Assets and privileges that matter include the SSH identity that launches the MCP server, Docker/Compose access on the VM, the configured `composeProjectDir`, secrets in env files and compose service environments, availability and integrity of the target Docker Compose project, and backup integrity under `.mcp-backups`.

Main trust boundaries are the MCP client-to-server boundary, the SSH launch boundary, the server-process-to-host boundary, the host-to-container boundary, and the operator-controlled config-to-runtime boundary. Attacker-controlled inputs include MCP tool names and arguments, paths, container names, service names, argv arrays, env keys and values, file content, copy destinations, backup IDs, and log tail counts.

Core invariants are: no general shell, file operations stay inside `composeProjectDir`, env secrets are masked by supported env reads, protected env keys cannot be edited through supported env mutation, Docker mutations target only the configured compose project, `exec_in` accepts only allowed binaries inside known project containers, and mutating file operations create backups.

Severity calibration from the threat model treats arbitrary host command execution, arbitrary host file access, broad Docker/container access, and raw secret disclosure as the highest-impact classes. The lack of public HTTP exposure lowers likelihood compared with internet-facing services, but it does not suppress issues where a connected MCP client can break the server's intended confinement boundary.

## Findings

| # | Finding | Severity | Confidence | Category |
|---|---|---|---|---|
| 1 | [Generic read_file exposes raw env secrets despite read_env masking](#1-generic-read_file-exposes-raw-env-secrets-despite-read_env-masking) | high | high | Sensitive data exposure |
| 2 | [exec_in allows unmasked container secret and file disclosure through read binaries](#2-exec_in-allows-unmasked-container-secret-and-file-disclosure-through-read-binaries) | high | high | Sensitive data exposure |
| 3 | [Writable docker-compose.yml can be applied with compose_up to run attacker-chosen containers](#3-writable-docker-composeyml-can-be-applied-with-compose_up-to-run-attacker-chosen-containers) | high | high | Arbitrary Docker workload execution |
| 4 | [Allowed run_script targets overlap default writable files, enabling host script mutation then execution](#4-allowed-run_script-targets-overlap-default-writable-files-enabling-host-script-mutation-then-execution) | high | medium | Host command execution |
| 5 | [set_env_var newline injection can overwrite protected env keys](#5-set_env_var-newline-injection-can-overwrite-protected-env-keys) | medium | high | Injection / protected configuration bypass |
| 6 | [MCP logs tool can read logs from arbitrary Docker containers](#6-mcp-logs-tool-can-read-logs-from-arbitrary-docker-containers) | medium | high | Cross-project data exposure |
| 7 | [MCP inspect tool can inspect arbitrary Docker containers or objects](#7-mcp-inspect-tool-can-inspect-arbitrary-docker-containers-or-objects) | medium | high | Cross-project data exposure |
| 8 | [Lexical path policy does not prevent symlink escape for allowed project paths](#8-lexical-path-policy-does-not-prevent-symlink-escape-for-allowed-project-paths) | medium | medium | Path traversal / symlink escape |
| 9 | [exec_in permits arbitrary outbound requests from project containers through curl and wget](#9-exec_in-permits-arbitrary-outbound-requests-from-project-containers-through-curl-and-wget) | low | high | SSRF / accepted diagnostic risk |

### Confidence Scale

| Label | Meaning |
|---|---|
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; included only for accepted-risk or follow-up candidates. |

### [1] Generic read_file exposes raw env secrets despite read_env masking

| Field | Value |
|---|---|
| Severity | high |
| Confidence | high |
| Confidence rationale | A targeted PoC against the real modules showed raw `.env` secrets returned by `readFileTool` while `readEnv` masked the same key. |
| Category | Sensitive data exposure |
| CWE | CWE-200 Exposure of Sensitive Information; CWE-522 Insufficiently Protected Credentials |
| Affected lines | `src/tools.js:113-119`, `src/config.js:12-17`, `config.example.json:10-18`, `src/fileOps.js:45-51` |

#### Summary

The generic `read_file` tool can read `.env` files directly because the default and example readable globs include `.env`, `strata.env`, and `*.env`. The intended masking control is implemented only in `read_env`, so a connected MCP client can bypass masking by using `read_file`.

#### Validation

Method: targeted Node PoC in `artifacts/05_findings/CAND-37407EF-001/validation_artifacts/poc.mjs`.

Evidence: the PoC wrote `DB_PASSWORD=secret`, then confirmed `readFileTool(config, ".env")` returned the secret while `readEnv({ config })` returned `****`.

Remaining uncertainty: none for default/example configuration. Operators can mitigate by removing env files from readable globs.

#### Dataflow

MCP `read_file.path` -> `tools.js` `read_file` handler -> `fileOps.readFileTool()` -> `canRead()` accepts `.env` from defaults -> `fs.readFile()` returns raw bytes.

#### Reachability

The attacker is a connected MCP client over the SSH stdio transport. The path is not public internet-facing, but env secrecy is an explicit boundary of this MCP server. The result crosses that boundary and exposes project runtime secrets.

#### Severity

High. The exposed data can include database passwords, API keys, session tokens, and other credentials in the configured project. Severity would drop if deployments remove env files from `readableGlobs`; it would rise further if production identity or control-plane credentials are present in those files.

#### Remediation

Remove env files from generic `readableGlobs`, or make `read_file` reject configured env files and require `read_env` for all env reads. Add tests that `read_file(".env")`, `read_file("strata.env")`, and `read_file("*.env")` are denied while `read_env` remains masked.

### [2] exec_in allows unmasked container secret and file disclosure through read binaries

| Field | Value |
|---|---|
| Severity | high |
| Confidence | high |
| Confidence rationale | A targeted PoC showed `exec_in` validates the container, then forwards `env` and returns raw secret output. |
| Category | Sensitive data exposure |
| CWE | CWE-200 Exposure of Sensitive Information |
| Affected lines | `src/tools.js:135-147`, `src/execIn.js:5-17`, `src/execIn.js:20-28`, `src/execIn.js:30-34` |

#### Summary

`exec_in` validates that the selected container belongs to the compose project, but the binary allowlist includes raw disclosure tools such as `env`, `cat`, `head`, and `tail`. Their output is returned without masking, bypassing the env-secret model.

#### Validation

Method: targeted Node PoC with fake runner in `artifacts/05_findings/CAND-37407EF-006/validation_artifacts/poc.mjs`.

Evidence: the PoC observed `docker compose ps --format json` followed by `docker exec project-web-1 env`, returning `DB_PASSWORD=secret`.

Remaining uncertainty: no live container was used, but the code path is direct and covered by the fake runner.

#### Dataflow

MCP `exec_in.argv` -> `tools.js` handler -> `execIn()` -> `assertKnownContainer()` -> `runner("docker", ["exec", container, ...argv])` -> raw stdout returned by `toolResult`.

#### Reachability

A connected MCP client can call `ps` to learn a project container and then call `exec_in` with `argv: ["env"]` or file-read binaries. This stays inside the configured project but crosses the intended secret-disclosure boundary.

#### Severity

High. The path can expose service credentials or readable secret files from the project container. Severity would drop if `exec_in` output is intentionally considered privileged raw diagnostic output; it would rise if project containers hold production credentials.

#### Remediation

Remove `env`, `cat`, `head`, and `tail` from the default `EXEC_BINARIES`, or add per-binary argument/output policies. If `env` remains, mask protected keys before returning output. Add tests that protected env values cannot be returned through `exec_in`.

### [3] Writable docker-compose.yml can be applied with compose_up to run attacker-chosen containers

| Field | Value |
|---|---|
| Severity | high |
| Confidence | high |
| Confidence rationale | A targeted PoC wrote attacker-controlled compose content and showed `compose_up` invokes `docker compose up -d` against it. |
| Category | Arbitrary Docker workload execution |
| CWE | CWE-94 Code Injection; CWE-284 Improper Access Control |
| Affected lines | `src/config.js:4-9`, `src/tools.js:190-198`, `src/docker.js:41-55` |

#### Summary

`docker-compose.yml` is writable by default, and `compose_up` applies the current compose file without validating images, commands, mounts, or privileged settings. A connected MCP client can therefore turn a bounded config edit into arbitrary Docker workload execution.

#### Validation

Method: targeted Node PoC with temp project and fake runner in `artifacts/05_findings/CAND-37407EF-008/validation_artifacts/poc.mjs`.

Evidence: the PoC wrote a compose service with an attacker command, read it back, then showed `composeUp()` calls `docker compose up -d`.

Remaining uncertainty: live Docker execution was not run because it would be destructive. Docker Compose consuming `docker-compose.yml` is intended Docker behavior.

#### Dataflow

MCP `write_file(path="docker-compose.yml")` -> `fileOps.writeFileTool()` -> attacker-controlled compose file -> MCP `compose_up` -> `docker.composeUp()` -> `docker compose up -d`.

#### Reachability

The attacker is a connected MCP client. The path uses two documented tools. The trust boundary crossed is from bounded file edit and compose project operation into arbitrary Docker workload definition, potentially with host bind mounts.

#### Severity

High. Docker access is host-adjacent privilege, and attacker-controlled compose content can run arbitrary containers. Severity would lower only if deployments remove `docker-compose.yml` from writable globs or separately review/apply compose changes.

#### Remediation

Do not allow whole-file writes to `docker-compose.yml` by default, or require a structured, policy-checked compose mutation layer. Block dangerous compose keys such as `privileged`, arbitrary `volumes`, and arbitrary `command` when applied by MCP. Add tests that `compose_up` cannot apply attacker-written compose content without an explicit trusted approval path.

### [4] Allowed run_script targets overlap default writable files, enabling host script mutation then execution

| Field | Value |
|---|---|
| Severity | high |
| Confidence | medium |
| Confidence rationale | A PoC showed write-then-run path composition; practical exploitability depends on executable or spawnable script state in deployment. |
| Category | Host command execution |
| CWE | CWE-94 Code Injection; CWE-73 External Control of File Name or Path |
| Affected lines | `src/config.js:4-9`, `src/config.js:22-44`, `src/tools.js:190-198`, `src/execIn.js:37-43` |

#### Summary

The default writable files include `start` and `update`, and the default allowed scripts also include `start` and `update`. A client can overwrite an allowlisted script and then invoke `run_script` to execute that same host path.

#### Validation

Method: targeted Node PoC in `artifacts/05_findings/CAND-37407EF-009/validation_artifacts/poc.mjs`.

Evidence: the PoC overwrote `start` and showed `runScript({ name: "start" })` invokes the same path with no shell.

Remaining uncertainty: on POSIX, overwriting an existing executable normally preserves mode; newly created files may not be executable.

#### Dataflow

MCP `write_file(path="start")` -> `fileOps.writeFileTool()` -> attacker script content -> MCP `run_script(name="start")` -> `runScript()` -> `runner(<composeProjectDir>/start, [])`.

#### Reachability

A connected MCP client can perform both operations. The impact becomes host command execution when operational scripts already exist and are executable or spawnable.

#### Severity

High with a deployment precondition. The bug crosses from bounded file write to host process execution. Severity would drop if `start` and `update` are never executable in real deployments or are removed from writable globs.

#### Remediation

Separate writable files from executable script allowlists. Make `run_script` refuse scripts that are writable through MCP policy, or verify immutable trusted ownership/content before execution. Add tests that default `writableGlobs` and `allowedScripts` do not overlap.

### [5] set_env_var newline injection can overwrite protected env keys

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A targeted PoC showed direct protected-key edits are blocked, but newline-containing values still write protected assignments. |
| Category | Injection / protected configuration bypass |
| CWE | CWE-74 Injection; CWE-93 Improper Neutralization of CRLF Sequences; CWE-20 Improper Input Validation |
| Affected lines | `src/tools.js:200-213`, `src/envFiles.js:96-105`, `src/envFiles.js:71-93`, `src/fileOps.js:62-70` |

#### Summary

`set_env_var` checks whether the requested key is protected, but it does not validate the value before embedding it into `.env` syntax. A newline in the value can add a protected assignment such as `DB_PASSWORD=attacker`.

#### Validation

Method: targeted Node PoC in `artifacts/05_findings/CAND-37407EF-002/validation_artifacts/poc.mjs`.

Evidence: direct `DB_PASSWORD` edit threw as expected, then a `NORMAL` value containing `\nDB_PASSWORD=attacker` wrote that protected assignment into the file.

Remaining uncertainty: downstream impact depends on which env keys the target app uses and when services reload.

#### Dataflow

MCP `set_env_var.value` -> `setEnvVar()` key-only protected check -> `updateEnvContent()` interpolation -> `writeReadableFileWithBackup()` -> modified env file.

#### Reachability

A connected MCP client can invoke `set_env_var` directly for configured env files. The bypass crosses the protected-key mutation boundary.

#### Severity

Medium. The path changes protected runtime configuration and can redirect credentials or tokens, but it does not directly disclose existing values or immediately prove code execution. Severity would rise if a protected key controls authentication, deployment, or command execution in the managed service.

#### Remediation

Validate env keys against a strict grammar and reject `\r` or `\n` in keys and values, or encode multiline values safely. Add tests for newline, carriage return, and malformed key/value attempts.

### [6] MCP logs tool can read logs from arbitrary Docker containers

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A targeted PoC showed `logs` directly constructs `docker logs` for a non-project name without project validation. |
| Category | Cross-project data exposure |
| CWE | CWE-200 Exposure of Sensitive Information; CWE-284 Improper Access Control |
| Affected lines | `src/tools.js:94-101`, `src/docker.js:26-33`, `src/containers.js:73-76` |

#### Summary

The `logs` tool describes a known compose project container, but the implementation sends the caller-selected name directly to `docker logs`. Unlike `restart` and `exec_in`, it does not call `assertKnownContainer()`.

#### Validation

Method: targeted Node PoC with fake runner in `artifacts/05_findings/CAND-37407EF-004/validation_artifacts/poc.mjs`.

Evidence: the PoC captured `["logs", "--tail", "200", "other-db-1"]` with no preceding `docker compose ps`.

Remaining uncertainty: live Docker proof was not run; actual data sensitivity depends on target logs.

#### Dataflow

MCP `logs.container` -> `tools.js` handler -> `docker.logs()` -> `runner("docker", ["logs", "--tail", tail, container])`.

#### Reachability

A connected MCP client needs a valid or guessable non-project container name or ID. The issue crosses the configured compose project boundary.

#### Severity

Medium. Container logs can contain secrets or sensitive data, but exploitation requires target-name knowledge and impact depends on log content. Severity would rise if non-project containers commonly log credentials.

#### Remediation

Have `logs()` accept `cwd`, call `listProjectContainers()`, and enforce `assertKnownContainer()` before running Docker. Add tests that `logs` rejects unknown containers and performs the compose-project discovery call.

### [7] MCP inspect tool can inspect arbitrary Docker containers or objects

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A targeted PoC showed `inspect` directly constructs `docker inspect` for a non-project name and returns metadata. |
| Category | Cross-project data exposure |
| CWE | CWE-200 Exposure of Sensitive Information; CWE-284 Improper Access Control |
| Affected lines | `src/tools.js:104-110`, `src/docker.js:36-38`, `src/containers.js:73-76` |

#### Summary

The `inspect` tool accepts a caller-supplied target and calls `docker inspect` without project membership validation. This can expose metadata and env variables for Docker objects outside the configured compose project.

#### Validation

Method: targeted Node PoC with fake runner in `artifacts/05_findings/CAND-37407EF-005/validation_artifacts/poc.mjs`.

Evidence: the PoC captured `["inspect", "other-db-1"]` and returned a representative env value from inspect output.

Remaining uncertainty: live Docker proof was not run; attacker needs a valid object name or ID.

#### Dataflow

MCP `inspect.container` -> `tools.js` handler -> `docker.inspect()` -> `runner("docker", ["inspect", container])` -> parsed JSON returned.

#### Reachability

A connected MCP client can invoke the tool directly. The path crosses the Docker compose project boundary when the chosen object is outside the project.

#### Severity

Medium. `docker inspect` often contains environment variables, labels, mounts, networks, and deployment metadata. Severity would rise if non-project containers hold sensitive secrets in inspectable env.

#### Remediation

Validate inspect targets with `assertKnownContainer()` or split object inspection into project-scoped container inspection only. Add tests that unknown containers are rejected before `docker inspect`.

### [8] Lexical path policy does not prevent symlink escape for allowed project paths

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Static evidence shows lexical-only path checks before symlink-following fs sinks; dynamic symlink creation was blocked by Windows `EPERM`. |
| Category | Path traversal / symlink escape |
| CWE | CWE-22 Path Traversal; CWE-59 Link Following |
| Affected lines | `src/pathPolicy.js:34-54`, `src/fileOps.js:45-51`, `src/fileOps.js:67-70`, `src/fileOps.js:82-87` |

#### Summary

The path policy resolves and checks paths lexically under `composeProjectDir`, but it does not verify the real filesystem target. If an allowed project path is a symlink to an outside file, normal Node `fs` operations follow it.

#### Validation

Method: targeted symlink PoC plus static trace in `artifacts/05_findings/CAND-37407EF-003/validation_artifacts/poc.mjs`.

Evidence: local symlink creation failed with `EPERM`, so runtime proof is deferred. Static trace shows no `realpath` or `lstat` before `fs.readFile`, `fs.writeFile`, or `fs.copyFile`.

Remaining uncertainty: whether allowed symlinks exist or can be created in the deployed Linux VM.

#### Dataflow

MCP file path -> `resolveProjectPath()` lexical containment -> allowed relative path -> symlink-following `fs` sink.

#### Reachability

A connected MCP client can choose allowed file paths, but exploitation needs an allowed symlink to already exist or be created outside this code path. This is a follow-up item rather than a fully confirmed deployed exploit.

#### Severity

Medium while deferred. It could become high if reproduced against a symlink to host secrets or security-critical config; it would be suppressed if deployment proves symlinks cannot exist under allowed paths.

#### Remediation

Use `lstat` to reject symlinks for all file operations, or resolve `realpath` for existing source and destination parents and verify containment after symlink resolution. Add Linux tests with an in-project symlink pointing outside the project.

### [9] exec_in permits arbitrary outbound requests from project containers through curl and wget

| Field | Value |
|---|---|
| Severity | low |
| Confidence | high |
| Confidence rationale | A targeted PoC showed arbitrary URLs forwarded to `curl`; project proposal explicitly accepts this dev/stage diagnostic risk. |
| Category | SSRF / accepted diagnostic risk |
| CWE | CWE-918 Server-Side Request Forgery |
| Affected lines | `src/tools.js:135-147`, `src/execIn.js:9-10`, `src/execIn.js:20-28`, `src/execIn.js:30-34` |

#### Summary

`exec_in` allows `curl` and `wget` with unrestricted destination arguments, so a connected MCP client can cause outbound requests from the project container network context. The project proposal explicitly documents this as an accepted dev/stage risk.

#### Validation

Method: targeted Node PoC with fake runner in `artifacts/05_findings/CAND-37407EF-007/validation_artifacts/poc.mjs`.

Evidence: the PoC showed `curl http://169.254.169.254/latest/meta-data/` forwarded to `docker exec`.

Remaining uncertainty: severe impact depends on deployment-specific reachable internal services.

#### Dataflow

MCP `exec_in.argv` -> first binary `curl` accepted -> known container validated -> `docker exec <container> curl <attacker-url>`.

#### Reachability

A connected MCP client can trigger the request once it knows a project container. The request originates from the container network context. This is intentionally useful for diagnostics.

#### Severity

Low as an accepted-risk item in this dev/stage tool. It would rise if this server is used in production, if cloud metadata is reachable, or if operators expect `exec_in` to prevent arbitrary outbound requests.

#### Remediation

If this risk is no longer acceptable, remove `curl` and `wget` from defaults or add destination allowlists and redirect controls. Otherwise document it in deployment guidance and keep it out of production contexts.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Generic file reads | Secret disclosure | Reported | `.env` and `*.env` are readable through raw `read_file`. |
| Env key editing | Protected config bypass | Reported | Newline injection bypasses key-only protected pattern checks. |
| File path policy | Path traversal / symlink | Needs follow-up | Static symlink gap found; deployment symlink proof blocked by Windows `EPERM`. |
| Docker logs | Cross-project disclosure | Reported | Missing `assertKnownContainer()`. |
| Docker inspect | Cross-project disclosure | Reported | Missing `assertKnownContainer()`. |
| `exec_in` read binaries | Secret/file disclosure | Reported | `env`, `cat`, `head`, and `tail` return raw output. |
| `exec_in` network binaries | SSRF / exfiltration | Accepted risk | `curl`/`wget` arbitrary URLs are documented as accepted for dev/stage. |
| Compose file write plus `compose_up` | Docker workload execution | Reported | Writable compose file is applied directly. |
| Writable scripts plus `run_script` | Host command execution | Reported | Default writable and executable allowlists overlap. |
| Command runner | Shell injection | No issue found | `spawn(..., shell:false)` suppresses shell metacharacter injection at this layer. |
| Service-specific compose mutations | Cross-project mutation | No issue found | `compose_up(service)`, `compose_pull(service)`, and `restart(container)` validate known services/containers. |
| MCP transport | Public remote exposure | Not applicable | Stdio-only server; SSH auth/deployment is outside repository code. |

## Open Questions And Follow Up

- Validate CAND-37407EF-003 on the deployed Linux VM: create or locate an allowed-path symlink under `nginx-vhost/` or another readable/writable glob and verify whether file tools follow it outside `composeProjectDir`.
- Decide whether `curl` and `wget` in `exec_in` remain accepted risk for every deployment. If this tool is ever used outside dev/stage, rerun a scoped scan of `src/execIn.js` and deployment docs.
- Review real `config.json` deployments for overbroad `readableGlobs`, `writableGlobs`, `allowedScripts`, and env protected patterns. This scan reviewed repository defaults and examples, not private deployment configs.
