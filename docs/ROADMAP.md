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

## v0.5.1

- Revalidate the selected PID immediately before apply.
- Refuse apply if the PID disappears or its command changes after confirmation.

## v0.6.0

- Add user-facing p4j usage documentation.
- Make `p4j local` print a readable summary and the JSON snapshot path.
- Keep local diagnostics read-only except for ignored `.p4j/local/latest.json` snapshots.

## v0.6.1

- Separate likely model processes from noisy/local process matches in `p4j local` and `p4j stop-models` dry-run output.
- Keep classification informational so the existing explicit `--apply --pid` safety boundary remains unchanged.

## v0.7.0

- Improve linked checkout usage with `npm link --workspace packages/p4j` guidance.
- Resolve wrapper paths from the installed package location instead of the caller's current working directory.
- Make preflight failures explain missing dependencies, build output, and link setup steps.

## v0.8.0

- Add `p4j hints` for lightweight provider/model setup guidance.
- Surface `/login`, `/model`, `p4j --list-models`, and explicit `--provider/--model` next steps without changing Pi model selection.
- Keep provider/model routing in Pi core; p4j only reports hints from the current registry.

## Next

- Exercise p4j in more real terminal sessions.
- Decide whether `p4j hints` should appear in startup status or remain manual-only.
- Keep Pi core changes minimal and prefer the p4j package layer.

## Deferred

- Full team runtime orchestration.
- Automatic release/tag/publish flows.
- Launchd or broad process-killing automation.
- Provider/model routing matrix.
