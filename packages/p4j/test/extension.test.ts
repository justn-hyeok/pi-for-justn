import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildActiveState,
	buildLocalDiagnosticsSnapshot,
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

test("builds and persists active state without prompt or credential content", () => {
	const cwd = mkdtempSync(join(tmpdir(), "p4j-active-"));
	const ctx = createContext(cwd) as ExtensionContext;
	const state = buildActiveState(ctx, "agent_start", "running");
	assert.equal(state.version, "0.5.0");
	assert.equal(state.status, "running");
	assert.equal(state.model, "test-provider/test-model");
	assert.equal(state.context, "12%/345");

	persistActiveState(ctx, "agent_start", "running");
	const saved = readFileSync(join(cwd, ".p4j", "active.json"), "utf8");
	assert.match(saved, /"event": "agent_start"/);
	assert.doesNotMatch(saved, /api/i);
	assert.doesNotMatch(saved, /token/i);
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
			"pgrep -fl cmux": "",
			"pgrep -fl node.*model": "2345 node modelpool serve\n",
			"pgrep -fl node.*provider": "",
			"df -h /tmp/p4j": "Filesystem Size Used Avail Capacity Mounted on\n",
		};
		return { stdout: outputs[key] ?? "", stderr: "", status: outputs[key] ? 0 : 1 };
	});
	assert.equal(snapshot.version, "0.5.0");
	assert.equal(snapshot.runtime.node, "v25.9.0");
	assert.equal(snapshot.git, "## main...origin/main");
	assert.match(snapshot.processes.ollama, /ollama serve/);
	assert.equal(snapshot.processes.cmux, "none");
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

test("parses stop-models candidates from pgrep output", () => {
	const candidates = parseStopModelsCandidates({
		ollama: "400 ollama serve\n",
		"node.*model": "500 node modelpool serve --port 4547\n400 ollama serve\n",
		cmux: "none",
	});
	assert.deepEqual(candidates, [
		{ pattern: "ollama", pid: 400, command: "ollama serve" },
		{ pattern: "node.*model", pid: 500, command: "node modelpool serve --port 4547" },
	]);
});

test("renders stop-models dry-run without executing", () => {
	const report = getStopModelsDryRun([{ pattern: "ollama", pid: 400, command: "ollama serve" }]);
	assert.match(report, /p4j stop-models dry-run/);
	assert.match(report, /No processes were stopped/);
	assert.match(report, /ollama: 400 ollama serve/);
});

test("refuses unknown dry-run options without executing", async () => {
	let stoppedPid: number | undefined;
	const result = await runStopModelsRequest("--wat", createContext("/tmp/p4j", true), {
		candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
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
			candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
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
		candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
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
		candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
	});
	assert.equal(unknown.type, "error");
	assert.match(unknown.message, /not a current stop-models candidate/);

	const system = await runStopModelsRequest("--apply --pid 1", createContext("/tmp/p4j", true), {
		candidates: [{ pattern: "ollama", pid: 1, command: "launchd" }],
	});
	assert.equal(system.type, "error");
	assert.match(system.message, /system pid below 100/);
});

test("requires confirmation before executing apply", async () => {
	let stoppedPid: number | undefined;
	const cancelled = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", false), {
		candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(cancelled.type, "warning");
	assert.match(cancelled.message, /cancelled/);
	assert.equal(stoppedPid, undefined);

	const applied = await runStopModelsRequest("--apply --pid 400", createContext("/tmp/p4j", true), {
		candidates: [{ pattern: "ollama", pid: 400, command: "ollama serve" }],
		stopExecutor: (pid) => {
			stoppedPid = pid;
			return { ok: true };
		},
	});
	assert.equal(applied.type, "warning");
	assert.match(applied.message, /stopped pid: 400/);
	assert.equal(stoppedPid, 400);
});
