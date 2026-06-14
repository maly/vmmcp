# Attack Path Analysis: CAND-DIFF-001

Title: Dangling symlink ancestor bypass in new realpath write containment helper

Final policy decision: ignore in final diff because the candidate was fixed during the scan.

## Attack Path Steps

1. A connected MCP client chooses an allowed writable path such as `nginx-vhost/app.conf`.
2. The project contains an existing `nginx-vhost` symlink/junction whose target is outside `composeProjectDir` and currently missing.
3. The intermediate remediation helper calls `realpath()` for the full path and receives `ENOENT`.
4. The incomplete `allowMissingLeaf` branch walks upward to the real project root and treats the path as safe.
5. The write path then reaches backup/mkdir/write preparation instead of rejecting the symlinked ancestor at the policy boundary.

## Attack Path Facts

- Assumptions: attacker is an authenticated MCP client, consistent with the repository threat model.
- In-scope status: file operations are a primary product surface.
- Exposure: stdio over SSH; not public internet-facing.
- Identity: Node process has the SSH user's filesystem permissions inside the configured project and adjacent host permissions granted to that user.
- Cross-boundary behavior: the intermediate code could fail to enforce the realpath boundary for dangling symlink ancestors.
- Vector: authenticated MCP tool call.
- Preconditions: an allowed path component must already be a dangling symlink or junction.
- Attacker input control: attacker controls the MCP file path and write content; symlink creation itself is not exposed by the MCP API.
- Impact surface: filesystem integrity and possible project-boundary escape on platforms that follow dangling symlinks during creation.
- Mitigations in final code: `realPathOrDanglingSymlink()` now `lstat()` checks ENOENT paths and rejects existing symlinks before walking to an ancestor; focused regression covers the path.
- Counterevidence: final code and tests show the candidate no longer reaches write preparation.
- Confidence: high that the final code suppresses this candidate.

## Severity Calibration

Intermediate impact was potentially high because project-boundary file writes are in scope. Likelihood was constrained by the precondition that a dangling symlink/junction already exists under an allowed path and because the MCP API does not create symlinks. The final policy decision is `ignore` for final reporting because the bug no longer exists in the final diff.

## Remaining Uncertainty

The validation uses Windows junction behavior. The final control is platform-generic because it handles `realpath()` `ENOENT` by checking `lstat()` for existing symlink objects before accepting a missing path.
