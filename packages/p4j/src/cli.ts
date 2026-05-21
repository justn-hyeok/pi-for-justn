#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const P4J_MODES = new Set(["quick", "think", "search", "plan", "build", "review", "ship", "team", "ulw"]);
const P4J_COMMANDS = new Map([
	["status", "/p4j:status"],
	["active", "/p4j:active"],
	["local", "/p4j:local"],
	["hints", "/p4j:hints"],
	["stop-models", "/p4j:stop-models"],
]);
const PI_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

type ResolvedP4jPaths = {
	packageRoot: string;
	repoRoot: string;
	tsxBin: string;
	piCli: string;
	layerPath: string;
};

function getPackageRoot(moduleUrl = import.meta.url): string {
	const cliPath = realpathSync(fileURLToPath(moduleUrl));
	return resolve(dirname(cliPath), "..");
}

export function resolveP4jPaths(moduleUrl = import.meta.url): ResolvedP4jPaths {
	const packageRoot = getPackageRoot(moduleUrl);
	const repoRoot = resolve(packageRoot, "..", "..");
	return {
		packageRoot,
		repoRoot,
		tsxBin: resolve(repoRoot, "node_modules", ".bin", "tsx"),
		piCli: resolve(repoRoot, "packages", "coding-agent", "src", "cli.ts"),
		layerPath: resolve(repoRoot, "p4j"),
	};
}

function getPackageVersion(): string {
	const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
	if (typeof packageJson.version !== "string") {
		throw new Error(`Missing package version in ${packageJsonPath}`);
	}
	return packageJson.version;
}

export function getP4jHelp(): string {
	return `p4j ${getPackageVersion()} - personal Pi wrapper

Usage:
  p4j [pi options] [@files...] [messages...]
  p4j <quick|think|search|plan|build|review|ship|team|ulw> <task>
  p4j <status|active|local|hints|stop-models> [args...]
  p4j <pi command> [args...]

Install / linked usage:
  npm install
  npm run build --workspace packages/p4j   Build dist before linking from source
  npm link --workspace packages/p4j        Link p4j for use from any cwd

Workflow shortcuts:
  p4j quick <task>   Run /quick for small bounded work
  p4j think <topic>   Run /think for analysis before action
  p4j search <query>  Run /search with bounded local-first search
  p4j plan <goal>     Run /plan and stop before implementation
  p4j build <task>    Run /build for implementation-focused work
  p4j review <target> Run /review with concise verification focus
  p4j ship <target>   Run /ship for release/checklist planning
  p4j team <goal>     Run /team for a lightweight team-mode plan
  p4j ulw <task>      Run /ulw with bounded end-to-end instructions

Local stubs:
  p4j status          Show loaded p4j workflows
  p4j active          Show read-only p4j active state
  p4j local           Show read-only local diagnostics
  p4j hints           Show model routing hints from the current registry
  p4j stop-models     Dry-run model/process candidates without stopping anything
  p4j stop-models --apply --pid <pid>
                       Stop one candidate after interactive confirmation

All other arguments pass through to Pi with the p4j resource layer loaded.
Use 'p4j pi --help' to show the underlying Pi help.`;
}

export function preflight(paths: ResolvedP4jPaths = resolveP4jPaths()): ResolvedP4jPaths {
	const missing = [
		[paths.tsxBin, "tsx binary"],
		[paths.piCli, "Pi source CLI"],
		[paths.layerPath, "p4j resource layer"],
	].filter(([path]) => !existsSync(path));
	if (missing.length > 0) {
		const details = missing.map(([path, label]) => `- Missing ${label}: ${path}`).join("\n");
		throw new Error(
			`${details}\n\n` +
				"This wrapper resolves files from the installed p4j package location, not the current working directory.\n" +
				"Install dependencies with `npm install`.\n" +
				"If `dist/cli.js` is missing in a linked checkout, run `npm run build --workspace packages/p4j`.\n" +
				"For outside-repo usage, link the package from the pi checkout with `npm link --workspace packages/p4j`.",
		);
	}
	return paths;
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

function isEntrypoint(): boolean {
	return (
		process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
	);
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
		const paths = preflight();
		const result = spawnSync(paths.tsxBin, [paths.piCli, ...withP4jLayer(args, paths.layerPath)], {
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

if (isEntrypoint()) {
	process.exit(main(process.argv.slice(2)));
}
