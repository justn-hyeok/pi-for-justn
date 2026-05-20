# .p4j

Local state for p4j lives here.

Current status: v0.3 read-only active/local diagnostics. Do not store secrets, API keys, provider tokens, or private account identifiers here.

Current safe state:

- active session metadata in `active.json`
- local diagnostics snapshots after explicit implementation
- cleanup plans before execution
- lightweight workflow notes

Destructive local operations must remain explicit opt-in.
