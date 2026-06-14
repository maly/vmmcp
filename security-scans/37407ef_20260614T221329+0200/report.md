# Security Review: vm-mcp local remediation diff

## Scope

- Target: `D:\servers\tools\vm-mcp`
- Scan mode: local working-tree diff scan against `HEAD`
- Base commit: `37407ef`
- Scan ID: `37407ef_20260614T221329+0200`
- In-scope diff rows: `config.example.json`, `src/config.js`, `src/docker.js`, `src/envFiles.js`, `src/execIn.js`, `src/fileOps.js`, `src/tools.js`
- Context: existing repository threat model copied unchanged to `artifacts/01_context/threat_model.md`
- Validation: focused Node tests plus full `npm test`
- Limitation: no live Docker daemon was used; Docker behavior was validated through the repository's fake runner tests.

### Scan Summary

| Field | Value |
|---|---|
| Reportable findings | 0 |
| Severity mix | none |
| Confidence mix | none |
| Coverage | All 7 `deep_review_input.csv` rows have completion receipts in `artifacts/02_discovery/work_ledger.jsonl` |
| Validation mode | Focused `node:test` regressions and full suite |
| Candidate closure | `CAND-DIFF-001` was discovered during scan and fixed before final reporting |
| Markdown report | `D:\servers\tools\vm-mcp\security-scans\37407ef_20260614T221329+0200\report.md` |
| HTML report | `D:\servers\tools\vm-mcp\security-scans\37407ef_20260614T221329+0200\report.html` |

## Threat Model

`vm-mcp-devtools` is a small Node.js ESM MCP server intended to run on demand over stdio, usually through SSH to a dev or stage VM. It does not expose an HTTP port, OAuth layer, daemon, or tunnel. Its purpose is to give an agent a bounded set of operational tools for one configured Docker Compose project without granting a free interactive shell.

Primary runtime surfaces include Docker Compose inspection and mutation, known service/container discovery, project-scoped file operations, environment file parsing/masking/editing, constrained `docker exec`, allowlisted project scripts, and process execution through `spawn()` with `shell: false`.

Assets and privileges that matter include the SSH identity that launches the MCP server, Docker/Compose access on the VM, the configured `composeProjectDir`, secrets in env files and compose service environments, availability and integrity of the target dev/stage Docker Compose project, and backup integrity under `.mcp-backups`.

Main trust boundaries are MCP client to server, SSH launch boundary, server process to host, host to container, and operator-controlled config to runtime. Attacker-controlled inputs include MCP tool names and arguments, paths, container names, service names, argv arrays, env keys and values, file content, copy destinations, backup IDs, and log tail counts.

Core invariants are: no general shell, file operations stay inside `composeProjectDir` after realpath-sensitive validation, env secrets are masked by supported env reads, protected env keys cannot be edited through supported env mutation, Docker mutations target only the configured compose project where applicable, `exec_in` accepts only allowed binaries inside known project containers, and mutating file operations create backups.

## Findings

| # | Finding | Severity | Confidence | Category |
|---|---|---|---|---|
| - | No findings | - | - | - |

### Confidence Scale

| Label | Meaning |
|---|---|
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; include only when the user explicitly wants follow-up candidates in the final report. |

### No findings

No actionable security finding survived the final diff scan. One candidate, `CAND-DIFF-001`, was discovered during review of the new realpath containment helper: a dangling symlink/junction could make `realpath()` return `ENOENT`, after which the helper accepted an inside ancestor before write preparation. That candidate was validated with a focused failing test, fixed by `lstat()`-checking ENOENT paths for symlinks before ancestor fallback, and revalidated with passing tests. Its candidate ledger contains discovery, validation, and attack-path receipts.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Default config policy | Secret exposure / write-to-execute composition | No issue found | Env files, compose files, and scripts are separated across readable, writable, env-specific, and script policies in final code. |
| Docker logs/inspect helpers | Cross-project Docker data exposure | No issue found | Both helpers validate the target through compose project container discovery before invoking Docker. |
| Env file mutation | Injection / symlink escape | No issue found | Keys are grammar-checked, CR/LF values are rejected, and configured env paths must realpath inside the project. |
| `exec_in` and `run_script` | Secret disclosure / host command execution | No issue found | Raw disclosure binaries were removed; `run_script` rejects scripts writable through MCP policy. `curl` and `wget` remain documented accepted diagnostic risk. |
| File operations realpath containment | Path traversal / symlink escape | Rejected after fix | Candidate `CAND-DIFF-001` found a dangling symlink edge case during this scan; final code rejects dangling symlink ancestors and focused tests pass. |
| MCP tool wiring | Authorization bypass of helper controls | No issue found | `logs` and `inspect` handlers pass configured `cwd`; file/env/script handlers route through hardened helpers. |

## Open Questions And Follow Up

- If deployments intentionally override `readableGlobs`, `writableGlobs`, or `allowedScripts`, run a config-specific review of the private `config.json` files for reintroduced env, compose, or script overlaps.
- If this tool is used outside dev/stage, revisit the accepted diagnostic risk for `curl` and `wget` in `exec_in`.
