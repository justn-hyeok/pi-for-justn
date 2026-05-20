# .p4j

Local state for p4j lives here.

Current status: v0.5 active/local diagnostics plus confirmed PID-scoped `stop-models --apply`. Do not store secrets, API keys, provider tokens, or private account identifiers here.

Current safe state:

- active session metadata in `active.json`
- local diagnostics snapshots in ignored runtime files such as `local/latest.json`
- cleanup plans before execution
- lightweight workflow notes

`p4j stop-models` is dry-run by default. `p4j stop-models --apply --pid <pid>` must remain explicit, PID-scoped, and interactively confirmed.
