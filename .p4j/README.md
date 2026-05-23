# .p4j

Tracked p4j sample state lives here. Runtime state lives under ignored `.p4j/local/` files.

Current status: v0.8.1 active/local diagnostics, noisy-process separation, linked wrapper guidance, manual-only provider/model hints, and confirmed PID-scoped `stop-models --apply`. Do not store secrets, API keys, provider tokens, or private account identifiers here.

Current safe state:

- tracked sample active metadata in `active.json`
- runtime active metadata and local diagnostics snapshots in ignored files such as `local/active.json` and `local/latest.json`
- readable local summaries from `p4j local`
- likely/noisy process separation in local stop-model reports
- manual-only provider/model guidance from `p4j hints`
- cleanup plans before execution
- lightweight workflow notes

`p4j stop-models` is dry-run by default. `p4j stop-models --apply --pid <pid>` must remain explicit, PID-scoped, and interactively confirmed.
