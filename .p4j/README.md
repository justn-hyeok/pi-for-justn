# .p4j

Local state for p4j lives here.

Current status: v0.8 active/local diagnostics, noisy-process separation, linked wrapper guidance, provider/model hints, and confirmed PID-scoped `stop-models --apply`. Do not store secrets, API keys, provider tokens, or private account identifiers here.

Current safe state:

- active session metadata in `active.json`
- local diagnostics snapshots in ignored runtime files such as `local/latest.json`
- readable local summaries from `p4j local`
- likely/noisy process separation in local stop-model reports
- provider/model guidance from `p4j hints`
- cleanup plans before execution
- lightweight workflow notes

`p4j stop-models` is dry-run by default. `p4j stop-models --apply --pid <pid>` must remain explicit, PID-scoped, and interactively confirmed.
