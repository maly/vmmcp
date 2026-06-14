# Security Remediation

Source report: `docs/report.md`.

## Finding 1: Generic read_file exposes raw env secrets despite read_env masking

Status: fixed.

Evidence the issue existed:
- `src/config.js` default `readableGlobs` included `.env`, `strata.env`, and `*.env`.
- `src/fileOps.js` `readFileTool()` allowed those paths through `canRead()` and returned raw `fs.readFile()` content.

Fix:
- Removed env-file globs from default and example generic readable file policy.
- Kept configured env-file access inside `read_env` and `set_env_var` by resolving project paths directly and preserving backup creation.
- Kept backup listing/restoration available for configured env files without allowing `read_file` or `copy_file` to expose their raw content.

Changed files:
- `src/config.js`
- `src/envFiles.js`
- `src/fileOps.js`
- `config.example.json`
- `tests/config.test.js`
- `tests/envFiles.test.js`
- `tests/fileOps.test.js`
- `tests/pathPolicy.test.js`

Regression coverage:
- `readFileTool` rejects `.env`, `strata.env`, and `other.env`.
- `copyFileTool` rejects env-file sources.
- `readEnv` still returns masked protected values.
- `setEnvVar` still updates non-protected configured env keys and creates backups.

Commands run:
- `npm test -- tests/fileOps.test.js tests/envFiles.test.js tests/config.test.js` - failed before implementation with the new regression tests, proving raw env reads still reproduced.
- `npm test -- tests/fileOps.test.js tests/envFiles.test.js tests/config.test.js tests/pathPolicy.test.js` - passed after implementation, 38/38.

Result:
- The original vulnerable `read_file(".env")`/`read_file("strata.env")` path no longer reproduces under defaults; the focused regression test now rejects it with `Path is not readable`.

Remaining uncertainty:
- Explicit deployment configs can still choose to add env paths to custom `readableGlobs`; current code blocks defaults and configured env-file workflows, but does not globally classify every possible custom secret filename.

## Finding 2: exec_in allows unmasked container secret and file disclosure through read binaries

Status: fixed.

Evidence the issue existed:
- `src/execIn.js` default `EXEC_BINARIES` included `env`, `cat`, `head`, and `tail`.
- The pre-fix regression test `execIn rejects raw container disclosure binaries` failed because those binaries reached the fake Docker runner.

Fix:
- Removed `env`, `cat`, `head`, and `tail` from the default `EXEC_BINARIES` allowlist.
- Kept existing positive coverage for allowed diagnostic commands such as `curl` and `nginx -t`.

Changed files:
- `src/execIn.js`
- `tests/execIn.test.js`

Regression coverage:
- `execIn` rejects `env`, `cat`, `head`, and `tail` before compose container discovery or `docker exec`.
- Existing tests still verify allowed diagnostics run in known project containers.

Commands run:
- `node --test tests/execIn.test.js` - failed before implementation with the new regression test, proving the disclosure binaries were still allowed.
- `node --test tests/execIn.test.js` - passed after implementation, 6/6.

Result:
- The original vulnerable `exec_in(argv=["env"])`, `exec_in(argv=["cat"])`, `exec_in(argv=["head"])`, and `exec_in(argv=["tail"])` paths no longer reproduce; each is rejected with `exec_in binary is not allowed` before Docker execution.

Remaining uncertainty:
- `grep` remains allowed as a diagnostic binary and can read files when combined with a known path. This remediation followed the report's requested default removal for the direct raw disclosure binaries and did not broaden scope into a full per-binary argument policy.

## Finding 3: Writable docker-compose.yml can be applied with compose_up to run attacker-chosen containers

Status: fixed.

Evidence the issue existed:
- `src/config.js` default `writableGlobs` included `docker-compose.yml`.
- The pre-fix regression test `writeFileTool rejects compose file writes by default` failed because `writeFileTool(config, "docker-compose.yml", ...)` succeeded.

Fix:
- Removed `docker-compose.yml` from default and example `writableGlobs`.
- Kept `docker-compose.yml` in default `readableGlobs` so operators can still inspect compose configuration.
- Updated the README configuration example to match the safer default.

Changed files:
- `src/config.js`
- `config.example.json`
- `README.md`
- `tests/config.test.js`
- `tests/fileOps.test.js`
- `tests/pathPolicy.test.js`

Regression coverage:
- Default config treats `docker-compose.yml` as readable but not writable.
- `writeFileTool` rejects default writes to `docker-compose.yml`.
- Existing read coverage confirms `read_file("docker-compose.yml")` still works.

Commands run:
- `node --test tests/config.test.js tests/fileOps.test.js tests/pathPolicy.test.js` - failed before implementation with the new regression test, proving default compose writes still reproduced.
- `node --test tests/config.test.js tests/fileOps.test.js tests/pathPolicy.test.js` - passed after implementation, 16/16.

Result:
- The original default `write_file(path="docker-compose.yml")` step no longer reproduces, so a connected client cannot use the default file policy to rewrite compose content before calling `compose_up`.

Remaining uncertainty:
- A deployment can still explicitly add `docker-compose.yml` to custom `writableGlobs`. This fix removes the dangerous default overlap but does not add a structured compose mutation policy for intentionally custom writable compose deployments.

## Finding 4: Allowed run_script targets overlap default writable files, enabling host script mutation then execution

Status: fixed.

Evidence the issue existed:
- `src/config.js` default `writableGlobs` included `start` and `update`, and default `allowedScripts` also included `start` and `update`.
- The pre-fix regression test `runScript rejects scripts writable through file policy` failed because a custom overlapping config could write and execute the same script name.

Fix:
- Removed `start` and `update` from default and example `writableGlobs`.
- Kept `start` and `update` readable and allowed as scripts by default.
- Added a `runScript` guard that refuses to run any allowed script if the active MCP write policy can write that script path.
- Updated the README configuration example to match the safer default.

Changed files:
- `src/config.js`
- `src/execIn.js`
- `config.example.json`
- `README.md`
- `tests/config.test.js`
- `tests/execIn.test.js`

Regression coverage:
- Default `writableGlobs` and `allowedScripts` have no exact script-name overlap.
- `runScript` rejects an explicitly overlapping custom config before invoking the runner.
- Existing tests still verify non-writable allowed scripts run without shell expansion.

Commands run:
- `node --test tests/config.test.js tests/execIn.test.js` - failed before implementation with the new overlap tests, proving the issue still reproduced.
- `node --test tests/config.test.js tests/execIn.test.js` - passed after implementation, 11/11.

Result:
- The original write-then-run path no longer reproduces under defaults, and a custom config that makes an allowed script writable is rejected with `Refusing to run script writable through MCP policy`.

Remaining uncertainty:
- The guard checks the configured MCP write policy, not filesystem ownership or script content integrity outside MCP. External host-side script mutation remains outside this repository's control.

## Finding 5: set_env_var newline injection can overwrite protected env keys

Status: fixed.

Evidence the issue existed:
- `src/envFiles.js` checked whether `key` was protected, then interpolated `value` directly into env-file syntax.
- The pre-fix regression test `setEnvVar rejects env syntax injection` failed because `value: "safe\nDB_PASSWORD=attacker"` was accepted.

Fix:
- Added env assignment validation at the `setEnvVar` boundary.
- Env keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Env values containing `\r` or `\n` are rejected before any file read, backup, or write.

Changed files:
- `src/envFiles.js`
- `tests/envFiles.test.js`

Regression coverage:
- `setEnvVar` rejects newline and carriage-return value injection.
- `setEnvVar` rejects malformed keys.
- Existing tests still verify non-protected key updates, appends, masking, protected-key rejection, and backup creation.

Commands run:
- `node --test tests/envFiles.test.js` - failed before implementation with the new injection regression, proving the bypass still reproduced.
- `node --test tests/envFiles.test.js` - passed after implementation, 8/8.

Result:
- The original newline-in-value protected-key overwrite no longer reproduces; injected values are rejected with `Env value must not contain newlines`.

Remaining uncertainty:
- Multiline env values are no longer supported through `set_env_var`. That is intentional for this MCP mutation path; existing multiline values can still be read and masked by `read_env` according to the current parser behavior.

## Finding 6: MCP logs tool can read logs from arbitrary Docker containers

Status: fixed.

Evidence the issue existed:
- `src/docker.js` `logs()` called `docker logs` directly with the caller-provided container.
- The pre-fix regression tests failed because no `docker compose ps --format json` validation happened before `docker logs`, and unknown containers were accepted.

Fix:
- Updated `logs()` to load project containers with `listProjectContainers()` and enforce `assertKnownContainer()` before invoking `docker logs`.
- Passed `cwd` from the MCP tool handler into `logs()` so validation is scoped to the configured compose project.

Changed files:
- `src/docker.js`
- `src/tools.js`
- `tests/docker.test.js`

Regression coverage:
- `logs` validates known project containers before reading logs.
- `logs` rejects unknown containers before `docker logs`.
- Explicit tail values are still passed through for known containers.

Commands run:
- `node --test tests/docker.test.js` - failed before implementation with the new logs validation tests, proving the arbitrary-container path still reproduced.
- `node --test tests/docker.test.js` - passed after implementation, 10/10.

Result:
- The original `logs(container="other-db-1")` path no longer reaches `docker logs`; it is rejected with `Unknown compose container` after only the compose project discovery call.

Remaining uncertainty:
- No live Docker daemon was used; validation used the repository's existing fake runner pattern, which directly verifies the command sequence and authorization boundary.

## Finding 8: Lexical path policy does not prevent symlink escape for allowed project paths

Status: fixed.

Evidence the issue existed:
- `src/pathPolicy.js` performed lexical containment checks, and file sinks in `src/fileOps.js` followed filesystem links.
- The pre-fix regression test `readFileTool rejects symlink escapes from allowed paths` failed because an allowed `nginx-vhost` junction to an outside directory was read successfully.

Fix:
- Added realpath containment checks at file-operation sink boundaries.
- Existing files must resolve inside the real compose project root.
- Missing write destinations validate the nearest existing ancestor's realpath before creating directories or files.
- Applied the same realpath containment to env-specific `read_env` and `set_env_var` file access.

Changed files:
- `src/fileOps.js`
- `src/envFiles.js`
- `tests/fileOps.test.js`
- `tests/envFiles.test.js`

Regression coverage:
- `readFileTool` rejects an allowed `nginx-vhost/*` path that resolves through a junction outside `composeProjectDir`.
- `writeFileTool` rejects an allowed path whose existing ancestor is a dangling junction before reaching backup, mkdir, or write sinks.
- `readEnv` rejects a configured env file that resolves through a junction outside `composeProjectDir`.
- Existing file read/write/copy/delete and env mutation tests still pass.

Commands run:
- `node --test tests/fileOps.test.js` - failed before implementation with the new junction escape regression, proving the path still reproduced.
- `node --test tests/fileOps.test.js` - passed after adding file-operation realpath checks, 8/8.
- `node --test tests/fileOps.test.js tests/envFiles.test.js` - passed after extending checks to env-specific access, 17/17.
- `node --test tests/fileOps.test.js` - failed during final diff-scan review on a dangling-junction edge case before the helper was tightened.
- `node --test tests/fileOps.test.js` - passed after the dangling-junction fix, 9/9.

Result:
- The original symlink/junction escape no longer reproduces; paths resolving outside the real compose project root, including dangling symlink ancestors, are rejected with `Path resolves outside compose project`.

Remaining uncertainty:
- Validation used Windows directory junctions because direct file symlink creation is denied by this environment with `EPERM`. Directory junctions exercise the same Node filesystem-following behavior for path components.

## Finding 9: exec_in permits arbitrary outbound requests from project containers through curl and wget

Status: documented non-actionable accepted risk.

Evidence the issue still exists:
- `src/execIn.js` still includes `curl` and `wget` in `EXEC_BINARIES`.
- `tests/execIn.test.js` still has positive coverage for `execIn` running `curl` inside a known project container.

Reason no code change was made:
- `docs/report.md` classifies this row as low severity and an accepted dev/stage diagnostic risk, not an actionable remediation item.
- Removing `curl`/`wget` would change an intentionally documented diagnostic workflow and was not required by the report unless the deployment risk decision changes.

Changed files:
- None for this finding.

Commands run:
- `node --test tests/execIn.test.js` - passed, 7/7, confirming the accepted diagnostic behavior remains and other `exec_in` controls still pass.

Result:
- The behavior remains present by design and is documented as accepted risk for dev/stage usage.

Remaining uncertainty:
- If this tool is used outside dev/stage, or if cloud metadata/internal services are reachable from project containers, this risk decision should be revisited and `curl`/`wget` should be removed or constrained with destination policy.

## Final Verification

Status: complete.

Commands run:
- `npm test` - passed, 46/46 before final diff-scan.
- `node --test tests/fileOps.test.js` - failed during final diff-scan review on the dangling symlink ancestor candidate, then passed 9/9 after the fix.
- `python C:\Users\martin\.codex\plugins\cache\openai-curated\codex-security\c6ea566d\scripts\validate_report_format.py --report-md D:\servers\tools\vm-mcp\security-scans\37407ef_20260614T221329+0200\report.md` - passed.
- `python C:\Users\martin\.codex\plugins\cache\openai-curated\codex-security\c6ea566d\scripts\render_report_html.py --template C:\Users\martin\.codex\plugins\cache\openai-curated\codex-security\c6ea566d\assets\report_template_inlined.html --report-md D:\servers\tools\vm-mcp\security-scans\37407ef_20260614T221329+0200\report.md --report-html D:\servers\tools\vm-mcp\security-scans\37407ef_20260614T221329+0200\report.html --title "vm-mcp Codex Security Scan"` - passed.
- `npm test` - passed, 47/47 after final diff-scan remediation.

Final security diff scan:
- Report: `security-scans/37407ef_20260614T221329+0200/report.md`
- HTML: `security-scans/37407ef_20260614T221329+0200/report.html`
- Result: no surviving actionable findings.
- Note: the standard `C:\tmp\codex-security-scans\vm-mcp` scan output path was not writable in this sandbox, so the final diff-scan bundle was written under the repository workspace.

## Finding 7: MCP inspect tool can inspect arbitrary Docker containers or objects

Status: fixed.

Evidence the issue existed:
- `src/docker.js` `inspect()` called `docker inspect` directly with the caller-provided target.
- The pre-fix regression tests failed because no project container validation happened before `docker inspect`, and unknown containers were accepted.

Fix:
- Updated `inspect()` to load project containers with `listProjectContainers()` and enforce `assertKnownContainer()` before invoking `docker inspect`.
- Passed `cwd` from the MCP tool handler into `inspect()` so validation is scoped to the configured compose project.

Changed files:
- `src/docker.js`
- `src/tools.js`
- `tests/docker.test.js`

Regression coverage:
- `inspect` validates known project containers before Docker inspection.
- `inspect` rejects unknown containers before `docker inspect`.

Commands run:
- `node --test tests/docker.test.js` - failed before implementation with the new inspect validation tests, proving the arbitrary-target path still reproduced.
- `node --test tests/docker.test.js` - passed after implementation, 11/11.

Result:
- The original `inspect(container="other-db-1")` path no longer reaches `docker inspect`; it is rejected with `Unknown compose container` after only the compose project discovery call.

Remaining uncertainty:
- No live Docker daemon was used; validation used the repository's existing fake runner pattern, which directly verifies the command sequence and authorization boundary.
