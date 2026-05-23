import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, platform, release, totalmem } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const VERSION = "0.8.1";
export const WORKFLOWS = "quick, think, search, plan, build, review, ship, local, team, ulw";
export const STOP_MODEL_PATTERNS = ["ollama", "cmux", "node.*model", "node.*provider"] as const;

export const P4J_AGENTS = [
	{ name: "orchestrator", role: "route, decompose, delegate, verify", triggers: ["route", "delegate", "orchestrate", "workflow"] },
	{ name: "hardworker", role: "push long multi-step work to completion", triggers: ["ulw", "long", "complex", "end-to-end"] },
	{ name: "planner", role: "make implementation plans", triggers: ["plan", "proposal", "steps", "design doc"] },
	{ name: "searcher", role: "search local codebase patterns", triggers: ["search", "find", "grep", "where", "codebase"] },
	{ name: "researcher", role: "research external docs and libraries", triggers: ["docs", "library", "api", "github", "external"] },
	{ name: "builder", role: "implement scoped non-visual code changes", triggers: ["implement", "add", "change", "build", "write"] },
	{ name: "debugger", role: "diagnose and fix bugs", triggers: ["debug", "bug", "error", "fail", "broken", "crash"] },
	{ name: "reviewer", role: "review changes and run QA", triggers: ["review", "qa", "verify", "regression", "check work"] },
	{ name: "designer", role: "handle UI, UX, styling, layout", triggers: ["ui", "ux", "css", "style", "layout", "frontend", "animation"] },
	{ name: "shipper", role: "commit, changelog, release, delivery", triggers: ["commit", "push", "release", "ship", "changelog", "pr"] },
	{ name: "adviser", role: "architecture and hard tradeoff advice", triggers: ["architecture", "security", "performance", "tradeoff", "advise"] },
	{ name: "checker", role: "criticize plans and completion claims", triggers: ["critique", "audit", "validate", "momus", "metis"] },
	{ name: "worker-son", role: "general focused helper", triggers: ["helper", "subtask", "worker"] },
	{ name: "builder-son", role: "focused implementation helper", triggers: ["small implement", "focused build"] },
	{ name: "quick-son", role: "tiny obvious change helper", triggers: ["quick", "tiny", "typo", "single file"] },
	{ name: "searcher-son", role: "narrow search helper", triggers: ["narrow search", "references"] },
	{ name: "reviewer-son", role: "targeted review helper", triggers: ["targeted review", "spot check"] },
	{ name: "designer-son", role: "small UI helper", triggers: ["small ui", "visual slice"] },
	{ name: "shipper-son", role: "delivery checklist helper", triggers: ["release note", "delivery checklist"] },
] as const;

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
	verbose: boolean;
	pid: number | undefined;
	errors: string[];
};

type P4jAgentName = (typeof P4J_AGENTS)[number]["name"];

type SubagentRunResult = {
	agent: string;
	task: string;
	ok: boolean;
	status: number | null;
	stderr: string;
	output: string;
};

type SubagentRunner = (command: string, args: string[], cwd: string) => Pick<SpawnSyncReturns<string>, "stdout" | "stderr" | "status" | "error" | "signal">;

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

export function formatAgentCatalog(): string {
	return [
		"p4j agents",
		"Core:",
		...P4J_AGENTS.filter((agent) => !agent.name.endsWith("-son")).map((agent) => `- ${agent.name}: ${agent.role}`),
		"Helpers:",
		...P4J_AGENTS.filter((agent) => agent.name.endsWith("-son")).map((agent) => `- ${agent.name}: ${agent.role}`),
		"Route: /p4j:route <request>",
	].join("\n");
}

export function routeP4jAgents(request: string): string[] {
	const normalized = request.toLowerCase();
	const matches = P4J_AGENTS.filter((agent) => agent.triggers.some((trigger) => normalized.includes(trigger))).map(
		(agent) => agent.name,
	);
	if (matches.length > 0) {
		return [...new Set(["orchestrator", ...matches])].slice(0, 5);
	}
	return ["orchestrator", "searcher", "planner", "builder", "reviewer"];
}

export function formatAgentRoute(request: string): string {
	const query = request.trim();
	if (!query) {
		return "Usage: /p4j:route <request>";
	}
	const selected = routeP4jAgents(query);
	const lines = selected.map((name, index) => {
		const agent = P4J_AGENTS.find((candidate) => candidate.name === name);
		return `${index + 1}. ${name}: ${agent?.role ?? "unknown"}`;
	});
	return [`p4j route`, `Request: ${query}`, "Recommended agents:", ...lines].join("\n");
}

function isP4jAgentName(value: string): value is P4jAgentName {
	return P4J_AGENTS.some((agent) => agent.name === value);
}

function getAgentPromptPath(agent: string): string | undefined {
	if (!isP4jAgentName(agent)) {
		return undefined;
	}
	return resolve(import.meta.dirname, "..", "agents", `${agent}.md`);
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && !currentScript.startsWith("/$bunfs/root/") && existsSync(currentScript)) {
		return { command: process.execPath, args: [...process.execArgv, currentScript, ...args] };
	}
	const execName = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(execName) ? { command: "pi", args } : { command: process.execPath, args };
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTextFromMessage(message: unknown): string | undefined {
	if (!isJsonRecord(message)) {
		return undefined;
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	return content
		.map((part) => {
			if (!isJsonRecord(part) || part.type !== "text" || typeof part.text !== "string") {
				return "";
			}
			return part.text;
		})
		.filter((part) => part.length > 0)
		.join("\n");
}

function extractSubagentOutput(stdout: string): string {
	const outputs: string[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const event = JSON.parse(line) as unknown;
			if (!isJsonRecord(event) || event.type !== "message_end") {
				continue;
			}
			const text = getTextFromMessage(event.message);
			if (text) {
				outputs.push(text);
			}
		} catch {
			// Ignore non-JSON status lines from child processes.
		}
	}
	return outputs.at(-1) ?? stdout.trim();
}

export function runP4jSubagent(
	agent: string,
	task: string,
	cwd: string,
	runner: SubagentRunner = (command, args, runCwd) => spawnSync(command, args, { cwd: runCwd, encoding: "utf8", timeout: 120000 }),
): SubagentRunResult {
	const trimmedTask = task.trim();
	const promptPath = getAgentPromptPath(agent);
	if (!promptPath) {
		return { agent, task: trimmedTask, ok: false, status: null, stderr: `Unknown p4j agent: ${agent}`, output: "" };
	}
	if (!trimmedTask) {
		return { agent, task: trimmedTask, ok: false, status: null, stderr: "Missing subagent task", output: "" };
	}
	const agentPrompt = readFileSync(promptPath, "utf8");
	const args = ["--mode", "json", "-p", "--no-session", "--append-system-prompt", agentPrompt, `Task: ${trimmedTask}`];
	const invocation = getPiInvocation(args);
	const result = runner(invocation.command, invocation.args, cwd);
	const stdout = result.stdout ?? "";
	const stderr = result.error ? result.error.message : (result.stderr ?? "");
	const ok = result.status === 0 && !result.error && !result.signal;
	const output = ok ? extractSubagentOutput(stdout) || stderr.trim() : stderr.trim() || extractSubagentOutput(stdout);
	return { agent, task: trimmedTask, ok, status: result.status, stderr, output };
}

function formatSubagentResult(result: SubagentRunResult): string {
	return [
		`p4j delegate ${result.ok ? "complete" : "failed"}`,
		`agent: ${result.agent}`,
		`status: ${result.status ?? "unknown"}`,
		"output:",
		result.output || result.stderr || "(no output)",
	].join("\n");
}

export function formatDelegatePrompt(agent: string, task: string): string {
	return [
		`Use the p4j_subagent tool with agent "${agent}" for this task.`,
		"Return the subagent result, then summarize next steps and verification gaps.",
		`Task: ${task.trim()}`,
	].join("\n");
}

export function parseDelegateArgs(args: string): { dryRun: boolean; agent?: string; task?: string; error?: string } {
	const tokens = splitCommandArgs(args);
	const dryRun = tokens[0] === "--dry-run";
	const offset = dryRun ? 1 : 0;
	const agent = tokens[offset];
	const task = tokens.slice(offset + 1).join(" ").trim();
	if (!agent || !task) {
		return { dryRun, error: "Usage: /p4j:delegate [--dry-run] <agent> <task>" };
	}
	if (!isP4jAgentName(agent)) {
		return { dryRun, agent, task, error: `Unknown p4j agent: ${agent}` };
	}
	return { dryRun, agent, task };
}

const P4J_WORKFLOWS = {
	implement: ["searcher", "planner", "builder", "reviewer"],
	debug: ["searcher", "debugger", "reviewer"],
	review: ["reviewer", "checker"],
	ui: ["designer", "reviewer"],
	ship: ["shipper", "reviewer"],
	ulw: ["orchestrator", "hardworker", "reviewer"],
} as const;

export function formatWorkflowPrompt(name: string, task: string): string {
	const workflow = P4J_WORKFLOWS[name as keyof typeof P4J_WORKFLOWS];
	const trimmedTask = task.trim();
	if (!workflow || !trimmedTask) {
		return "Usage: /p4j:workflow <implement|debug|review|ui|ship|ulw> <task>";
	}
	return [
		`Run p4j workflow "${name}" for this task.`,
		`Agents: ${workflow.join(" -> ")}`,
		"Use p4j_subagent for isolated agent steps when execution is needed. Keep outputs concise and verify before completion.",
		`Task: ${trimmedTask}`,
	].join("\n");
}

export function transformKeywordInput(text: string): string | undefined {
	const match = /^\[(search|analyze|review|ulw)\]\s+(.+)/i.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const mode = match[1].toLowerCase();
	const task = match[2].trim();
	if (mode === "search") {
		return formatDelegatePrompt("searcher", task);
	}
	if (mode === "review") {
		return formatWorkflowPrompt("review", task);
	}
	if (mode === "ulw") {
		return formatWorkflowPrompt("ulw", task);
	}
	return [formatAgentRoute(task), "", "Analyze first. Gather context, then pick the listed p4j agents or p4j_subagent calls only if needed."].join("\n");
}

const P4J_SUBAGENT_PARAMS = Type.Object({
	agent: Type.String({ description: "p4j agent name to invoke" }),
	task: Type.String({ description: "task to delegate to the agent" }),
});

function getStatePath(cwd: string): string {
	return resolve(cwd, ".p4j", "local", "active.json");
}

function getLocalSnapshotPath(cwd: string): string {
	return resolve(cwd, ".p4j", "local", "latest.json");
}

function getLocalEntry(path: string): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

function ensureOwnedDirectory(path: string): boolean {
	const existing = getLocalEntry(path);
	if (existing) {
		return existing.isDirectory() && !existing.isSymbolicLink();
	}
	mkdirSync(path);
	const created = getLocalEntry(path);
	return created ? created.isDirectory() && !created.isSymbolicLink() : false;
}

function writeOwnedFile(path: string, requiredDirectories: string[], contents: string): void {
	for (const directory of requiredDirectories) {
		if (!ensureOwnedDirectory(directory)) {
			return;
		}
	}
	if (getLocalEntry(path)?.isSymbolicLink()) {
		return;
	}
	const flags = constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
	const fd = openSync(path, flags, 0o600);
	try {
		writeFileSync(fd, contents);
	} finally {
		closeSync(fd);
	}
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
		writeOwnedFile(statePath, [resolve(ctx.cwd, ".p4j"), dirname(statePath)], `${JSON.stringify(buildActiveState(ctx, event, status), null, "\t")}\n`);
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
				return [pattern, result !== "none" && !result.startsWith("exit ") && !result.startsWith("unavailable") ? result : "none"];
			}),
		) as Record<(typeof STOP_MODEL_PATTERNS)[number], string>,
		memory: `${formatBytes(freemem())} free / ${formatBytes(totalmem())} total`,
		disk: secondLineOrFirst(read("df", ["-h", cwd])),
	};
}

export function persistLocalDiagnosticsSnapshot(cwd: string, snapshot: LocalDiagnosticsSnapshot): void {
	const snapshotPath = getLocalSnapshotPath(cwd);
	try {
		writeOwnedFile(snapshotPath, [resolve(cwd, ".p4j"), dirname(snapshotPath)], `${JSON.stringify(snapshot, null, "\t")}\n`);
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
	const request: StopModelsRequest = { apply: false, dryRun: true, explicitDryRun: false, verbose: false, pid: undefined, errors: [] };
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
		if (token === "--verbose") {
			request.verbose = true;
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
		if (output === "none" || output.startsWith("exit ") || output.startsWith("unavailable")) {
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
			const found = !result.startsWith("exit ") && !result.startsWith("unavailable");
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

function sanitizeProcessCommand(command: string): string {
	const tokens = command.trim().split(/\s+/);
	const envIndex = tokens.findIndex((token, index) => index > 0 && /^[A-Z_][A-Z0-9_]*=/.test(token));
	return (envIndex === -1 ? tokens : tokens.slice(0, envIndex)).join(" ");
}

function formatCandidateLine(candidate: StopModelsCandidate): string {
	return `- ${candidate.pattern}: ${candidate.pid} ${truncate(sanitizeProcessCommand(candidate.command), 120)}`;
}

function formatNoisySummary(candidates: StopModelsCandidate[]): string[] {
	if (candidates.length === 0) {
		return ["- none"];
	}
	const groupedByPattern = new Map<string, StopModelsCandidate[]>();
	for (const candidate of candidates) {
		const existing = groupedByPattern.get(candidate.pattern);
		if (existing) {
			existing.push(candidate);
		} else {
			groupedByPattern.set(candidate.pattern, [candidate]);
		}
	}
	return [...groupedByPattern.entries()].map(([pattern, patternCandidates]) => {
		const sample = patternCandidates[0];
		return `- ${pattern}: ${patternCandidates.length} matches hidden (sample: ${sample.pid} ${truncate(sanitizeProcessCommand(sample.command), 96)})`;
	});
}

function formatStopModelsDryRun(candidates: StopModelsCandidate[], verbose: boolean): string {
	const likely = candidates.filter((candidate) => candidate.classification === "likely");
	const noisy = candidates.filter((candidate) => candidate.classification === "noisy");
	const formatLines = (items: StopModelsCandidate[]): string[] =>
		items.length > 0 ? items.map((candidate) => formatCandidateLine(candidate)) : ["- none"];
	return [
		"p4j stop-models dry-run",
		"No processes were stopped.",
		`Likely candidates (${likely.length}):`,
		...formatLines(likely),
		`Noisy/local matches (${noisy.length}):`,
		...(verbose ? formatLines(noisy) : formatNoisySummary(noisy)),
		verbose ? "Verbose: showing all noisy/local matches." : "Verbose: add --verbose to show every noisy/local match.",
		"Apply: p4j stop-models --apply --pid <pid> requires an interactive confirmation.",
	].join("\n");
}

export function getStopModelsDryRun(candidates: StopModelsCandidate[], verbose = false): string {
	return formatStopModelsDryRun(candidates, verbose);
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
			: { type: "warning", message: formatStopModelsDryRun(candidates, request.verbose) };
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
	pi.registerTool({
		name: "p4j_subagent",
		label: "p4j Subagent",
		description: "Run a p4j agent in an isolated pi JSON-mode subprocess.",
		promptSnippet: "p4j_subagent delegates focused work to p4j agents such as searcher, builder, reviewer, designer, or hardworker.",
		promptGuidelines: ["Use p4j_subagent when isolated agent context is helpful, and keep each delegated task focused."],
		parameters: P4J_SUBAGENT_PARAMS,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = runP4jSubagent(params.agent, params.task, ctx.cwd);
			return {
				content: [{ type: "text", text: formatSubagentResult(result) }],
				details: { agent: result.agent, task: result.task, ok: result.ok, status: result.status, output: result.output },
				isError: !result.ok,
			};
		},
	});

	pi.on("input", (event) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}
		const transformed = transformKeywordInput(event.text);
		return transformed ? { action: "transform", text: transformed, images: event.images } : { action: "continue" };
	});

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

	pi.registerCommand("p4j:agents", {
		description: "Show p4j agent roster",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatAgentCatalog(), "info");
		},
	});

	pi.registerCommand("p4j:route", {
		description: "Recommend p4j agents for a request",
		handler: async (args, ctx) => {
			ctx.ui.notify(formatAgentRoute(args), "info");
		},
	});

	pi.registerCommand("p4j:delegate", {
		description: "Delegate a task to a p4j agent via p4j_subagent",
		handler: async (args, ctx) => {
			const request = parseDelegateArgs(args);
			if (request.error || !request.agent || !request.task) {
				ctx.ui.notify(request.error ?? "Usage: /p4j:delegate [--dry-run] <agent> <task>", "warning");
				return;
			}
			const prompt = formatDelegatePrompt(request.agent, request.task);
			if (request.dryRun) {
				ctx.ui.notify(prompt, "info");
				return;
			}
			pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			ctx.ui.notify(`Queued p4j delegate: ${request.agent}`, "info");
		},
	});

	pi.registerCommand("p4j:workflow", {
		description: "Queue a p4j multi-agent workflow prompt",
		handler: async (args, ctx) => {
			const [name, ...taskParts] = splitCommandArgs(args);
			const prompt = formatWorkflowPrompt(name ?? "", taskParts.join(" "));
			if (prompt.startsWith("Usage:")) {
				ctx.ui.notify(prompt, "warning");
				return;
			}
			pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			ctx.ui.notify(`Queued p4j workflow: ${name}`, "info");
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
