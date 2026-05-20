import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const VERSION = "0.4";
const WORKFLOWS = "quick, think, search, plan, build, review, ship, local, team, ulw";
const STOP_MODEL_PATTERNS = ["ollama", "cmux", "node.*model", "node.*provider"];

function runReadOnly(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 3000 });
	if (result.error) {
		return `unavailable (${result.error.message})`;
	}
	const output = `${result.stdout}${result.stderr}`.trim();
	return output.length > 0 ? output : `exit ${result.status ?? 0}`;
}

function firstLine(value: string): string {
	return value.split("\n")[0]?.trim() || "unavailable";
}

function formatBytes(bytes: number): string {
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function readActiveState(cwd: string): string {
	const statePath = resolve(cwd, ".p4j", "active.json");
	if (!existsSync(statePath)) {
		return `state: missing ${statePath}`;
	}
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8")) as { version?: unknown; status?: unknown; updatedAt?: unknown };
		return [`state: ${statePath}`, `version: ${String(state.version ?? "unknown")}`, `status: ${String(state.status ?? "unknown")}`, `updatedAt: ${String(state.updatedAt ?? "unknown")}`].join("\n");
	} catch (error) {
		return `state: unreadable (${error instanceof Error ? error.message : String(error)})`;
	}
}

function getActiveReport(ctx: ExtensionCommandContext): string {
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
	const usage = ctx.getContextUsage();
	return [
		"p4j active",
		`cwd: ${ctx.cwd}`,
		`model: ${model}`,
		`idle: ${ctx.isIdle()}`,
		`pendingMessages: ${ctx.hasPendingMessages()}`,
		`context: ${usage ? `${usage.percent ?? 0}%/${usage.tokens ?? 0}` : "unknown"}`,
		readActiveState(ctx.cwd),
	].join("\n");
}

function getLocalReport(cwd: string): string {
	const memory = `${formatBytes(freemem())} free / ${formatBytes(totalmem())} total`;
	return [
		"p4j local diagnostics (read-only)",
		`cwd: ${cwd}`,
		`git: ${firstLine(runReadOnly("git", ["status", "--short", "--branch"], cwd))}`,
		`node: ${firstLine(runReadOnly("node", ["--version"], cwd))}`,
		`npm: ${firstLine(runReadOnly("npm", ["--version"], cwd))}`,
		`tmux: ${firstLine(runReadOnly("tmux", ["-V"], cwd))}`,
		`ollama: ${firstLine(runReadOnly("pgrep", ["-fl", "ollama"], cwd))}`,
		`cmux: ${firstLine(runReadOnly("pgrep", ["-fl", "cmux"], cwd))}`,
		`memory: ${memory}`,
		`disk: ${firstLine(runReadOnly("df", ["-h", cwd], cwd))}`,
	].join("\n");
}

function getStopModelsDryRun(cwd: string): string {
	const candidates = STOP_MODEL_PATTERNS.map((pattern) => {
		const result = runReadOnly("pgrep", ["-fl", pattern], cwd);
		const found = result !== "exit 1" && !result.startsWith("unavailable");
		return `${pattern}: ${found ? result : "none"}`;
	});
	return [
		"p4j stop-models dry-run",
		"No processes were stopped.",
		"Candidates:",
		...candidates,
		"Next: actual stopping remains deferred behind a separate explicit safety design.",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus("p4j", `p4j v${VERSION}`);
		const theme = ctx.ui.getTheme("p4j");
		if (theme) {
			ctx.ui.setTheme(theme);
		}
	});

	pi.registerCommand("p4j:status", {
		description: "Show p4j layer status and available workflows",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`p4j v${VERSION} loaded: ${WORKFLOWS}`, "info");
		},
	});

	pi.registerCommand("p4j:active", {
		description: "Show read-only p4j active state",
		handler: async (_args, ctx) => {
			ctx.ui.notify(getActiveReport(ctx), "info");
		},
	});

	pi.registerCommand("p4j:local", {
		description: "Show read-only local diagnostics",
		handler: async (_args, ctx) => {
			ctx.ui.notify(getLocalReport(ctx.cwd), "info");
		},
	});

	pi.registerCommand("p4j:stop-models", {
		description: "Dry-run model/process candidates without stopping anything",
		handler: async (_args, ctx) => {
			ctx.ui.notify(getStopModelsDryRun(ctx.cwd), "warning");
		},
	});
}
