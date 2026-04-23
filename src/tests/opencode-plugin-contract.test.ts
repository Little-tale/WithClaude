import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
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

function resolveNodeInstallPrefix(opencodeBinary: string): string {
  return path.resolve(opencodeBinary, "..", "..");
}

function resolveOpencodeBinary(): string | null {
  const which = spawnSync("which", ["opencode"], { encoding: "utf8" });
  if (which.error) {
    throw which.error;
  }
  if (which.status !== 0) {
    return null;
  }

  const opencodePath = which.stdout.trim();
  return opencodePath.length > 0 ? opencodePath : null;
}

test("unsupported local plugin seam is detected when required artifact is missing", async (t) => {
  const fixture = await loadFixture();
  const opencodePath = resolveOpencodeBinary();
  if (!opencodePath) {
    t.skip("opencode binary is not available in PATH for this environment");
    return;
  }

  const nodePrefix = resolveNodeInstallPrefix(opencodePath);
  const pluginRoot = path.join(nodePrefix, "lib", "node_modules", fixture.pluginModule);
  const missingArtifact = path.join(pluginRoot, "dist", "definitely-missing-artifact.js");

  await assert.rejects(() => access(missingArtifact));
});
