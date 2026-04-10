import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

type PluginContractFixture = {
  pluginModule: string;
  expectedPackageName: string;
  expectedCliSubcommands: string[];
  expectedPluginHelpSnippets: string[];
  requiredPluginArtifacts: string[];
};

const fixturePath = path.resolve(process.cwd(), "src/tests/fixtures/opencode-plugin-contract.json");

async function loadFixture(): Promise<PluginContractFixture> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as PluginContractFixture;
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runShell(command: string) {
  const result = spawnSync("bash", ["-lc", command], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function resolveNodeInstallPrefix(opencodeBinary: string): string {
  return path.resolve(opencodeBinary, "..", "..");
}

test("local OpenCode runtime exposes npm-module plugin installation", async () => {
  const fixture = await loadFixture();
  const which = run("which", ["opencode"]);
  assert.equal(which.status, 0);

  const opencodePath = which.stdout.trim();
  assert.ok(opencodePath.length > 0, "opencode binary should resolve in PATH");

  const help = runShell("opencode --help 2>&1");
  assert.equal(help.status, 0);
  const helpText = help.stdout;
  for (const snippet of fixture.expectedCliSubcommands) {
    assert.match(helpText, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const pluginHelp = runShell("opencode plugin --help 2>&1");
  assert.equal(pluginHelp.status, 0);
  const pluginHelpText = pluginHelp.stdout;
  for (const snippet of fixture.expectedPluginHelpSnippets) {
    assert.match(pluginHelpText, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const nodePrefix = resolveNodeInstallPrefix(opencodePath);
  const pluginRoot = path.join(nodePrefix, "lib", "node_modules", fixture.pluginModule);
  const pluginPackageJson = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8")) as {
    name?: string;
  };

  assert.equal(pluginPackageJson.name, fixture.expectedPackageName);

  for (const relativeArtifact of fixture.requiredPluginArtifacts) {
    await access(path.join(pluginRoot, relativeArtifact));
  }
});

test("unsupported local plugin seam is detected when required artifact is missing", async () => {
  const fixture = await loadFixture();
  const which = run("which", ["opencode"]);
  assert.equal(which.status, 0);

  const opencodePath = which.stdout.trim();
  const nodePrefix = resolveNodeInstallPrefix(opencodePath);
  const pluginRoot = path.join(nodePrefix, "lib", "node_modules", fixture.pluginModule);
  const missingArtifact = path.join(pluginRoot, "dist", "definitely-missing-artifact.js");

  await assert.rejects(() => access(missingArtifact));
});
