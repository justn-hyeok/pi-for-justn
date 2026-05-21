import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const VERSION = "0.8.0";
export const WORKFLOWS = "quick, think, search, plan, build, review, ship, local, team, ulw";
export const STOP_MODEL_PATTERNS = ["ollama", "cmux", "node.*model", "node.*provider"] as const;

type StopModelsCandidateClassification = "likely" | "noisy";

type CommandResult = {
	stdout: string;
	stderr: string;
	status: number | null;
	error?: string;
};

type CommandRunner = (command: string, args: string[], cwd: string) => CommandResult;

type StopExecutor = (pid: number) => { ok: true } | { ok: false; error: string };

type ActiveState = {
	version: string;
	status: string;
	updatedAt: string;
	cwd: string;
	pid: number;
	model: string;
	idle: boolean;
	pendingMessages: boolean;
	context: string;
	event: string;
};

export type LocalDiagnosticsSnapshot = {
	version: string;
	timestamp: string;
	cwd: string;
	platform: string;
	runtime: {
		node: string;
		npm: string;
		tmux: string;
	};
	git: string;
	processes: Record<(typeof STOP_MODEL_PATTERNS)[number], string>;
	memory: string;
	disk: string;
};

export type StopModelsCandidate = {
	pattern: string;
	pid: number;
	command: string;
	classification: StopModelsCandidateClassification;
};

export type StopModelsRequest = {
	apply: boolean;
	dryRun: boolean;
	explicitDryRun: boolean;
	pid: number | undefined;
	errors: string[];
};

function runReadOnly(command: string, args: string[], cwd: string): string {
	return formatCommandResult(defaultCommandRunner(command, args, cwd));
}

function defaultCommandRunner(command: string, args: string[], cwd: string): CommandResult {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 3000 });
	if (result.error) {
		return { stdout: "", stderr: "", status: null, error: result.error.message };
	}
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		status: result.status,
	};
}

function formatCommandResult(result: CommandResult): string {
	if (result.error) {
		return `unavailable (${result.error})`;
	}
	const output = `${result.stdout}${result.stderr}`.trim();
	return output.length > 0 ? output : `exit ${result.status ?? 0}`;
}

function firstLine(value: string): string {
	return value.split("\n")[0]?.trim() || "unavailable";
}

function secondLineOrFirst(value: string): string {
	const lines = value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return lines[1] ?? lines[0] ?? "unavailable";
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatBytes(bytes: number): string {
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function getStatePath(cwd: string): string {
	return resolve(cwd, ".p4j", "active.json");
}

function getLocalSnapshotPath(cwd: string): string {
	return resolve(cwd, ".p4j", "local", "latest.json");
}

function formatModel(ctx: ExtensionContext): string {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
}

function formatContextUsage(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	return usage ? `${usage.percent ?? 0}%/${usage.tokens ?? 0}` : "unknown";
}

type RoutingHintModel = NonNullable<ExtensionContext["model"]>;

function formatModelReference(model: RoutingHintModel): string {
	return `${model.provider}/${model.id}`;
}

export function formatRoutingHints(ctx: ExtensionCommandContext | ExtensionContext): string {
	const allModels = ctx.modelRegistry.getAll();
	const availableModels = ctx.modelRegistry.getAvailable();
	const rawCurrentModel = ctx.model;
	const currentModel =
		rawCurrentModel && allModels.some((model) => model.provider === rawCurrentModel.provider && model.id === rawCurrentModel.id)
			? rawCurrentModel
			: undefined;
	const currentModelReference = currentModel ? formatModelReference(currentModel) : "none";
	const lines = ["p4j routing hints", `current model: ${currentModelReference}`, `usable models: ${availableModels.length}/${allModels.length}`];

	if (allModels.length === 0) {
		lines.push("next: p4j --list-models");
		lines.push("next: /login");
		lines.push("docs: packages/coding-agent/docs/providers.md, packages/coding-agent/docs/models.md");
		return lines.join("\n");
	}

	const formatProviderModelCommand = (model: RoutingHintModel): string => `p4j --provider ${model.provider} --model ${model.id}`;
	const firstModel = availableModels[0] ?? allModels[0];

	if (!currentModel) {
		const providerDisplayName = ctx.modelRegistry.getProviderDisplayName(firstModel.provider);
		lines.push("next: /model");
		lines.push(`try: ${providerDisplayName} -> ${formatProviderModelCommand(firstModel)}`);
		if (availableModels.length === 0) {
			lines.push("next: /login");
		}
		lines.push("next: p4j --list-models");
		lines.push("docs: packages/coding-agent/docs/providers.md, packages/coding-agent/docs/models.md");
		return lines.join("\n");
	}

	const providerDisplayName = ctx.modelRegistry.getProviderDisplayName(currentModel.provider);
	const hasAuth = ctx.modelRegistry.hasConfiguredAuth(currentModel);
	if (!hasAuth) {
		lines.push(`selected: ${providerDisplayName} needs login for ${currentModelReference}`);
		lines.push("next: /login");
	} else {
		lines.push(`selected: ${providerDisplayName} is ready for ${currentModelReference}`);
		lines.push("next: /model");
	}
	lines.push(`cli: ${formatProviderModelCommand(currentModel)}`);
	const alternateModel = availableModels.find((model) => model.provider !== currentModel.provider || model.id !== currentModel.id) ?? firstModel;
	const alternateProviderDisplayName = ctx.modelRegistry.getProviderDisplayName(alternateModel.provider);
	lines.push(`try: ${alternateProviderDisplayName} -> ${formatProviderModelCommand(alternateModel)}`);
	lines.push("next: p4j --list-models");
	lines.push("docs: packages/coding-agent/docs/providers.md, packages/coding-agent/docs/models.md");
	return lines.join("\n");
}

export function buildActiveState(ctx: ExtensionContext, event: string, status: string): ActiveState {
	return {
		version: VERSION,
		status,
		updatedAt: new Date().toISOString(),
		cwd: ctx.cwd,
		pid: process.pid,
		model: formatModel(ctx),
		idle: ctx.isIdle(),
		pendingMessages: ctx.hasPendingMessages(),
		context: formatContextUsage(ctx),
		event,
	};
}

export function persistActiveState(ctx: ExtensionContext, event: string, status: string): void {
	const statePath = getStatePath(ctx.cwd);
	try {
		mkdirSync(dirname(statePath), { recursive: true });
		writeFileSync(statePath, `${JSON.stringify(buildActiveState(ctx, event, status), null, "\t")}\n`);
	} catch {
		// Active state is best-effort local metadata and must not break Pi.
	}
}

function readActiveState(cwd: string): string {
	const statePath = getStatePath(cwd);
	if (!existsSync(statePath)) {
		return `state: missing ${statePath}`;
	}
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8")) as { version?: unknown; status?: unknown; updatedAt?: unknown; event?: unknown };
		return [
			`state: ${statePath}`,
			`version: ${String(state.version ?? "unknown")}`,
			`status: ${String(state.status ?? "unknown")}`,
			`updatedAt: ${String(state.updatedAt ?? "unknown")}`,
			`event: ${String(state.event ?? "unknown")}`,
		].join("\n");
	} catch (error) {
		return `state: unreadable (${error instanceof Error ? error.message : String(error)})`;
	}
}

function getActiveReport(ctx: ExtensionCommandContext): string {
	return [
		"p4j active",
		`cwd: ${ctx.cwd}`,
		`model: ${formatModel(ctx)}`,
		`idle: ${ctx.isIdle()}`,
		`pendingMessages: ${ctx.hasPendingMessages()}`,
		`context: ${formatContextUsage(ctx)}`,
		readActiveState(ctx.cwd),
	].join("\n");
}

export function buildLocalDiagnosticsSnapshot(cwd: string, runner: CommandRunner = defaultCommandRunner): LocalDiagnosticsSnapshot {
	const read = (command: string, args: string[]) => formatCommandResult(runner(command, args, cwd));
	return {
		version: VERSION,
		timestamp: new Date().toISOString(),
		cwd,
		platform: `${platform()} ${release()}`,
		runtime: {
			node: firstLine(read("node", ["--version"])),
			npm: firstLine(read("npm", ["--version"])),
			tmux: firstLine(read("tmux", ["-V"])),
		},
		git: firstLine(read("git", ["status", "--short", "--branch"])),
		processes: Object.fromEntries(
			STOP_MODEL_PATTERNS.map((pattern) => {
				const result = read("pgrep", ["-fl", pattern]);
				return [pattern, result !== "exit 1" && !result.startsWith("unavailable") ? result : "none"];
			}),
		) as Record<(typeof STOP_MODEL_PATTERNS)[number], string>,
		memory: `${formatBytes(freemem())} free / ${formatBytes(totalmem())} total`,
		disk: secondLineOrFirst(read("df", ["-h", cwd])),
	};
}

export function persistLocalDiagnosticsSnapshot(cwd: string, snapshot: LocalDiagnosticsSnapshot): void {
	const snapshotPath = getLocalSnapshotPath(cwd);
	try {
		mkdirSync(dirname(snapshotPath), { recursive: true });
		writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, "\t")}\n`);
	} catch {
		// Local diagnostics snapshots are best-effort read-only metadata.
	}
}

function classifyStopModelsCandidate(pattern: string, command: string): StopModelsCandidateClassification {
	if (pattern === "cmux" || /(^|\s)cmux(\s|$)/i.test(command)) {
		return "noisy";
	}
	if (pattern === "ollama" || pattern.startsWith("node.*") || /(^|\s)node(\s|$).*\b(model|provider)\b/i.test(command)) {
		return "likely";
	}
	return "likely";
}

function formatCandidateGroupSummary(candidates: StopModelsCandidate[], classification: StopModelsCandidateClassification): string {
	const items = candidates.filter((candidate) => candidate.classification === classification);
	if (items.length === 0) {
		return "none";
	}
	const groupedByPattern = new Map<string, StopModelsCandidate[]>();
	for (const candidate of items) {
		const existing = groupedByPattern.get(candidate.pattern);
		if (existing) {
			existing.push(candidate);
		} else {
			groupedByPattern.set(candidate.pattern, [candidate]);
		}
	}
	return [...groupedByPattern.entries()]
		.map(([pattern, patternCandidates]) => {
			const first = patternCandidates[0];
			return `${pattern}=${patternCandidates.length} (${first.pid} ${truncate(first.command, 48)})`;
		})
		.join("; ");
}

function formatProcessSummary(snapshot: LocalDiagnosticsSnapshot): string {
	const candidates = parseStopModelsCandidates(snapshot.processes);
	const likely = candidates.filter((candidate) => candidate.classification === "likely");
	const noisy = candidates.filter((candidate) => candidate.classification === "noisy");
	return [`likely=${likely.length} (${formatCandidateGroupSummary(candidates, "likely")})`, `noisy=${noisy.length} (${formatCandidateGroupSummary(candidates, "noisy")})`].join("; ");
}

export function formatLocalDiagnosticsSnapshot(snapshot: LocalDiagnosticsSnapshot): string {
	return [
		"p4j local summary (read-only)",
		`cwd: ${snapshot.cwd}`,
		`platform: ${snapshot.platform}`,
		`git: ${snapshot.git}`,
		`runtime: node ${snapshot.runtime.node}, npm ${snapshot.runtime.npm}, ${snapshot.runtime.tmux}`,
		`model candidates: ${formatProcessSummary(snapshot)}`,
		`resources: memory ${snapshot.memory}; disk ${snapshot.disk}`,
		`JSON snapshot: ${getLocalSnapshotPath(snapshot.cwd)}`,
	].join("\n");
}

export function getLocalReport(cwd: string, runner: CommandRunner = defaultCommandRunner): string {
	const snapshot = buildLocalDiagnosticsSnapshot(cwd, runner);
	persistLocalDiagnosticsSnapshot(cwd, snapshot);
	return formatLocalDiagnosticsSnapshot(snapshot);
}

function splitCommandArgs(args: string): string[] {
	return args.trim().length > 0 ? args.trim().split(/\s+/) : [];
}

export function parseStopModelsArgs(args: string): StopModelsRequest {
	const tokens = splitCommandArgs(args);
	const request: StopModelsRequest = { apply: false, dryRun: true, explicitDryRun: false, pid: undefined, errors: [] };
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--dry-run") {
			request.dryRun = true;
			request.explicitDryRun = true;
			continue;
		}
		if (token === "--apply") {
			request.apply = true;
			request.dryRun = false;
			continue;
		}
		if (token === "--pid") {
			const value = tokens[index + 1];
			index += 1;
			const pid = Number(value);
			if (!value || !Number.isInteger(pid)) {
				request.errors.push("--pid requires a numeric process id");
			} else {
				request.pid = pid;
			}
			continue;
		}
		request.errors.push(`unknown option: ${token}`);
	}
	return request;
}

export function parseStopModelsCandidates(outputByPattern: Record<string, string>): StopModelsCandidate[] {
	const candidates = new Map<number, StopModelsCandidate>();
	for (const [pattern, output] of Object.entries(outputByPattern)) {
		if (output === "none" || output === "exit 1" || output.startsWith("unavailable")) {
			continue;
		}
		for (const line of output.split("\n")) {
			const match = /^(\d+)\s+(.+)$/.exec(line.trim());
			if (!match) {
				continue;
			}
			const pid = Number(match[1]);
			if (!Number.isInteger(pid) || candidates.has(pid)) {
				continue;
			}
			const command = match[2];
			candidates.set(pid, {
				pattern,
				pid,
				command,
				classification: classifyStopModelsCandidate(pattern, command),
			});
		}
	}
	return [...candidates.values()].sort((left, right) => left.pid - right.pid);
}

function discoverStopModelsCandidates(cwd: string): StopModelsCandidate[] {
	const outputByPattern = Object.fromEntries(
		STOP_MODEL_PATTERNS.map((pattern) => {
			const result = runReadOnly("pgrep", ["-fl", pattern], cwd);
			const found = result !== "exit 1" && !result.startsWith("unavailable");
			return [pattern, found ? result : "none"];
		}),
	);
	return parseStopModelsCandidates(outputByPattern);
}

function getPidSafetyError(pid: number): string | undefined {
	if (!Number.isInteger(pid) || pid <= 0) {
		return "pid must be a positive integer";
	}
	if (pid < 100) {
		return "refusing to stop system pid below 100";
	}
	if (pid === process.pid) {
		return "refusing to stop the current p4j process";
	}
	if (pid === process.ppid) {
		return "refusing to stop the parent process";
	}
	return undefined;
}

function findStopTarget(request: StopModelsRequest, candidates: StopModelsCandidate[]): { candidate?: StopModelsCandidate; error?: string } {
	if (!request.apply) {
		return {};
	}
	if (request.errors.length > 0) {
		return { error: request.errors.join("\n") };
	}
	if (request.apply && request.explicitDryRun) {
		return { error: "choose either --dry-run or --apply" };
	}
	if (request.pid === undefined) {
		return { error: "--apply requires --pid <pid>" };
	}
	const safetyError = getPidSafetyError(request.pid);
	if (safetyError) {
		return { error: safetyError };
	}
	const candidate = candidates.find((item) => item.pid === request.pid);
	if (!candidate) {
		return { error: `pid ${request.pid} is not a current stop-models candidate` };
	}
	return { candidate };
}

function formatStopModelsDryRun(candidates: StopModelsCandidate[]): string {
	const likely = candidates.filter((candidate) => candidate.classification === "likely");
	const noisy = candidates.filter((candidate) => candidate.classification === "noisy");
	const formatLines = (items: StopModelsCandidate[]): string[] =>
		items.length > 0 ? items.map((candidate) => `- ${candidate.pattern}: ${candidate.pid} ${candidate.command}`) : ["- none"];
	return [
		"p4j stop-models dry-run",
		"No processes were stopped.",
		`Likely candidates (${likely.length}):`,
		...formatLines(likely),
		`Noisy/local matches (${noisy.length}):`,
		...formatLines(noisy),
		"Apply: p4j stop-models --apply --pid <pid> requires an interactive confirmation.",
	].join("\n");
}

export function getStopModelsDryRun(candidates: StopModelsCandidate[]): string {
	return formatStopModelsDryRun(candidates);
}

function defaultStopExecutor(pid: number): { ok: true } | { ok: false; error: string } {
	try {
		process.kill(pid, "SIGTERM");
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export async function runStopModelsRequest(
	args: string,
	ctx: ExtensionCommandContext,
	options: { candidates?: StopModelsCandidate[]; candidateProvider?: () => StopModelsCandidate[]; stopExecutor?: StopExecutor } = {},
): Promise<{ type: "info" | "warning" | "error"; message: string }> {
	const request = parseStopModelsArgs(args);
	if (request.errors.length > 0) {
		return { type: "error", message: `p4j stop-models refused\n${request.errors.join("\n")}` };
	}
	const candidateProvider = options.candidateProvider ?? (() => options.candidates ?? discoverStopModelsCandidates(ctx.cwd));
	const candidates = candidateProvider();
	const target = findStopTarget(request, candidates);
	if (!request.apply) {
		return target.error
			? { type: "error", message: `p4j stop-models refused\n${target.error}` }
			: { type: "warning", message: formatStopModelsDryRun(candidates) };
	}
	if (target.error) {
		return { type: "error", message: `p4j stop-models refused\n${target.error}` };
	}
	if (!target.candidate) {
		return { type: "error", message: "p4j stop-models refused\nmissing target candidate" };
	}
	if (!ctx.hasUI) {
		return { type: "error", message: "p4j stop-models refused\n--apply requires interactive UI confirmation" };
	}
	const confirmed = await ctx.ui.confirm(
		"Stop model process?",
		[`PID: ${target.candidate.pid}`, `Command: ${target.candidate.command}`, "This sends SIGTERM to exactly this PID."].join("\n"),
	);
	if (!confirmed) {
		return { type: "warning", message: `p4j stop-models cancelled\nNo processes were stopped.\npid: ${target.candidate.pid}` };
	}
	const currentTarget = findStopTarget(request, candidateProvider());
	if (currentTarget.error || !currentTarget.candidate) {
		return { type: "error", message: `p4j stop-models refused\npid changed before apply: ${currentTarget.error ?? "missing target candidate"}` };
	}
	if (currentTarget.candidate.command !== target.candidate.command) {
		return { type: "error", message: "p4j stop-models refused\npid command changed before apply" };
	}
	const result = (options.stopExecutor ?? defaultStopExecutor)(target.candidate.pid);
	if (!result.ok) {
		return { type: "error", message: `p4j stop-models failed\npid: ${target.candidate.pid}\n${result.error}` };
	}
	return { type: "warning", message: `p4j stop-models applied\nstopped pid: ${target.candidate.pid}\ncommand: ${target.candidate.command}` };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus("p4j", `p4j v${VERSION}`);
		const theme = ctx.ui.getTheme("p4j");
		if (theme) {
			ctx.ui.setTheme(theme);
		}
		persistActiveState(ctx, "session_start", "active");
	});

	pi.on("agent_start", (_event, ctx) => persistActiveState(ctx, "agent_start", "running"));
	pi.on("agent_end", (_event, ctx) => persistActiveState(ctx, "agent_end", "idle"));
	pi.on("model_select", (_event, ctx) => persistActiveState(ctx, "model_select", "model selected"));
	pi.on("session_shutdown", (_event, ctx) => persistActiveState(ctx, "session_shutdown", "shutdown"));

	pi.registerCommand("p4j:status", {
		description: "Show p4j layer status and available workflows",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`p4j v${VERSION} loaded: ${WORKFLOWS}`, "info");
		},
	});

	pi.registerCommand("p4j:active", {
		description: "Show p4j active state",
		handler: async (_args, ctx) => {
			persistActiveState(ctx, "p4j:active", "active report");
			ctx.ui.notify(getActiveReport(ctx), "info");
		},
	});

	pi.registerCommand("p4j:local", {
		description: "Show read-only local diagnostics",
		handler: async (_args, ctx) => {
			ctx.ui.notify(getLocalReport(ctx.cwd), "info");
		},
	});

	pi.registerCommand("p4j:hints", {
		description: "Show model routing hints from the current registry",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatRoutingHints(ctx), "info");
		},
	});

	pi.registerCommand("p4j:stop-models", {
		description: "Dry-run model/process candidates or stop one confirmed PID with --apply --pid <pid>",
		handler: async (args, ctx) => {
			const result = await runStopModelsRequest(args, ctx);
			ctx.ui.notify(result.message, result.type);
		},
	});
}
