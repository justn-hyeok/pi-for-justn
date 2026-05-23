# p4j Usage

p4j is a personal wrapper around Pi. It loads the p4j resource layer, then delegates execution to the existing Pi CLI and TUI.

## Basics

```bash
p4j --help
p4j --version
p4j pi --help
```

Use `p4j pi ...` when you want raw upstream Pi behavior without p4j argument mapping.

`p4j --help` and `p4j --version` are handled before preflight, so they work from any cwd even in linked checkouts.

For linked checkout usage:

```bash
npm install
npm run build --workspace packages/p4j
npm link --workspace packages/p4j
```

The linked `p4j` binary resolves Pi and the p4j resource layer from the package location, not from the current working directory, so it can be run from other directories after linking.
`p4j --help` also prints the linked-usage guidance from that binary without needing the working directory to match the repo.

## Workflow Shortcuts

```bash
p4j quick "small bounded task"
p4j think "topic to analyze"
p4j search "local-first query"
p4j plan "goal"
p4j build "implementation task"
p4j review "target"
p4j ship "release target"
p4j team "coordination goal"
p4j ulw "bounded end-to-end task"
```

These map to p4j prompt templates loaded from the `p4j/prompts` resource layer.

## Local Commands

```bash
p4j status
p4j active
p4j local
p4j hints
p4j stop-models
```

Inside the TUI, `/p4j:agents` shows the p4j agent roster and `/p4j:route <request>` recommends agents for a task. The initial roster uses direct names: `orchestrator`, `hardworker`, `planner`, `searcher`, `researcher`, `builder`, `debugger`, `reviewer`, `designer`, `shipper`, `adviser`, `checker`, plus focused `*-son` helpers.

`p4j active` reports ignored runtime session metadata from `.p4j/local/active.json`.

`p4j local` is read-only except for writing an ignored diagnostics snapshot to `.p4j/local/latest.json`. Its terminal output is a short human-readable summary, separates likely model processes from noisy local matches, and includes the JSON snapshot path for detailed inspection.

`p4j hints` is manual-only. It reports lightweight provider/model next steps from the current Pi model registry and suggests `/login`, `/model`, `p4j --list-models`, and explicit `p4j --provider <provider> --model <model>` invocations without changing model selection.
`p4j stop-models` is dry-run by default. It lists candidate local model-adjacent processes and stops nothing. Dry-run output separates likely candidates from noisy/local matches.

## Explicit Stop Boundary

```bash
p4j stop-models --apply --pid <pid>
```

This is the only process-control path. It requires all of the following:

- `--apply`
- `--pid <pid>`
- a current stop-models candidate matching that PID
- interactive confirmation
- a final PID and command revalidation immediately before apply

Do not use `--apply` unless you intend to send `SIGTERM` to exactly that candidate PID.

## Provider And Model Setup

Use Pi's existing provider/model system:

```bash
p4j --list-models
p4j --provider openai --model gpt-4o
```

Inside interactive Pi, use `/login` to add credentials and `/model` to choose a model. See `packages/coding-agent/docs/providers.md` and `packages/coding-agent/docs/models.md` for upstream provider/model details.

## Local State

Tracked sample state lives in `.p4j/active.json`. Runtime active metadata and diagnostics snapshots under `.p4j/local/` are ignored by git.

Do not store secrets, API keys, provider tokens, or private account identifiers in `.p4j/`.
