# Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Default config policy | Secret exposure / write-to-execute composition | No issue found | Env files, compose files, and scripts are separated across readable, writable, env-specific, and script policies in final code. |
| Docker logs/inspect helpers | Cross-project Docker data exposure | No issue found | Both helpers validate the target through compose project container discovery before invoking Docker. |
| Env file mutation | Injection / symlink escape | No issue found | Keys are grammar-checked, CR/LF values are rejected, and configured env paths must realpath inside the project. |
| `exec_in` and `run_script` | Secret disclosure / host command execution | No issue found | Raw disclosure binaries were removed; `run_script` rejects scripts writable through MCP policy. `curl` and `wget` remain documented accepted diagnostic risk. |
| File operations realpath containment | Path traversal / symlink escape | Rejected after fix | Candidate `CAND-DIFF-001` found a dangling symlink edge case during this scan; final code rejects dangling symlink ancestors and focused tests pass. |
| MCP tool wiring | Authorization bypass of helper controls | No issue found | `logs` and `inspect` handlers pass configured `cwd`; file/env/script handlers route through hardened helpers. |
