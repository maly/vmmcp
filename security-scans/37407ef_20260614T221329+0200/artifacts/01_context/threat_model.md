# VM MCP Devtools Repository Threat Model

## Overview

`vm-mcp-devtools` is a small Node.js ESM MCP server intended to run on demand over stdio, usually through SSH to a dev or stage VM. It does not expose an HTTP port, OAuth layer, daemon, or tunnel. Its purpose is to give an agent a bounded set of operational tools for one configured Docker Compose project without granting a free interactive shell.

The primary runtime entrypoint is `src/server.js`, which loads `config.json` or a `--config` path and registers MCP tools from `src/tools.js`. The important product surfaces are:

- Docker Compose inspection and mutation through `src/docker.js`.
- Known service/container discovery through `src/containers.js`.
- Project-scoped file read/write/copy/delete/restore through `src/fileOps.js` and `src/pathPolicy.js`.
- Environment file parsing, masking, and key-level updates through `src/envFiles.js`.
- Constrained `docker exec` and allowlisted project scripts through `src/execIn.js`.
- Process execution through `src/commandRunner.js`, which uses `spawn()` with `shell: false`.

The repository documentation states the intended deployment model: a dedicated SSH key, preferably constrained in `authorized_keys` with a forced command that can only start this MCP server. The MCP server then becomes the effective authorization layer for Docker, file, env, and diagnostic operations. Project documentation in Strata also records broader infrastructure assumptions for adjacent MCP/OIDC/Keycloak systems, including HTTPS, proxy trust, token handling, SQLite indexes, and Keycloak dependency boundaries. Relevant cited Strata IDs include `konfigurace-https-pro-fastify-admin-api-a-mcp-6b26`, `konfigurace-oidc-provider-v-mcp-server-strata-s-b814`, `rozhodnuti-sloucit-mcp-transport-z-node-js-http-336c`, and `rozhodnuti-pouzit-sqlite-jako-indexovaci-vrstvu-55b8`; this repository itself is the SSH/stdio VM devtools server, not that Fastify/OIDC server.

## Threat Model, Trust Boundaries, and Assumptions

Assets and privileges that matter:

- Access to the SSH identity that launches the MCP server. If the key is not constrained with `authorized_keys command=...`, compromise can become broader host shell access outside this repository's controls.
- Access to Docker and Docker Compose on the VM. Documentation explicitly notes Docker socket access is strong host privilege, approximately root-equivalent in many deployments.
- The configured `composeProjectDir`, including deployable configuration files, nginx virtual host files, start/update scripts, and `.env`-style files.
- Secrets in env files and compose service environments. The server should mask protected values on reads and should refuse protected-key edits.
- Availability and integrity of the target dev/stage Docker Compose project. Mutating tools can restart, pull, up/down, edit config, and delete allowed files.
- Backup integrity under `.mcp-backups`, because rollback is the primary mitigation for file mutations.

Main trust boundaries:

- MCP client to server boundary: every MCP tool request is untrusted input from a client that may be automated, mistaken, or compromised. Tool schemas are not enough; handlers must validate paths, services, containers, argv, env keys, and script names.
- SSH boundary: SSH authenticates the remote launch. The repository assumes deployment uses a dedicated key and optionally a forced command. Without that deployment control, this repository cannot prevent the same credential from opening a shell.
- Server process to host boundary: the Node process runs with the OS permissions of the SSH user and can invoke Docker. Repository checks must prevent arbitrary host file access or arbitrary command execution despite those process privileges.
- Host to container boundary: `exec_in` crosses into a selected compose container. Container selection must be limited to the configured compose project, and argv must not provide a shell escape.
- Config operator to runtime boundary: `config.json` is operator-controlled and security-critical. Overbroad `readableGlobs`, `writableGlobs`, `envFiles`, `envProtectedPatterns`, or `allowedScripts` can intentionally or accidentally expand access.

Attacker-controlled inputs:

- MCP tool names and arguments, including paths, container names, service names, argv arrays, env keys and values, file content, copy destinations, backup IDs, and log tail counts.
- Docker/Compose output consumed by the server when discovering containers or parsing compose config. In normal deployment this is local trusted-ish infrastructure state, but container names, labels, and environment values may originate from project configuration.
- File content in allowed project files and env files, including malformed env syntax and large files.

Operator-controlled inputs:

- The config file path, `composeProjectDir`, allow/deny globs, env file list, protected key patterns, and allowed script list.
- The target VM's SSH configuration and forced-command setup.
- Docker Compose project content and container/service names.

Developer-controlled inputs:

- Source code, tests, package lockfile, and deployment documentation in this repository.

Core invariants:

- No MCP tool should expose a general shell or allow command string interpretation.
- File operations must stay inside `composeProjectDir` after normalization, then enforce deny globs and allow globs.
- `.env`-style secrets must not be disclosed through `read_env` when their keys match protected patterns.
- Whole-file writes to env files should remain blocked; only `set_env_var` may edit non-protected keys in configured env files.
- Docker mutations must target only known services or containers from the configured compose project where applicable.
- `exec_in` must accept only an argv array with an allowlisted binary and a known project container.
- Mutating file operations should create backups before changing existing files.
- MCP errors should be specific enough for a caller to choose a safer next action, without leaking secrets.

## Attack Surface, Mitigations, and Attacker Stories

Command execution and Docker control:

- The most important attack class is escaping from bounded tools into arbitrary host command execution. `src/commandRunner.js` mitigates shell injection by using `spawn(file, args, { shell: false })`. `src/docker.js` and `src/execIn.js` pass fixed binaries and argv arrays rather than shell strings.
- Docker remains a high-privilege boundary. Even fixed Docker commands can affect availability and deployment integrity. `compose_up`, `compose_pull`, `compose_down`, and `restart` are intentionally destructive tools, so their safety depends on project scoping and caller authorization.
- `run_script` executes an allowlisted file from `composeProjectDir` without shell expansion. If an operator allowlists a writable script or the script itself is unsafe, this can become powerful code execution by design. Review should focus on whether script names, paths, and write permissions compose into an escalation.

Path and file access:

- `src/pathPolicy.js` resolves paths against `config.composeProjectDir`, rejects traversal outside root, converts paths to a POSIX-like relative form, checks `denyGlobs`, then checks read/write globs.
- File mutation tools in `src/fileOps.js` use the path policy and create backups for existing destinations before overwrite, delete, copy-over-destination, or env edits.
- Sensitive key files are denied by default through `.ssh/*`, `**/id_rsa*`, and `**/id_ed25519*`. Review should consider symlink behavior and Windows/path edge cases, because policy validates lexical resolved paths but file operations follow normal filesystem semantics.
- Backup storage under `.mcp-backups` lives inside `composeProjectDir`. If globs accidentally allow backup paths, backups may expose previous secret-bearing content or allow rollback confusion.

Environment handling and secret masking:

- `read_env` reads configured env files and optional compose service environment, then masks values whose keys match protected patterns.
- `set_env_var` refuses protected keys and only allows configured env files.
- Relevant risks are incomplete protected patterns, non-standard env syntax, case sensitivity expectations, secrets stored under unprotected names, and returned unmasked values from Docker Compose environment keys that do not match configured patterns.

Container and service scoping:

- `src/containers.js` discovers project containers using `docker compose ps --format json` and labels where present. It filters rows with compose project labels that do not match `path.basename(cwd)`.
- If labels are absent, all rows from `docker compose ps` are treated as project rows. This may be acceptable for Compose's working-directory-scoped command, but review should check whether Docker output or wrapper behavior can include unrelated containers without labels.
- `logs` and `inspect` take container names directly and currently do not validate against known project containers. They are read-only but can disclose metadata, env, mounts, labels, networking, or logs for any container the process can inspect if the Docker CLI accepts the name.

Realistic attacker stories:

- A compromised or malicious MCP client tries path traversal such as `../.ssh/id_ed25519`, absolute host paths, or deny-glob bypasses to read or overwrite host files.
- A caller attempts to run `exec_in` with `sh -c`, `bash`, shell metacharacters, or a binary not in `EXEC_BINARIES`.
- A caller uses `logs` or `inspect` on a non-project container to read secrets or metadata.
- A caller modifies a writable config file or allowed script, then invokes `restart` or `run_script` to change service behavior.
- A caller reads env files through `read_file` rather than `read_env` if globs allow `.env` or another secret-bearing env file. The documented model says `.env` is readable through masked `read_env`; direct file reads of env files should be treated carefully.
- A misconfigured operator sets broad globs such as `**/*` or allowlists sensitive scripts, turning this from a narrow devtools server into a broad VM file and command interface.

Less realistic or out-of-scope stories:

- Remote unauthenticated network attacks against this server are out of scope under the documented stdio-over-SSH deployment because it opens no port.
- Browser-origin attacks such as CSRF/XSS are not primary for this repository because there is no web UI.
- OAuth, bearer-token, and Keycloak vulnerabilities are relevant to adjacent Strata-documented MCP systems but not to this repository's actual stdio server unless this code is later wrapped in an HTTP/auth layer.
- Container breakout through Docker itself is mostly outside this repository; the repository can limit exposed Docker operations but cannot make Docker socket access low privilege.

## Severity Calibration (Critical, High, Medium, Low)

Critical:

- Arbitrary host command execution through MCP arguments, command string construction, script path traversal, or bypass of the `run_script` allowlist.
- Arbitrary host file read/write outside `composeProjectDir`, especially SSH keys, Docker socket files, cloud credentials, or system service files.
- A flaw that allows mutation of arbitrary Docker containers/images or execution in arbitrary host contexts beyond the configured compose project.

High:

- `inspect`, `logs`, `exec_in`, `restart`, `compose_up`, or `compose_pull` can target containers or services outside the configured compose project in a way that discloses secrets, changes availability, or changes deployment state.
- Secret disclosure through `read_env`, direct `read_file` access to env files, backup paths, Docker inspect output, or insufficient protected-key matching.
- A writable allowed file can be used with `run_script` or Docker restart paths to reliably execute attacker-controlled code inside privileged deployment flows.
- Backup/restore behavior can overwrite unexpected paths or restore attacker-selected content across policy boundaries.

Medium:

- Denial of service against the target dev/stage project through allowed destructive operations that are broader than intended but still scoped to the compose project.
- Path policy edge cases that expose non-secret project files or allow overwrite/delete of files within the intended project but outside the operator's intended allowlist.
- Env parsing or editing corrupts configuration, drops comments/formatting in a security-relevant way, or fails to mask unusual but predictable secret key names.
- Excessive log or file reads leak operational data from the intended project but not credentials or cross-project data.

Low:

- Error messages disclose non-sensitive project structure, denied path names, or command names.
- Malformed Docker or env output causes tool failures without crossing a privilege or confidentiality boundary.
- Test-only, docs-only, or local development issues that do not affect the deployed SSH stdio server or the project-scoped runtime controls.
