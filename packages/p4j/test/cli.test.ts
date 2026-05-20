import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { getP4jHelp, withP4jLayer } from "../src/cli.js";

const layerPath = "/repo/p4j";
const packageRoot = resolve(import.meta.dirname, "..");
const workflowModes = ["quick", "think", "search", "plan", "build", "review", "ship", "team", "ulw"];

test("injects the p4j layer for normal Pi arguments", () => {
	assert.deepEqual(withP4jLayer(["hello"], layerPath), ["-e", layerPath, "hello"]);
});

test("reports p4j v0.5 from the package binary", () => {
	const version = spawnSync("node", ["dist/cli.js", "--version"], { cwd: packageRoot, encoding: "utf8" });
	assert.equal(version.status, 0);
	assert.equal(version.stdout.trim(), "0.5.0");
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

test("documents p4j shortcuts in help", () => {
	const help = getP4jHelp();
	for (const mode of workflowModes) {
		assert.match(help, new RegExp(`p4j ${mode}`));
	}
	assert.match(help, /p4j status/);
	assert.match(help, /p4j active/);
	assert.match(help, /p4j local/);
	assert.match(help, /p4j stop-models/);
	assert.match(help, /Dry-run model\/process candidates without stopping anything/);
	assert.match(help, /p4j stop-models --apply --pid <pid>/);
	assert.match(help, /Stop one candidate after interactive confirmation/);
	assert.match(help, /p4j pi --help/);
});

test("only treats leading help and version flags as p4j flags", () => {
	const installHelp = spawnSync("node", ["dist/cli.js", "install", "--help"], { cwd: packageRoot, encoding: "utf8" });
	assert.equal(installHelp.status, 0);
	assert.match(installHelp.stdout, /pi install <source>/);
	assert.doesNotMatch(installHelp.stdout, /p4j quick/);
});
