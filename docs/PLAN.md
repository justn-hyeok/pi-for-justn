# p4j Plan

Working name: p4j
Expanded name: pi-for-justn
Base: Pi Coding Agent fork

## Goal

Build a personal Pi-based agent harness for Justn. p4j should borrow the proven patterns from OmO, OMP, OMC, OMX, and omo-slim, but rename and reshape them into a simpler, more direct workflow.

p4j is not a clone of any single project. It is a Pi fork with a personal operating layer: lean by default, explicit power modes, local cleanup as a first-class feature, and short reports.

## Principles

- Use clear functional names instead of mythological names.
- Keep the default path light and fast.
- Make strong modes explicit: `p4j ulw`, `p4j search`, `p4j team`.
- Treat local operations as core: Ollama, cmux, @active, memory pressure, launchd, and processes.
- Prefer short status updates and concrete verification over long explanations.
- Preserve upstream Pi as much as possible; isolate p4j-specific changes.
- Finish work, but stay lean.

## Naming

Project/repo: `pi-for-justn`
CLI/brand: `p4j`
State directory: `.p4j/`

Agent names should be functional:

- `lead`: orchestrator
- `planner`: planning and scope
- `builder`: implementation
- `researcher`: external docs and GitHub research
- `scout`: local codebase search
- `reviewer`: review and verification
- `local`: local system operations
- `release`: git, CI, tags, releases, smoke tests
- `designer`: UI/UX work
- `debugger`: hard bugs and architecture tradeoffs

Avoid names that require memorizing a mythology or lore layer.

## Reference Projects

- OmO / oh-my-openagent: orchestration philosophy, categories, ultrawork, team mode, hooks, skills.
- OMP / oh-my-pi: Pi harness optimization, hash-anchored edits, LSP/DAP/tool quality.
- OMC / oh-my-claudecode: team-first workflow, staged pipelines, HUD/tmux worker UX.
- OMX / oh-my-codex: durable `.omx/` state, deep-interview -> plan -> team/ralph workflow.
- omo-slim: lower-token orchestration, lightweight defaults, background specialists.

## Initial Architecture

Keep p4j changes in a clearly separated layer where possible.

```text
pi-for-justn/
  packages/
    coding-agent/          # Pi fork base
  p4j/
    extensions/
    agents/
    skills/
    commands/
    prompts/
    themes/
    presets/
  docs/
    PLAN.md
    ROADMAP.md
    NAMING.md
```

If the Pi package system supports external package loading cleanly, prefer a package-style p4j layer over invasive fork changes. Fork changes should be reserved for entrypoint, branding, and integration points that cannot be implemented as extensions.

## Modes

Initial modes:

- `quick`: fast, minimal context, no over-orchestration.
- `think`: analysis before action.
- `search`: broad search, but bounded and summarized.
- `plan`: plan-first workflow.
- `build`: implementation.
- `review`: verification and critique.
- `ship`: release, tag, CI, smoke test.
- `local`: local system cleanup and diagnostics.
- `ulw`: finish the job, stay lean.

`ulw` should not mean unlimited search. It means complete the requested work with appropriate investigation, verification, and cleanup.

## MVP v0.1 Scope

1. Fork Pi and establish the `pi-for-justn` repo.
2. Add a `p4j` entrypoint or alias path without breaking the original Pi CLI.
3. Add initial docs: plan, naming, roadmap.
4. Add a minimal p4j package/layer skeleton.
5. Add local operations commands or extension stubs:
   - status
   - local
   - stop-models
   - active
6. Add initial functional agent definitions:
   - lead
   - planner
   - researcher
   - scout
   - local
   - reviewer

## Deferred

- Full team mode.
- Deep release automation.
- Hook-heavy notification systems.
- Large model routing matrix.
- Any invasive rewrite of Pi internals.

## Acceptance Criteria

- GitHub fork of `earendil-works/pi` exists under the user account.
- Local clone exists at `/Users/justn/Workspaces/pi-for-justn`.
- `origin` points to the fork and `upstream` points to `earendil-works/pi`.
- This plan exists in the cloned repo under `docs/PLAN.md`.
- Basic repo sanity commands succeed: current branch, remotes, recent log, package metadata visible.
- No commit is created unless explicitly requested.
