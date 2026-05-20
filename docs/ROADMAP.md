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

## v0.4

- Make `p4j stop-models` a dry-run report.
- Detect model/process candidates such as Ollama, cmux, and model-adjacent Node processes without stopping them.
- Keep actual cleanup deferred behind explicit future opt-in.

## Next

- Persist active session updates automatically when safe.
- Add richer local diagnostics snapshots.
- Add explicit opt-in cleanup for models/processes after safety review.
- Keep Pi core changes minimal and prefer the p4j package layer.

## Deferred

- Full team runtime orchestration.
- Automatic release/tag/publish flows.
- Launchd or process-killing automation without explicit approval.
- Provider/model routing matrix.
