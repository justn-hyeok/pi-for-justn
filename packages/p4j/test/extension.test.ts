import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LocalDiagnosticsSnapshot } from "../../../p4j/extensions/index.js";
import {
	buildActiveState,
	buildLocalDiagnosticsSnapshot,
	formatAgentCatalog,
	formatAgentRoute,
	formatDelegatePrompt,
	formatRoutingHints,
	formatWorkflowPrompt,
	getLocalReport,
	getStopModelsDryRun,
	parseDelegateArgs,
	parseStopModelsArgs,
	parseStopModelsCandidates,
	persistActiveState,
	persistLocalDiagnosticsSnapshot,
	routeP4jAgents,
	runP4jSubagent,
	runStopModelsRequest,
	transformKeywordInput,
} from "../../../p4j/extensions/index.js";

function createLocalSnapshot(cwd: string): LocalDiagnosticsSnapshot {
	return {
		version: "0.8.1",
		timestamp: new Date().toISOString(),
		cwd,
		platform: "test-platform",
		runtime: { node: "v25.9.0", npm: "11.6.2", tmux: "tmux 3.6a" },
		git: "## main...origin/main",
		processes: { ollama: "none", cmux: "none", "node.*model": "none", "node.*provider": "none" },
		memory: "1.0GB free / 2.0GB total",
		disk: "/dev/disk3s1 100G 50G 50G 50% /",
	};
}

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
	const saved = readFileSync(join(cwd, ".p4j", "local", "active.json"), "utf8");
	assert.match(saved, /"event": "agent_start"/);
	assert.doesNotMatch(saved, /api/i);
	assert.doesNotMatch(saved, /token/i);
});

test("best-effort writes survive a blocking .p4j file for active and local state", () => {
	const cwd = mkdtempSync(join(tmpdir(), "p4j-blocked-"));
	writeFileSync(join(cwd, ".p4j"), "blocked");
	const ctx = createContext(cwd) as ExtensionContext;
	assert.doesNotThrow(() => persistActiveState(ctx, "agent_start", "running"));
	assert.doesNotThrow(() =>
		getLocalReport(cwd, (command, args) => {
			const key = [command, ...args].join(" ");
			const outputs: Record<string, string> = {
				"node --version": "v25.9.0\n",
				"npm --version": "11.6.2\n",
				"tmux -V": "tmux 3.6a\n",
				"git status --short --branch": "## main...origin/main\n",
				"pgrep -fl ollama": "exit 1",
				"pgrep -fl cmux": "none",
				"pgrep -fl node.*model": "unavailable (ENOENT)",
				"pgrep -fl node.*provider": "exit 0",
				[`df -h ${cwd}`]: "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s1 100G 50G 50G 50% /\n",
			};
			return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
		}),
	);
});

if (process.platform !== "win32") {
	test("refuses a symlinked .p4j directory for active state writes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "p4j-active-symlink-dir-"));
		const externalDir = mkdtempSync(join(tmpdir(), "p4j-active-external-"));
		symlinkSync(externalDir, join(cwd, ".p4j"), "dir");
		assert.doesNotThrow(() => persistActiveState(createContext(cwd) as ExtensionContext, "agent_start", "running"));
		assert.equal(existsSync(join(externalDir, "local", "active.json")), false);
	});

	test("refuses a symlinked active state file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "p4j-active-symlink-file-"));
		const externalFile = join(mkdtempSync(join(tmpdir(), "p4j-active-target-")), "target.json");
		mkdirSync(join(cwd, ".p4j", "local"), { recursive: true });
		writeFileSync(externalFile, "keep");
		symlinkSync(externalFile, join(cwd, ".p4j", "local", "active.json"));
		assert.doesNotThrow(() => persistActiveState(createContext(cwd) as ExtensionContext, "agent_start", "running"));
		assert.equal(readFileSync(externalFile, "utf8"), "keep");
	});

	test("refuses a symlinked .p4j/local directory for snapshot writes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "p4j-local-symlink-dir-"));
		const externalDir = mkdtempSync(join(tmpdir(), "p4j-local-external-"));
		mkdirSync(join(cwd, ".p4j"));
		symlinkSync(externalDir, join(cwd, ".p4j", "local"), "dir");
		assert.doesNotThrow(() => persistLocalDiagnosticsSnapshot(cwd, createLocalSnapshot(cwd)));
		assert.equal(existsSync(join(externalDir, "latest.json")), false);
	});

	test("refuses a symlinked local snapshot file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "p4j-local-symlink-file-"));
		const externalFile = join(mkdtempSync(join(tmpdir(), "p4j-local-target-")), "target.json");
		mkdirSync(join(cwd, ".p4j", "local"), { recursive: true });
		writeFileSync(externalFile, "keep");
		symlinkSync(externalFile, join(cwd, ".p4j", "local", "latest.json"));
		assert.doesNotThrow(() => persistLocalDiagnosticsSnapshot(cwd, createLocalSnapshot(cwd)));
		assert.equal(readFileSync(externalFile, "utf8"), "keep");
	});
}

test("builds local diagnostics with the exact cwd even when it contains spaces", () => {
	const cwd = join(tmpdir(), "p4j exact cwd", "with spaces");
	const seenCwds = new Set<string>();
	const snapshot = buildLocalDiagnosticsSnapshot(cwd, (command, args, runnerCwd) => {
		seenCwds.add(runnerCwd);
		const key = [command, ...args].join(" ");
		const outputs: Record<string, string> = {
			"node --version": "v25.9.0\n",
			"npm --version": "11.6.2\n",
			"tmux -V": "tmux 3.6a\n",
			"git status --short --branch": "## main...origin/main\n",
			"pgrep -fl ollama": "1234 ollama serve\n",
			"pgrep -fl cmux": "none",
			"pgrep -fl node.*model": "unavailable (ENOENT)",
			"pgrep -fl node.*provider": "exit 1",
			[`df -h ${cwd}`]: "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s1 100G 50G 50G 50% /\n",
		};
		return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
	});
	assert.equal(snapshot.cwd, cwd);
	assert.deepEqual(seenCwds, new Set([cwd]));
});

test("formats p4j agent catalog and routes requests", () => {
	const catalog = formatAgentCatalog();
	assert.match(catalog, /p4j agents/);
	assert.match(catalog, /- orchestrator: route, decompose, delegate, verify/);
	assert.match(catalog, /- hardworker: push long multi-step work to completion/);
	assert.match(catalog, /- quick-son: tiny obvious change helper/);
	assert.deepEqual(routeP4jAgents("fix a failing css layout bug"), ["orchestrator", "debugger", "designer"]);
	assert.deepEqual(routeP4jAgents("unknown request"), ["orchestrator", "searcher", "planner", "builder", "reviewer"]);
	assert.match(formatAgentRoute("research a library api"), /1\. orchestrator/);
	assert.match(formatAgentRoute("research a library api"), /researcher/);
	assert.equal(formatAgentRoute("   "), "Usage: /p4j:route <request>");
});

test("formats p4j delegate prompts, workflows, and keyword transforms", () => {
	assert.deepEqual(parseDelegateArgs("--dry-run searcher find auth code"), {
		dryRun: true,
		agent: "searcher",
		task: "find auth code",
	});
	assert.match(parseDelegateArgs("missing").error ?? "", /Usage/);
	assert.match(parseDelegateArgs("ghost do work").error ?? "", /Unknown p4j agent/);
	assert.match(formatDelegatePrompt("searcher", "find auth code"), /p4j_subagent/);
	assert.match(formatWorkflowPrompt("implement", "add caching"), /searcher -> planner -> builder -> reviewer/);
	assert.match(formatWorkflowPrompt("nope", "add caching"), /Usage/);
	assert.match(transformKeywordInput("[search] find auth code") ?? "", /agent "searcher"/);
	assert.match(transformKeywordInput("[review] check this") ?? "", /reviewer -> checker/);
	assert.match(transformKeywordInput("[ulw] finish this") ?? "", /orchestrator -> hardworker -> reviewer/);
	assert.match(transformKeywordInput("[analyze] css bug") ?? "", /Recommended agents/);
	assert.equal(transformKeywordInput("plain input"), undefined);
});

test("runs p4j subagent through json-mode invocation", () => {
	const result = runP4jSubagent("searcher", "find auth code", "/tmp/p4j", (_command, args, cwd) => {
		assert.equal(cwd, "/tmp/p4j");
		const promptIndex = args.indexOf("--append-system-prompt") + 1;
		assert.match(args[promptIndex] ?? "", /You are the p4j searcher/);
		assert.equal(
			args.some((arg) => arg === "Task: find auth code"),
			true,
		);
		return {
			stdout:
				'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"found auth"}]}}\n',
			stderr: "",
			status: 0,
			error: undefined,
			signal: null,
		};
	});
	assert.equal(result.ok, true);
	assert.equal(result.output, "found auth");
	assert.equal(result.stderr, "");
	assert.equal(runP4jSubagent("ghost", "work", "/tmp/p4j").ok, false);
	assert.equal(runP4jSubagent("searcher", "  ", "/tmp/p4j").stderr, "Missing subagent task");
});

test("reports p4j subagent failures without exposing raw stdout", () => {
	const result = runP4jSubagent("searcher", "find auth code", "/tmp/p4j", () => ({
		stdout: '{"type":"session_start","message":{"content":"raw transcript"}}\n',
		stderr: "child failed",
		status: 1,
		error: undefined,
		signal: null,
	}));
	assert.equal(result.ok, false);
	assert.equal(result.output, "child failed");
	assert.equal("stdout" in result, false);
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

test("bounds long local summaries while leaving stop-models dry-run readable", () => {
	const cwd = mkdtempSync(join(tmpdir(), "p4j-summary-"));
	const longCommand =
		"node model runner --provider openai --model gpt-4.1 --port 4545 --workspace /very/long/path/that/keeps/going";
	const report = getLocalReport(cwd, (command, args) => {
		const key = [command, ...args].join(" ");
		const outputs: Record<string, string> = {
			"node --version": "v25.9.0\n",
			"npm --version": "11.6.2\n",
			"tmux -V": "tmux 3.6a\n",
			"git status --short --branch": "## main...origin/main\n",
			"pgrep -fl ollama": `900 ${longCommand}\n`,
			"pgrep -fl cmux": "none",
			"pgrep -fl node.*model": "exit 1",
			"pgrep -fl node.*provider": "unavailable (ENOENT)",
			[`df -h ${cwd}`]: "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s1 100G 50G 50G 50% /\n",
		};
		return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
	});
	assert.match(report, /model candidates: likely=1 .*…/);
	assert.doesNotMatch(report, /very\/long\/path\/that\/keeps\/going/);
	const dryRun = getStopModelsDryRun([
		{ pattern: "ollama", pid: 900, command: longCommand, classification: "likely" },
	]);
	assert.match(dryRun, new RegExp(longCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(dryRun, /…/);
});

test("parses stop-models arguments with dry-run default and apply pid", () => {
	assert.deepEqual(parseStopModelsArgs(""), {
		apply: false,
		dryRun: true,
		explicitDryRun: false,
		verbose: false,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--dry-run"), {
		apply: false,
		dryRun: true,
		explicitDryRun: true,
		verbose: false,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--verbose"), {
		apply: false,
		dryRun: true,
		explicitDryRun: false,
		verbose: true,
		pid: undefined,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--apply --pid 123"), {
		apply: true,
		dryRun: false,
		explicitDryRun: false,
		verbose: false,
		pid: 123,
		errors: [],
	});
	assert.deepEqual(parseStopModelsArgs("--apply"), {
		apply: true,
		dryRun: false,
		explicitDryRun: false,
		verbose: false,
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

test("parses stop-models candidates deterministically across malformed, duplicate, and exit outputs", () => {
	const candidates = parseStopModelsCandidates({
		other: "broken line\n200 node provider-daemon start\nnot-a-pid cmux --proxy\n200 duplicate ignored\n",
		more: "50 node model runner\ntext only\n900 unrelated command\n",
		cmux: "exit 0",
		ollama: "none",
		provider: "unavailable (ENOENT)",
	});
	assert.deepEqual(candidates, [
		{ pattern: "more", pid: 50, command: "node model runner", classification: "likely" },
		{ pattern: "other", pid: 200, command: "node provider-daemon start", classification: "likely" },
		{ pattern: "more", pid: 900, command: "unrelated command", classification: "likely" },
	]);
});

test("classifies command-based cmux noise and node model/provider matches from non-cmux patterns", () => {
	const candidates = parseStopModelsCandidates({
		noise: "600 cmux --proxy\n",
		model: "700 node model server\n",
		provider: "800 node provider daemon\n",
	});
	assert.deepEqual(candidates, [
		{ pattern: "noise", pid: 600, command: "cmux --proxy", classification: "noisy" },
		{ pattern: "model", pid: 700, command: "node model server", classification: "likely" },
		{ pattern: "provider", pid: 800, command: "node provider daemon", classification: "likely" },
	]);
});

test("renders stop-models dry-run with likely candidates and folded noisy summary", () => {
	const report = getStopModelsDryRun([
		{ pattern: "ollama", pid: 400, command: "ollama serve", classification: "likely" },
		{
			pattern: "cmux",
			pid: 600,
			command: "npm exec @modelcontextprotocol/server-filesystem HOME=/Users/justn PATH=/long",
			classification: "noisy",
		},
		{
			pattern: "cmux",
			pid: 601,
			command: "npm exec @modelcontextprotocol/server-memory HOME=/Users/justn PATH=/long",
			classification: "noisy",
		},
	]);
	assert.match(report, /p4j stop-models dry-run/);
	assert.match(report, /No processes were stopped/);
	assert.match(report, /Likely candidates \(1\):\n- ollama: 400 ollama serve/);
	assert.match(
		report,
		/Noisy\/local matches \(2\):\n- cmux: 2 matches hidden \(sample: 600 npm exec @modelcontextprotocol\/server-filesystem\)/,
	);
	assert.match(report, /add --verbose/);
	assert.doesNotMatch(report, /PATH=\/long/);
	assert.doesNotMatch(report, /server-memory/);
});

test("renders stop-models verbose dry-run with sanitized noisy details", () => {
	const report = getStopModelsDryRun(
		[
			{
				pattern: "cmux",
				pid: 600,
				command: "npm exec @modelcontextprotocol/server-filesystem HOME=/Users/justn PATH=/long",
				classification: "noisy",
			},
			{
				pattern: "cmux",
				pid: 601,
				command: "npm exec @modelcontextprotocol/server-memory HOME=/Users/justn PATH=/long",
				classification: "noisy",
			},
		],
		true,
	);
	assert.match(
		report,
		/Noisy\/local matches \(2\):\n- cmux: 600 npm exec @modelcontextprotocol\/server-filesystem\n- cmux: 601 npm exec @modelcontextprotocol\/server-memory/,
	);
	assert.match(report, /Verbose: showing all noisy\/local matches\./);
	assert.doesNotMatch(report, /PATH=\/long/);
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

test("refuses apply without UI and without executing", async () => {
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest(
		"--apply --pid 400",
		{ ...createContext("/tmp/p4j", true), hasUI: false },
		{
			candidates: [stopCandidate("ollama", 400, "ollama serve")],
			stopExecutor: (pid) => {
				stoppedPid = pid;
				return { ok: true };
			},
		},
	);
	assert.equal(result.type, "error");
	assert.match(result.message, /--apply requires interactive UI confirmation/);
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

test("reports stopExecutor failures without calling process kill directly", async () => {
	let stopCalls = 0;
	const result = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidates: [stopCandidate("ollama", 400, "ollama serve")],
		stopExecutor: () => {
			stopCalls += 1;
			return { ok: false, error: "simulated failure" };
		},
	});
	assert.equal(result.type, "error");
	assert.match(result.message, /p4j stop-models failed/);
	assert.match(result.message, /simulated failure/);
	assert.equal(stopCalls, 1);
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
