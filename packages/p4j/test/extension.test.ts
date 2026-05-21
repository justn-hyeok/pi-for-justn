import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildActiveState,
	buildLocalDiagnosticsSnapshot,
	formatRoutingHints,
	getLocalReport,
	getStopModelsDryRun,
	parseStopModelsArgs,
	parseStopModelsCandidates,
	persistActiveState,
	runStopModelsRequest,
} from "../../../p4j/extensions/index.js";

function createContext(cwd: string, confirmed = false): ExtensionCommandContext {
	return {
		cwd,
		hasUI: true,
		model: { provider: "test-provider", id: "test-model" },
		signal: undefined,
		ui: {
			confirm: async () => confirmed,
			notify: () => undefined,
			setStatus: () => undefined,
			getTheme: () => undefined,
			setTheme: () => ({ success: true }),
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		getContextUsage: () => ({ percent: 12, tokens: 345, contextWindow: 1000 }),
	} as unknown as ExtensionCommandContext;
}

type RoutingModel = { provider: string; id: string };

function stopCandidate(pattern: string, pid: number, command: string, classification: "likely" | "noisy" = "likely") {
	return { pattern, pid, command, classification };
}

function createRoutingContext(
	cwd: string,
	options: {
		allModels: RoutingModel[];
		availableModels?: RoutingModel[];
		model?: RoutingModel;
		authenticatedModels?: RoutingModel[];
		providerNames?: Record<string, string>;
	},
): ExtensionContext {
	const authenticatedModels = new Set(
		(options.authenticatedModels ?? []).map((model) => `${model.provider}/${model.id}`),
	);
	const availableModels =
		options.availableModels ??
		options.allModels.filter((model) => authenticatedModels.has(`${model.provider}/${model.id}`));
	const providerNames = options.providerNames ?? {};
	return {
		...(createContext(cwd) as ExtensionContext),
		model: options.model,
		modelRegistry: {
			getAll: () => options.allModels,
			getAvailable: () => availableModels,
			hasConfiguredAuth: (model: RoutingModel) => authenticatedModels.has(`${model.provider}/${model.id}`),
			getProviderDisplayName: (provider: string) => providerNames[provider] ?? provider,
		},
	} as unknown as ExtensionContext;
}

test("builds and persists active state without prompt or credential content", () => {
	const cwd = mkdtempSync(join(tmpdir(), "p4j-active-"));
	const ctx = createContext(cwd) as ExtensionContext;
	const state = buildActiveState(ctx, "agent_start", "running");
	assert.equal(state.version, "0.8.1");
	assert.equal(state.status, "running");
	assert.equal(state.model, "test-provider/test-model");
	assert.equal(state.context, "12%/345");

	persistActiveState(ctx, "agent_start", "running");
	const saved = readFileSync(join(cwd, ".p4j", "active.json"), "utf8");
	assert.match(saved, /"event": "agent_start"/);
	assert.doesNotMatch(saved, /api/i);
	assert.doesNotMatch(saved, /token/i);
});

test("formats routing hints when no models are loaded", () => {
	const hints = formatRoutingHints(
		createRoutingContext("/tmp/p4j", {
			allModels: [],
			model: undefined,
		}),
	);
	assert.match(hints, /p4j routing hints/);
	assert.match(hints, /current model: none/);
	assert.match(hints, /usable models: 0\/0/);
	assert.match(hints, /p4j --list-models/);
	assert.match(hints, /docs: packages\/coding-agent\/docs\/providers\.md, packages\/coding-agent\/docs\/models\.md/);
});

test("formats routing hints when models exist but none is selected", () => {
	const hints = formatRoutingHints(
		createRoutingContext("/tmp/p4j", {
			allModels: [
				{ provider: "anthropic", id: "claude-sonnet-4-0" },
				{ provider: "openai", id: "gpt-4.1" },
			],
			availableModels: [{ provider: "anthropic", id: "claude-sonnet-4-0" }],
			model: undefined,
			providerNames: {
				anthropic: "Anthropic",
				openai: "OpenAI",
			},
		}),
	);
	assert.match(hints, /current model: none/);
	assert.match(hints, /usable models: 1\/2/);
	assert.match(hints, /next: \/model/);
	assert.match(hints, /try: Anthropic -> p4j --provider anthropic --model claude-sonnet-4-0/);
	assert.match(hints, /next: p4j --list-models/);
});

test("formats routing hints when Pi reports an unknown placeholder model", () => {
	const hints = formatRoutingHints(
		createRoutingContext("/tmp/p4j", {
			allModels: [{ provider: "anthropic", id: "claude-sonnet-4-0" }],
			model: { provider: "unknown", id: "unknown" },
			providerNames: { anthropic: "Anthropic" },
		}),
	);
	assert.match(hints, /current model: none/);
	assert.match(hints, /next: \/model/);
	assert.match(hints, /try: Anthropic -> p4j --provider anthropic --model claude-sonnet-4-0/);
	assert.doesNotMatch(hints, /p4j --provider unknown --model unknown/);
});

test("formats routing hints for a selected model without auth", () => {
	const hints = formatRoutingHints(
		createRoutingContext("/tmp/p4j", {
			allModels: [{ provider: "anthropic", id: "claude-sonnet-4-0" }],
			model: { provider: "anthropic", id: "claude-sonnet-4-0" },
			providerNames: { anthropic: "Anthropic" },
		}),
	);
	assert.match(hints, /selected: Anthropic needs login for anthropic\/claude-sonnet-4-0/);
	assert.match(hints, /next: \/login/);
	assert.match(hints, /cli: p4j --provider anthropic --model claude-sonnet-4-0/);
	assert.match(hints, /docs: packages\/coding-agent\/docs\/providers\.md, packages\/coding-agent\/docs\/models\.md/);
});

test("formats routing hints for a selected usable model", () => {
	const hints = formatRoutingHints(
		createRoutingContext("/tmp/p4j", {
			allModels: [
				{ provider: "anthropic", id: "claude-sonnet-4-0" },
				{ provider: "openai", id: "gpt-4.1" },
			],
			availableModels: [
				{ provider: "anthropic", id: "claude-sonnet-4-0" },
				{ provider: "openai", id: "gpt-4.1" },
			],
			model: { provider: "anthropic", id: "claude-sonnet-4-0" },
			authenticatedModels: [
				{ provider: "anthropic", id: "claude-sonnet-4-0" },
				{ provider: "openai", id: "gpt-4.1" },
			],
			providerNames: {
				anthropic: "Anthropic",
				openai: "OpenAI",
			},
		}),
	);
	assert.match(hints, /selected: Anthropic is ready for anthropic\/claude-sonnet-4-0/);
	assert.match(hints, /next: \/model/);
	assert.match(hints, /cli: p4j --provider anthropic --model claude-sonnet-4-0/);
	assert.match(hints, /try: OpenAI -> p4j --provider openai --model gpt-4.1/);
});

test("builds local diagnostics snapshot from injected read-only command results", () => {
	const snapshot = buildLocalDiagnosticsSnapshot("/tmp/p4j", (command, args) => {
		const key = [command, ...args].join(" ");
		const outputs: Record<string, string> = {
			"node --version": "v25.9.0\n",
			"npm --version": "11.6.2\n",
			"tmux -V": "tmux 3.6a\n",
			"git status --short --branch": "## main...origin/main\n",
			"pgrep -fl ollama": "1234 ollama serve\n",
			"pgrep -fl cmux": "3456 cmux --proxy\n",
			"pgrep -fl node.*model": "2345 node modelpool serve\n",
			"pgrep -fl node.*provider": "4567 node provider-daemon start\n",
			"df -h /tmp/p4j": "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s1 100G 50G 50G 50% /\n",
		};
		return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
	});
	assert.equal(snapshot.version, "0.8.1");
	assert.equal(snapshot.runtime.node, "v25.9.0");
	assert.equal(snapshot.git, "## main...origin/main");
	assert.equal(snapshot.processes.ollama, "1234 ollama serve");
	assert.equal(snapshot.processes.cmux, "3456 cmux --proxy");
	assert.equal(snapshot.processes["node.*model"], "2345 node modelpool serve");
	assert.equal(snapshot.processes["node.*provider"], "4567 node provider-daemon start");
	assert.equal(snapshot.disk, "/dev/disk3s1 100G 50G 50G 50% /");
});

test("writes local report with readable summary and JSON snapshot path", () => {
	const cwd = mkdtempSync(join(tmpdir(), "p4j-local-"));
	const report = getLocalReport(cwd, (command, args) => {
		const key = [command, ...args].join(" ");
		const outputs: Record<string, string> = {
			"node --version": "v25.9.0\n",
			"npm --version": "11.6.2\n",
			"tmux -V": "tmux 3.6a\n",
			"git status --short --branch": "## main...origin/main\n",
			"pgrep -fl ollama": "1234 ollama serve\n",
			"pgrep -fl cmux": "3456 cmux --proxy\n",
			"pgrep -fl node.*model": "2345 node modelpool serve\n",
			"pgrep -fl node.*provider": "4567 node provider-daemon start\n",
			[`df -h ${cwd}`]: "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s1 100G 50G 50G 50% /\n",
		};
		return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
	});
	const snapshotPath = join(cwd, ".p4j", "local", "latest.json");
	const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { version?: unknown; cwd?: unknown };
	assert.match(report, /p4j local summary \(read-only\)/);
	assert.match(report, /runtime: node v25\.9\.0, npm 11\.6\.2, tmux 3\.6a/);
	assert.match(
		report,
		/model candidates: likely=3 \(ollama=1 \(1234 ollama serve\); node\.\*model=1 \(2345 node modelpool serve\); node\.\*provider=1 \(4567 node provider-daemon start\)\); noisy=1 \(cmux=1 \(3456 cmux --proxy\)\)/,
	);
	assert.match(report, /disk \/dev\/disk3s1 100G 50G 50G 50% \//);
	assert.equal(report.includes(`JSON snapshot: ${snapshotPath}`), true);
	assert.equal(snapshot.version, "0.8.1");
	assert.equal(snapshot.cwd, cwd);
});

test("parses stop-models arguments with dry-run default and apply pid", () => {
	assert.deepEqual(parseStopModelsArgs(""), {
		apply: false,
		dryRun: true,
		explicitDryRun: false,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--dry-run"), {
		apply: false,
		dryRun: true,
		explicitDryRun: true,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--apply --pid 123"), {
		apply: true,
		dryRun: false,
		explicitDryRun: false,
		pid: 123,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--apply"), {
		apply: true,
		dryRun: false,
		explicitDryRun: false,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--pid nope").errors, ["--pid requires a numeric process id"]);
});

test("parses stop-models candidates from pgrep output with likely and noisy classification", () => {
	const candidates = parseStopModelsCandidates({
		ollama: "400 ollama serve\n",
		"node.*model": "500 node modelpool serve --port 4547\n400 ollama serve\n",
		cmux: "600 cmux --proxy\n",
		"node.*provider": "700 node provider-daemon start\n",
	});
	assert.deepEqual(candidates, [
		{ pattern: "ollama", pid: 400, command: "ollama serve", classification: "likely" },
		{ pattern: "node.*model", pid: 500, command: "node modelpool serve --port 4547", classification: "likely" },
		{ pattern: "cmux", pid: 600, command: "cmux --proxy", classification: "noisy" },
		{ pattern: "node.*provider", pid: 700, command: "node provider-daemon start", classification: "likely" },
	]);
});

test("renders stop-models dry-run with likely and noisy grouping", () => {
	const report = getStopModelsDryRun([
		{ pattern: "ollama", pid: 400, command: "ollama serve", classification: "likely" },
		{ pattern: "cmux", pid: 600, command: "cmux --proxy", classification: "noisy" },
	]);
	assert.match(report, /p4j stop-models dry-run/);
	assert.match(report, /No processes were stopped/);
	assert.match(report, /Likely candidates \(1\):\n- ollama: 400 ollama serve/);
	assert.match(report, /Noisy\/local matches \(1\):\n- cmux: 600 cmux --proxy/);
});

test("refuses unknown dry-run options without executing", async () => {
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest("--wat", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(result.type, "error");
	assert.match(result.message, /unknown option: --wat/);
	assert.equal(stoppedPid, undefined);
});

test("refuses conflicting apply and dry-run flags without executing", async () => {
	for (const args of ["--apply --dry-run --pid 400", "--dry-run --apply --pid 400"]) {
		let stoppedPid: number | undefined;
		const result = await runStopModelsRequest(args, createContext("/tmp/p4j", true), {
			candidates: [stopCandidate("ollama", 400, "ollama serve")],
			stopExecutor: (pid) => {
				stoppedPid = pid;
				return { ok: true };
			},
		});
		assert.equal(result.type, "error");
		assert.match(result.message, /choose either --dry-run or --apply/);
		assert.equal(stoppedPid, undefined);
	}
});

test("refuses apply without pid and without executing", async () => {
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest("--apply", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(result.type, "error");
	assert.match(result.message, /--apply requires --pid <pid>/);
	assert.equal(stoppedPid, undefined);
});

test("refuses unknown candidate pid and system pid", async () => {
	const unknown = await runStopModelsRequest("--apply --pid 999", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
	});
	assert.equal(unknown.type, "error");
	assert.match(unknown.message, /not a current stop-models candidate/);

	const system = await runStopModelsRequest("--apply --pid 1", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 1, "launchd")],
	});
	assert.equal(system.type, "error");
	assert.match(system.message, /system pid below 100/);
});

test("revalidates pid before executing apply", async () => {
	let providerCalls = 0;
	let stoppedPid: number | undefined;
	const candidate = stopCandidate("ollama", 400, "ollama serve");
	const result = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidateProvider: () => {
			providerCalls += 1;
			return [candidate];
		},
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(result.type, "warning");
	assert.match(result.message, /stopped pid: 400/);
	assert.equal(providerCalls, 2);
	assert.equal(stoppedPid, 400);
});

test("refuses stale pid before executing apply", async () => {
	let providerCalls = 0;
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidateProvider: () => {
			providerCalls += 1;
			return providerCalls === 1 ? [stopCandidate("ollama", 400, "ollama serve")] : [];
		},
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(result.type, "error");
	assert.match(result.message, /pid changed before apply/);
	assert.equal(providerCalls, 2);
	assert.equal(stoppedPid, undefined);
});

test("refuses changed pid command before executing apply", async () => {
	let providerCalls = 0;
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidateProvider: () => {
			providerCalls += 1;
			return [stopCandidate("ollama", 400, providerCalls === 1 ? "ollama serve" : "node unrelated.js")];
		},
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(result.type, "error");
	assert.match(result.message, /pid command changed before apply/);
	assert.equal(providerCalls, 2);
	assert.equal(stoppedPid, undefined);
});

test("requires confirmation before executing apply", async () => {
	let stoppedPid: number | undefined;
	const cancelled = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", false), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(cancelled.type, "warning");
	assert.match(cancelled.message, /cancelled/);
	assert.equal(stoppedPid, undefined);

	const applied = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(applied.type, "warning");
	assert.match(applied.message, /stopped pid: 400/);
	assert.equal(stoppedPid, 400);
});
