import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { getP4jHelp, preflight, resolveP4jPaths, withP4jLayer } from "../src/cli.js";

const layerPath = "/repo/p4j";
const packageRoot = resolve(import.meta.dirname, "..");
const workflowModes = ["quick", "think", "search", "plan", "build", "review", "ship", "team", "ulw"];

test("injects the p4j layer for normal Pi arguments", () => {
	assert.deepEqual(withP4jLayer(["hello"], layerPath), ["-e", layerPath, "hello"]);
});

test("resolves paths from the installed package location instead of cwd", () => {
	const originalCwd = process.cwd();
	const foreignCwd = mkdtempSync(resolve(tmpdir(), "p4j-foreign-cwd-"));
	const installRoot = mkdtempSync(resolve(tmpdir(), "p4j-install-"));
	const tempPackageRoot = resolve(installRoot, "packages", "p4j");
	const distDir = resolve(tempPackageRoot, "dist");
	mkdirSync(distDir, { recursive: true });
	const cliPath = resolve(distDir, "cli.js");
	writeFileSync(cliPath, "");

	try {
		process.chdir(foreignCwd);
		const paths = resolveP4jPaths(pathToFileURL(cliPath).href);
		const realInstallRoot = realpathSync(installRoot);
		const realPackageRoot = resolve(realInstallRoot, "packages", "p4j");
		assert.equal(paths.packageRoot, realPackageRoot);
		assert.equal(paths.repoRoot, realInstallRoot);
		assert.equal(paths.tsxBin, resolve(realInstallRoot, "node_modules", ".bin", "tsx"));
		assert.equal(paths.piCli, resolve(realInstallRoot, "packages", "coding-agent", "src", "cli.ts"));
		assert.equal(paths.layerPath, resolve(realInstallRoot, "p4j"));
	} finally {
		process.chdir(originalCwd);
	}
});

test("reports p4j v0.8.1 from the package binary", () => {
	const version = spawnSync("node", ["dist/cli.js", "--version"], { cwd: packageRoot, encoding: "utf8" });
	assert.equal(version.status, 0);
	assert.equal(version.stdout.trim(), "0.8.1");
});

test("maps p4j workflow modes to prompt template commands", () => {
	for (const mode of workflowModes) {
		assert.deepEqual(withP4jLayer([mode, "do", "it"], layerPath), ["-e", layerPath, `/${mode}`, "do it"]);
	}
});

test("maps p4j local operations to p4j extension commands", () => {
	assert.deepEqual(withP4jLayer(["status"], layerPath), ["-e", layerPath, "/p4j:status"]);
	assert.deepEqual(withP4jLayer(["active"], layerPath), ["-e", layerPath, "/p4j:active"]);
	assert.deepEqual(withP4jLayer(["local"], layerPath), ["-e", layerPath, "/p4j:local"]);
	assert.deepEqual(withP4jLayer(["hints"], layerPath), ["-e", layerPath, "/p4j:hints"]);
	assert.deepEqual(withP4jLayer(["stop-models"], layerPath), ["-e", layerPath, "/p4j:stop-models"]);
	assert.deepEqual(withP4jLayer(["stop-models", "--apply", "--pid", "123"], layerPath), [
		"-e",
		layerPath,
		"/p4j:stop-models --apply --pid 123",
	]);
});

test("passes Pi management commands through without injecting the p4j layer", () => {
	for (const command of ["install", "remove", "uninstall", "update", "list", "config"]) {
		assert.deepEqual(withP4jLayer([command, "--help"], layerPath), [command, "--help"]);
	}
});

test("allows direct Pi passthrough with the pi escape command", () => {
	assert.deepEqual(withP4jLayer(["pi", "--help"], layerPath), ["--help"]);
});

test("documents install and linked usage in help", () => {
	const help = getP4jHelp();
	for (const mode of workflowModes) {
		assert.match(help, new RegExp(`p4j ${mode}`));
	}
	assert.match(help, /npm install/);
	assert.match(help, /npm run build --workspace packages\/p4j/);
	assert.match(help, /p4j --help/);
	assert.match(help, /p4j --version/);
	assert.match(help, /Show this help before preflight from any cwd/);
	assert.match(help, /These flags work even in linked checkouts before preflight runs\./);
	assert.match(help, /npm link --workspace packages\/p4j/);
	assert.match(help, /p4j status/);
	assert.match(help, /p4j active/);
	assert.match(help, /p4j local/);
	assert.match(help, /p4j hints/);
	assert.match(help, /Show manual model routing hints from the current registry/);
	assert.match(help, /p4j stop-models/);
	assert.match(help, /Dry-run model\/process candidates without stopping anything/);
	assert.match(help, /p4j stop-models --apply --pid <pid>/);
	assert.match(help, /Stop one candidate after interactive confirmation/);
	assert.match(help, /p4j pi --help/);
});

test("shows the linked-usage guidance when preflight dependencies are missing", () => {
	const tempRoot = mkdtempSync(resolve(tmpdir(), "p4j-preflight-"));
	assert.throws(
		() =>
			preflight({
				packageRoot: resolve(tempRoot, "packages", "p4j"),
				repoRoot: tempRoot,
				tsxBin: resolve(tempRoot, "node_modules", ".bin", "tsx"),
				piCli: resolve(tempRoot, "packages", "coding-agent", "src", "cli.ts"),
				layerPath: resolve(tempRoot, "packages", "p4j", "p4j"),
			}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /Missing tsx binary:/);
			assert.match(error.message, /Missing Pi source CLI:/);
			assert.match(error.message, /Missing p4j resource layer:/);
			assert.match(error.message, /installed p4j package location/i);
			assert.match(error.message, /npm install/);
			assert.match(error.message, /npm run build --workspace packages\/p4j/);
			assert.match(error.message, /npm link --workspace packages\/p4j/);
			return true;
		},
	);
});

test("runs the package binary from outside the repo cwd", () => {
	const foreignCwd = mkdtempSync(resolve(tmpdir(), "p4j-cli-cwd-"));
	const version = spawnSync("node", [resolve(packageRoot, "dist", "cli.js"), "--version"], {
		cwd: foreignCwd,
		encoding: "utf8",
	});
	assert.equal(version.status, 0);
	assert.equal(version.stdout.trim(), "0.8.1");
});

test("runs through a linked package binary symlink for help", () => {
	const foreignCwd = mkdtempSync(resolve(tmpdir(), "p4j-linked-cwd-"));
	const binDir = mkdtempSync(resolve(tmpdir(), "p4j-linked-bin-"));
	const linkedBin = resolve(binDir, "p4j");
	symlinkSync(resolve(packageRoot, "dist", "cli.js"), linkedBin);

	const help = spawnSync("node", [linkedBin, "--help"], {
		cwd: foreignCwd,
		encoding: "utf8",
	});
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Install \/ linked usage:/);
	assert.match(help.stdout, /Linked binaries resolve the package files from the installed package location\./);
	assert.match(help.stdout, /Show this help before preflight from any cwd/);
});
