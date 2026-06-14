# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Test Setup Must Mirror Production

**Tests that set up state differently than production code don't test production behavior.**

When writing or reviewing tests:
- Use the same repository/helper functions that production code uses to create state.
- Never write ad-hoc SQL or inline state manipulation in tests when a production helper exists.
- If production sets `status = 'abandoned'` via `abandonWorkflowRun()`, tests must use `abandonWorkflowRun()` — not `UPDATE workflow_runs SET state = 'abandoned'`.

The rule: trace how production creates the state under test. If your test setup takes a different path, it tests a different system.

## 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


## 6. Skill Overrides

### `superpowers:finishing-a-development-branch` — NO options menu

**This rule OVERRIDES the skill's default behavior.**

When `finishing-a-development-branch` runs in this project:
- Run tests. If they fail, report and stop.
- If tests pass: print `Implementation complete. Tests passing.` and **stop immediately**.
- **DO NOT** present the 4-option menu (merge / PR / keep / discard).
- **DO NOT** ask any follow-up question.
- **DO NOT** wait for user input about branch disposition.

Branch lifecycle is managed externally by the Loom release pipeline.

## 7. Git Push After Every Change

**After every commit, push immediately. No exceptions.**

- Never wait to be asked.
- `git add` → `git commit` → `git push` is one atomic action.

## 8. Project Documentation — Strata

**This project uses the Strata documentation system via the `strata-local` MCP server, project `vm-mcp`.**

### When looking up information

Before answering a question about this project (architecture, decisions, configuration,
procedures, deployment), **first try to find existing documentation** via the MCP tools:

- `doc_ask` — **start here** for any factual question about the project. Accepts a
  natural-language question and returns a synthesized answer with citations. Use
  `mode: answer` for human-readable responses, `mode: facts` for structured claims
  with confidence levels. This is especially useful **instead of asking the user**
  when you need context you don't have — e.g. "What auth mechanism does this service
  use?", "What was decided about X?", "How is Y configured?" — check Strata first.
- `doc_search` — when you need raw results for further processing (e.g. finding a
  specific document ID before calling `doc_update` or `doc_supersede`)
- `doc_read` — read a specific document in full (level l1, l2, or full)
- `doc_links` — neighbors in the link graph (what relates to what)

This project has its own decisions, configurations, and procedures that are not in
your training data. **Never answer from general knowledge if project documentation
exists** — it takes precedence. If `doc_ask` or `doc_search` returns relevant
results, build your answer on them and cite the IDs of the documents you draw from.

### When documentation is missing or outdated

If during your work you find that required information is missing from the
documentation or is outdated, **do not write documents yourself**. Notify me and
suggest running `/strata:make-doc`.

### When I say `/strata:prepare-doc`

Run the `prepare-doc` skill from the `.claude/plugins/strata/skills/prepare-doc/` folder.
Use this **once at the start of a new project** to bootstrap the Strata dictionaries.
The skill reads manifest files (package.json, docker-compose.yml, etc.) and produces
`.claude/dictionary-suggestions.yaml` — a draft you copy into `docs-repo/meta/dictionaries/`.
Without this step, `/strata:make-doc` will likely fail with unknown tool or project errors.

### When I say `/strata:make-doc`

Run the `make-doc` skill from the `.claude/plugins/strata/skills/make-doc/` folder.
The skill analyzes the current conversation, proposes documentation candidates, and
after my confirmation writes them into the system. The skill never writes without confirmation.
