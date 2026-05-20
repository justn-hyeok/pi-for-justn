# p4j Usage

p4j is a personal wrapper around Pi. It loads the p4j resource layer, then delegates execution to the existing Pi CLI and TUI.

## Basics

```bash
p4j --help
p4j --version
p4j pi --help
```

Use `p4j pi ...` when you want raw upstream Pi behavior without p4j argument mapping.

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
p4j stop-models
```

`p4j active` reports local session metadata from `.p4j/active.json`.

`p4j local` is read-only except for writing an ignored diagnostics snapshot to `.p4j/local/latest.json`. Its terminal output is a short human-readable summary and includes the JSON snapshot path for detailed inspection.

`p4j stop-models` is dry-run by default. It lists candidate local model-adjacent processes and stops nothing.

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

## Local State

Tracked sample state lives in `.p4j/active.json`. Runtime snapshots under `.p4j/local/` are ignored by git.

Do not store secrets, API keys, provider tokens, or private account identifiers in `.p4j/`.
