import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

test("resolves paths from a symlinked cli entrypoint using the real package root", () => {
	const installRoot = mkdtempSync(resolve(tmpdir(), "p4j-install-"));
	const tempPackageRoot = resolve(installRoot, "packages", "p4j");
	const distDir = resolve(tempPackageRoot, "dist");
	mkdirSync(distDir, { recursive: true });
	const realCliPath = resolve(distDir, "cli.js");
	copyFileSync(resolve(packageRoot, "dist", "cli.js"), realCliPath);
	chmodSync(realCliPath, 0o755);
	const symlinkParent = mkdtempSync(resolve(tmpdir(), "p4j-symlink-parent-"));
	const symlinkToCli = resolve(symlinkParent, "cli-link.js");
	symlinkSync(realCliPath, symlinkToCli);

	const paths = resolveP4jPaths(pathToFileURL(symlinkToCli).href);
	const realInstallRoot = realpathSync(installRoot);
	const realPackageRoot = resolve(realInstallRoot, "packages", "p4j");
	assert.equal(paths.packageRoot, realPackageRoot);
	assert.equal(paths.repoRoot, realInstallRoot);
	assert.equal(paths.tsxBin, resolve(realInstallRoot, "node_modules", ".bin", "tsx"));
	assert.equal(paths.piCli, resolve(realInstallRoot, "packages", "coding-agent", "src", "cli.ts"));
	assert.equal(paths.layerPath, resolve(realInstallRoot, "p4j"));
	assert.notEqual(paths.packageRoot, symlinkParent);
});

test("reports p4j v0.8.1 from the package binary", () => {
	const version = spawnSync("node", ["dist/cli.js", "--version"], { cwd: packageRoot, encoding: "utf8" });
	assert.equal(version.status, 0);
	assert.equal(version.error, undefined);
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
	const tsxBin = resolve(tempRoot, "node_modules", ".bin", "tsx");
	const piCli = resolve(tempRoot, "packages", "coding-agent", "src", "cli.ts");
	const layerPath = resolve(tempRoot, "p4j");
	mkdirSync(resolve(tempRoot, "node_modules", ".bin"), { recursive: true });
	mkdirSync(resolve(tempRoot, "packages", "coding-agent", "src"), { recursive: true });
	writeFileSync(tsxBin, "");
	writeFileSync(piCli, "");

	assert.throws(
		() =>
			preflight({
				packageRoot: resolve(tempRoot, "packages", "p4j"),
				repoRoot: tempRoot,
				tsxBin,
				piCli,
				layerPath,
			}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /Missing p4j resource layer:/);
			assert.doesNotMatch(error.message, /Missing tsx binary:/);
			assert.doesNotMatch(error.message, /Missing Pi source CLI:/);
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
	assert.equal(version.error, undefined);
	assert.equal(version.stdout.trim(), "0.8.1");
});

test("runs through a linked package binary symlink for help", () => {
	const foreignCwd = mkdtempSync(resolve(tmpdir(), "p4j linked cwd with spaces -"));
	const binDir = mkdtempSync(resolve(tmpdir(), "p4j-linked-bin-"));
	const linkedBin = resolve(binDir, "p4j");
	symlinkSync(resolve(packageRoot, "dist", "cli.js"), linkedBin);

	const help = spawnSync("node", [linkedBin, "--help"], {
		cwd: foreignCwd,
		encoding: "utf8",
	});
	assert.equal(help.status, 0);
	assert.equal(help.error, undefined);
	assert.match(help.stdout, /Install \/ linked usage:/);
	assert.match(help.stdout, /Linked binaries resolve the package files from the installed package location\./);
	assert.match(help.stdout, /Show this help before preflight from any cwd/);
});

if (process.platform !== "win32") {
	test("supports direct executable symlink invocation for help and version", () => {
		const foreignCwd = mkdtempSync(resolve(tmpdir(), "p4j exec cwd with spaces -"));
		const binDir = mkdtempSync(resolve(tmpdir(), "p4j-exec-bin-"));
		const linkedBin = resolve(binDir, "p4j");
		symlinkSync(resolve(packageRoot, "dist", "cli.js"), linkedBin);

		const help = spawnSync(linkedBin, ["--help"], {
			cwd: foreignCwd,
			encoding: "utf8",
		});
		assert.equal(help.status, 0);
		assert.equal(help.error, undefined);
		assert.match(help.stdout, /Show this help before preflight from any cwd/);

		const version = spawnSync(linkedBin, ["--version"], {
			cwd: foreignCwd,
			encoding: "utf8",
		});
		assert.equal(version.status, 0);
		assert.equal(version.error, undefined);
		assert.equal(version.stdout.trim(), "0.8.1");
	});
}

test("bypasses preflight for help and version in a temp package layout", () => {
	const tempRoot = mkdtempSync(resolve(tmpdir(), "p4j temp package -"));
	const tempPackageRoot = resolve(tempRoot, "packages", "p4j");
	const tempDist = resolve(tempPackageRoot, "dist");
	mkdirSync(tempDist, { recursive: true });
	const cliPath = resolve(tempDist, "cli.js");
	const packageJsonPath = resolve(tempPackageRoot, "package.json");
	copyFileSync(resolve(packageRoot, "dist", "cli.js"), cliPath);
	chmodSync(cliPath, 0o755);
	writeFileSync(packageJsonPath, JSON.stringify({ version: "0.8.1", type: "module" }, null, 2));

	const helpCwd = mkdtempSync(resolve(tmpdir(), "p4j help cwd with spaces -"));
	const help = spawnSync("node", [cliPath, "--help"], {
		cwd: helpCwd,
		encoding: "utf8",
	});
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Install \/ linked usage:/);
	assert.match(help.stdout, /Show this help before preflight from any cwd/);
	assert.equal(help.stderr, "");

	const versionCwd = mkdtempSync(resolve(tmpdir(), "p4j version cwd with spaces -"));
	const version = spawnSync("node", [cliPath, "--version"], {
		cwd: versionCwd,
		encoding: "utf8",
	});
	assert.equal(version.status, 0);
	assert.equal(version.stdout.trim(), "0.8.1");
	assert.equal(version.stderr, "");

	const failureCwd = mkdtempSync(resolve(tmpdir(), "p4j command cwd with spaces -"));
	const failure = spawnSync("node", [cliPath, "hello"], {
		cwd: failureCwd,
		encoding: "utf8",
	});
	assert.equal(failure.status, 1);
	assert.equal(failure.error, undefined);
	assert.match(failure.stderr, /Missing tsx binary:/);
	assert.match(failure.stderr, /Missing Pi source CLI:/);
	assert.match(failure.stderr, /Missing p4j resource layer:/);
	assert.match(failure.stderr, /outside-repo usage/i);
	assert.match(failure.stderr, /npm link --workspace packages\/p4j/);
});

test("preserves leading flags, @file args, pi escape args, and local command args", () => {
	assert.deepEqual(withP4jLayer(["--verbose", "@task.md", "hello"], layerPath), [
		"-e",
		layerPath,
		"--verbose",
		"@task.md",
		"hello",
	]);
	assert.deepEqual(withP4jLayer(["pi", "--help", "@keep"], layerPath), ["--help", "@keep"]);
	assert.deepEqual(withP4jLayer(["status", "--json", "@status.md", "extra"], layerPath), [
		"-e",
		layerPath,
		"/p4j:status --json @status.md extra",
	]);
});
