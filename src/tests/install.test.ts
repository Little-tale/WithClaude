import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installOpenCodeWithClaude, parseArgs } from "../install.js";

test("installer creates baseline OpenCode config and bundled assets in a new project", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-new-"));

  const output = await installOpenCodeWithClaude({ configDir, force: false });

  const opencodeConfig = await readFile(path.join(configDir, "opencode.json"), "utf8");
  const roleConfig = await readFile(path.join(configDir, ".opencode", "opencode-with-claude.jsonc"), "utf8");
  const commandPrompt = await readFile(path.join(configDir, ".opencode", "command", "planClaude.md"), "utf8");
  const designCommandPrompt = await readFile(path.join(configDir, ".opencode", "command", "designGemini.md"), "utf8");
  const pluginPackageJson = await readFile(path.join(configDir, "package.json"), "utf8");
  const pluginShim = await readFile(path.join(configDir, "plugins", "with-claude-plugin.mjs"), "utf8");

  assert.match(output, /Installed @little_tale\/opencode-with-claude into global OpenCode config/);
  assert.match(opencodeConfig, /"npm": "@little_tale\/opencode-with-claude"/);
  assert.match(opencodeConfig, /"with-gemini"/);
  assert.match(opencodeConfig, /Runtime-managed designGemini prompt/);
  assert.match(opencodeConfig, /Runtime-managed planClaude prompt/);
  assert.match(roleConfig, /Optional user overrides only/);
  assert.match(roleConfig, /"geminiCli"/);
  assert.match(commandPrompt, /@planClaude/);
  assert.match(designCommandPrompt, /@designGemini/);
  assert.match(pluginPackageJson, /"@little_tale\/opencode-with-claude": "latest"/);
  assert.match(pluginShim, /@little_tale\/opencode-with-claude\/plugin/);
});

test("installer preserves existing global config fields while merging with-claude setup", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-existing-"));
  const existingConfigPath = path.join(configDir, "opencode.json");
  await writeFile(existingConfigPath, '{"existing":true}\n', "utf8");

  const output = await installOpenCodeWithClaude({ configDir, force: false });

  const existingConfig = await readFile(existingConfigPath, "utf8");

  assert.match(existingConfig, /"existing": true/);
  assert.match(existingConfig, /"with-claude"/);
  assert.match(output, /Updated global config: opencode\.json/);
});

test("installer default config dir honors XDG_CONFIG_HOME", async () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-xdg-"));
  process.env.XDG_CONFIG_HOME = xdgConfigHome;

  try {
    const parsed = parseArgs(["install"]);
    assert.equal(parsed.configDir, path.join(xdgConfigHome, "opencode"));
  } finally {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  }
});

test("installer default config dir honors OPENCODE_CONFIG_DIR before XDG_CONFIG_HOME", async () => {
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configDir = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-configdir-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-xdg-priority-"));
  process.env.OPENCODE_CONFIG_DIR = configDir;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;

  try {
    const parsed = parseArgs(["install"]);
    assert.equal(parsed.configDir, configDir);
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
    }

    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  }
});

test("built installer entrypoint keeps a node shebang", async () => {
  const builtInstaller = await readFile(path.join(process.cwd(), "dist", "cli.js"), "utf8");
  assert.match(builtInstaller, /^#!\/usr\/bin\/env node/);
});
