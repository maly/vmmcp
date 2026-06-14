# Validation Report: CAND-DIFF-001

Title: Dangling symlink ancestor bypass in new realpath write containment helper

## Rubric

- [x] Attacker-controlled input is an MCP file path accepted by `write_file`.
- [x] The path is allowed lexically by `writableGlobs`.
- [x] An existing dangling symlink/junction ancestor causes `realpath()` to return `ENOENT`.
- [x] The vulnerable pre-fix code reached filesystem write preparation without policy rejection.
- [x] The final code rejects the path before backup, mkdir, or write sinks.

## Validation Method

Focused Node regression test using the repository's existing `node:test` harness.

## Evidence

Pre-fix command:

`node --test tests/fileOps.test.js`

Result: failed on `writeFileTool rejects dangling symlink ancestors`; the rejection was an `ENOENT` from `mkdir`, not a policy rejection. This showed the helper had not rejected the dangling junction before reaching write preparation.

Post-fix command:

`node --test tests/fileOps.test.js`

Result: passed, 9/9. The same regression now rejects with `Path resolves outside compose project`.

## Disposition

Suppressed/fixed in final diff. The candidate was valid against the intermediate remediation code, then fixed before final reporting.

## Remaining Uncertainty

The regression uses Windows directory junctions because direct file symlink creation requires privileges in this environment. Junctions are sufficient for the tested path-component escape, and the final helper rejects dangling symbolic links discovered via `lstat()` when `realpath()` returns `ENOENT`.
