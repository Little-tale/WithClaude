import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";

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

function resolveOpencodeBinary(): string | null {
  const which = run("which", ["opencode"]);
  if (which.status !== 0) {
    return null;
  }

  const opencodePath = which.stdout.trim();
  return opencodePath.length > 0 ? opencodePath : null;
}

async function resolveInstalledPluginRoot(t: TestContext, fixture: PluginContractFixture): Promise<string | null> {
  const opencodePath = resolveOpencodeBinary();
  if (!opencodePath) {
    t.skip("opencode binary is not available in PATH for this environment");
    return null;
  }

  const nodePrefix = resolveNodeInstallPrefix(opencodePath);
  const pluginRoot = path.join(nodePrefix, "lib", "node_modules", fixture.pluginModule);
  try {
    await access(path.join(pluginRoot, "package.json"));
    return pluginRoot;
  } catch {
    t.skip(`${fixture.pluginModule} is not installed next to the resolved opencode binary`);
    return null;
  }
}

test("local OpenCode runtime exposes npm-module plugin installation", async (t) => {
  const fixture = await loadFixture();
  const pluginRoot = await resolveInstalledPluginRoot(t, fixture);
  if (!pluginRoot) {
    return;
  }

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

  const pluginPackageJson = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8")) as {
    name?: string;
  };

  assert.equal(pluginPackageJson.name, fixture.expectedPackageName);

  for (const relativeArtifact of fixture.requiredPluginArtifacts) {
    await access(path.join(pluginRoot, relativeArtifact));
  }
});

test("unsupported local plugin seam is detected when required artifact is missing", async (t) => {
  const fixture = await loadFixture();
  const pluginRoot = await resolveInstalledPluginRoot(t, fixture);
  if (!pluginRoot) {
    return;
  }

  const missingArtifact = path.join(pluginRoot, "dist", "definitely-missing-artifact.js");

  await assert.rejects(() => access(missingArtifact));
});
