# p4j Roadmap

## v0.1

- Thin `p4j` wrapper around Pi.
- Minimal p4j package layer with prompts, skills, and extension entrypoint.

## v0.2

- Workflow shortcuts: `quick`, `think`, `search`, `plan`, `build`, `review`, `ship`, `local`, `team`, `ulw`.
- Safe local operation stubs: `status`, `active`, `stop-models`.
- Functional role skeletons matching the naming plan.
- `.p4j/` state directory skeleton.

## v0.3

- Add `.p4j/active.json` read-only state shape.
- Make `p4j active` report cwd, model, idle state, pending messages, context usage, and active state file metadata.
- Make `p4j local` report read-only local diagnostics: git, node, npm, tmux, Ollama/cmux process detection, memory, and disk.

## v0.4.0

- Make `p4j stop-models` a dry-run report.
- Detect model/process candidates such as Ollama, cmux, and model-adjacent Node processes without stopping them.
- Keep actual cleanup deferred behind explicit future opt-in.

## v0.4.x Consolidation

- Persist active session metadata automatically when safe.
- Add richer read-only local diagnostics snapshots.
- Add the stop-models safety contract: parsed args, PID-scoped plans, candidate filtering, and no destructive default behavior.
- Keep verification non-destructive; do not run real process-stopping commands while validating p4j.

## v0.5.0

- Add the first explicit behavior boundary for local process control.
- `p4j stop-models` remains dry-run by default.
- `p4j stop-models --apply --pid <pid>` may stop only a selected safe candidate after interactive confirmation.
- Verification must use tests and fake executors, not real user processes.

## Next

- Improve provider/model routing hints.
- Add install/dev UX for using `p4j` outside this checkout.
- Keep Pi core changes minimal and prefer the p4j package layer.

## Deferred

- Full team runtime orchestration.
- Automatic release/tag/publish flows.
- Launchd or broad process-killing automation.
- Provider/model routing matrix.
