import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const layerRoot = resolve(repoRoot, "p4j");
const workflowPrompts = ["quick", "think", "search", "plan", "build", "review", "ship", "local", "team", "ulw"];
const roleAgents = [
	"orchestrator",
	"hardworker",
	"planner",
	"searcher",
	"researcher",
	"builder",
	"debugger",
	"reviewer",
	"designer",
	"shipper",
	"adviser",
	"checker",
	"worker-son",
	"builder-son",
	"quick-son",
	"searcher-son",
	"reviewer-son",
	"designer-son",
	"shipper-son",
];
const roleSkills = [
	"lead",
	"planner",
	"builder",
	"researcher",
	"scout",
	"reviewer",
	"local",
	"release",
	"designer",
	"debugger",
];

test("p4j package manifest points to existing resources", () => {
	const manifestPath = resolve(layerRoot, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		pi?: { extensions?: string[]; skills?: string[]; prompts?: string[]; themes?: string[] };
	};
	assert.deepEqual(manifest.pi?.extensions, ["./extensions"]);
	assert.deepEqual(manifest.pi?.skills, ["./skills"]);
	assert.deepEqual(manifest.pi?.prompts, ["./prompts"]);
	assert.deepEqual(manifest.pi?.themes, ["./themes"]);
	for (const resource of [
		manifest.pi?.extensions,
		manifest.pi?.skills,
		manifest.pi?.prompts,
		manifest.pi?.themes,
	].flat()) {
		assert.equal(typeof resource, "string");
		assert.equal(existsSync(resolve(layerRoot, resource)), true, `${resource} should exist`);
	}
});

test("p4j theme has all required dark theme color tokens", () => {
	const darkTheme = JSON.parse(
		readFileSync(
			resolve(repoRoot, "packages", "coding-agent", "src", "modes", "interactive", "theme", "dark.json"),
			"utf8",
		),
	) as { colors: Record<string, unknown> };
	const p4jTheme = JSON.parse(readFileSync(resolve(layerRoot, "themes", "p4j.json"), "utf8")) as {
		name?: string;
		colors?: Record<string, unknown>;
	};
	assert.equal(p4jTheme.name, "p4j");
	assert.deepEqual(Object.keys(p4jTheme.colors ?? {}).sort(), Object.keys(darkTheme.colors).sort());
});

test("prompt templates have frontmatter and bodies", () => {
	for (const name of workflowPrompts) {
		const content = readFileSync(resolve(layerRoot, "prompts", `${name}.md`), "utf8");
		assert.match(content, /^---\n/);
		assert.match(content, /description:/);
		assert.match(content, /\$ARGUMENTS/);
	}
});

test("agent definitions have matching names and descriptions", () => {
	const agents = new Set(readdirSync(resolve(layerRoot, "agents")).map((entry) => entry.replace(/\.md$/, "")));
	assert.deepEqual(agents, new Set(roleAgents));
	for (const name of roleAgents) {
		const content = readFileSync(resolve(layerRoot, "agents", `${name}.md`), "utf8");
		assert.match(content, new RegExp(`name: ${name}`));
		assert.match(content, /description:/);
		assert.match(content, /tools:/);
	}
});

test("skills have matching names and descriptions", () => {
	const skills = new Set(readdirSync(resolve(layerRoot, "skills")));
	assert.deepEqual(skills, new Set(roleSkills));
	for (const name of roleSkills) {
		const content = readFileSync(resolve(layerRoot, "skills", name, "SKILL.md"), "utf8");
		assert.match(content, new RegExp(`name: ${name}`));
		assert.match(content, /description:/);
	}
});

test("extension entrypoint uses p4j status and theme without replacing Pi TUI", () => {
	const content = readFileSync(resolve(layerRoot, "extensions", "index.ts"), "utf8");
	assert.match(content, /p4j v\$\{VERSION\}/);
	assert.match(content, /setStatus\("p4j"/);
	assert.match(content, /getTheme\("p4j"\)/);
	assert.match(content, /setTheme\(theme\)/);
	assert.match(content, /p4j:active/);
	assert.match(content, /p4j:local/);
	assert.match(content, /p4j:agents/);
	assert.match(content, /p4j:route/);
	assert.match(content, /read-only local diagnostics/);
	assert.match(content, /p4j stop-models dry-run/);
	assert.match(content, /No processes were stopped/);
	assert.match(content, /STOP_MODEL_PATTERNS/);
	assert.match(content, /--apply --pid <pid>/);
	assert.match(content, /process\.kill\(pid, "SIGTERM"\)/);
	assert.doesNotMatch(content, /spawnSync\("kill"/);
	assert.doesNotMatch(content, /spawnSync\("pkill"/);
	assert.doesNotMatch(content, /spawnSync\("launchctl"/);
	assert.doesNotMatch(content, /setFooter/);
	assert.doesNotMatch(content, /setEditorComponent/);
});

test("p4j active state skeleton exists", () => {
	const activePath = resolve(repoRoot, ".p4j", "active.json");
	const content = readFileSync(activePath, "utf8");
	const active = JSON.parse(content) as {
		version?: unknown;
		status?: unknown;
		event?: unknown;
	};
	assert.equal(active.version, "0.8.1");
	assert.equal(typeof active.status, "string");
	assert.equal(typeof active.event, "string");
});

test("p4j docs and state skeleton exist", () => {
	for (const path of ["docs/ROADMAP.md", "docs/NAMING.md", "docs/USAGE.md", ".p4j/README.md", ".p4j/.gitignore"]) {
		assert.equal(existsSync(resolve(repoRoot, path)), true, `${path} should exist`);
	}
	const stateReadme = readFileSync(resolve(repoRoot, ".p4j", "README.md"), "utf8");
	assert.match(stateReadme, /Do not store secrets/);
	assert.match(stateReadme, /active\.json/);
	assert.match(stateReadme, /--apply --pid <pid>/);
});
