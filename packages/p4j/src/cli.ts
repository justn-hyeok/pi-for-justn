#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const P4J_MODES = new Set(["quick", "think", "search", "plan", "build", "review", "ship", "team", "ulw"]);
const P4J_COMMANDS = new Map([
	["status", "/p4j:status"],
	["active", "/p4j:active"],
	["local", "/p4j:local"],
	["stop-models", "/p4j:stop-models"],
]);
const PI_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

function getPackageVersion(): string {
	const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
	if (typeof packageJson.version !== "string") {
		throw new Error(`Missing package version in ${packageJsonPath}`);
	}
	return packageJson.version;
}

function getRepoRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function getP4jHelp(): string {
	return `p4j ${getPackageVersion()} - personal Pi wrapper

Usage:
  p4j [pi options] [@files...] [messages...]
  p4j <quick|think|search|plan|build|review|ship|team|ulw> <task>
  p4j <status|active|local|stop-models> [args...]
  p4j <pi command> [args...]

Workflow shortcuts:
  p4j quick <task>   Run /quick for small bounded work
  p4j think <topic>  Run /think for analysis before action
  p4j search <query> Run /search with bounded local-first search
  p4j plan <goal>    Run /plan and stop before implementation
  p4j build <task>   Run /build for implementation-focused work
  p4j review <target> Run /review with concise verification focus
  p4j ship <target>  Run /ship for release/checklist planning
  p4j team <goal>    Run /team for a lightweight team-mode plan
  p4j ulw <task>     Run /ulw with bounded end-to-end instructions

Local stubs:
  p4j status          Show loaded p4j workflows
  p4j active          Show read-only p4j active state
  p4j local           Show read-only local diagnostics
  p4j stop-models     Dry-run model/process candidates without stopping anything
  p4j stop-models --apply --pid <pid>
                       Stop one candidate after interactive confirmation

All other arguments pass through to Pi with the p4j resource layer loaded.
Use 'p4j pi --help' to show the underlying Pi help.`;
}

export function preflight(repoRoot: string): { tsxBin: string; piCli: string; layerPath: string } {
	const tsxBin = resolve(repoRoot, "node_modules", ".bin", "tsx");
	const piCli = resolve(repoRoot, "packages", "coding-agent", "src", "cli.ts");
	const layerPath = resolve(repoRoot, "p4j");
	const missing = [
		[tsxBin, "tsx binary"],
		[piCli, "Pi source CLI"],
		[layerPath, "p4j resource layer"],
	].filter(([path]) => !existsSync(path));
	if (missing.length > 0) {
		const details = missing.map(([path, label]) => `- Missing ${label}: ${path}`).join("\n");
		throw new Error(`${details}\nRun this wrapper from a built pi-for-justn checkout with dependencies installed.`);
	}
	return { tsxBin, piCli, layerPath };
}

export function withP4jLayer(args: string[], layerPath: string): string[] {
	const [first, ...rest] = args;
	if (first === "pi") {
		return rest;
	}
	if (first && PI_COMMANDS.has(first)) {
		return args;
	}
	const layerArgs = ["-e", layerPath];
	const command = first ? P4J_COMMANDS.get(first) : undefined;
	if (command) {
		const commandArgs = rest.join(" ").trim();
		return [...layerArgs, commandArgs.length > 0 ? `${command} ${commandArgs}` : command];
	}
	if (first && P4J_MODES.has(first)) {
		return [...layerArgs, `/${first}`, rest.join(" ").trim()].filter((arg) => arg.length > 0);
	}
	return [...layerArgs, ...args];
}

export function main(args: string[]): number {
	const [first] = args;
	if (first === "--help" || first === "-h") {
		console.log(getP4jHelp());
		return 0;
	}
	if (first === "--version" || first === "-v") {
		console.log(getPackageVersion());
		return 0;
	}

	process.title = "p4j";
	process.env.PI_CODING_AGENT = "true";

	try {
		const { tsxBin, piCli, layerPath } = preflight(getRepoRoot());
		const result = spawnSync(tsxBin, [piCli, ...withP4jLayer(args, layerPath)], {
			stdio: "inherit",
			env: { ...process.env, PI_CODING_AGENT: "true" },
		});
		if (result.error) {
			console.error(`Failed to start p4j: ${result.error.message}`);
			return 1;
		}
		if (result.signal) {
			console.error(`p4j stopped by signal ${result.signal}`);
			return 1;
		}
		return result.status ?? 1;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
