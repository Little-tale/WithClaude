import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installOpenCodeWithClaude } from "../install.js";

test("installer creates baseline OpenCode config and bundled assets in a new project", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-new-"));

  const output = await installOpenCodeWithClaude({ cwd, force: false });

  const opencodeConfig = await readFile(path.join(cwd, "opencode.jsonc"), "utf8");
  const roleConfig = await readFile(path.join(cwd, ".opencode", "opencode-with-claude.jsonc"), "utf8");
  const agentPrompt = await readFile(path.join(cwd, ".opencode", "agents", "planClaude.md"), "utf8");

  assert.match(output, /Created project config: opencode\.jsonc/);
  assert.match(opencodeConfig, /"npm": "opencode-with-claude"/);
  assert.match(roleConfig, /"claudeCli"/);
  assert.match(agentPrompt, /run_claude_plan/);
});

test("installer preserves existing opencode.jsonc and writes a merge snippet", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentwf-install-existing-"));
  const existingConfigPath = path.join(cwd, "opencode.jsonc");
  await writeFile(existingConfigPath, '{"existing":true}\n', "utf8");

  const output = await installOpenCodeWithClaude({ cwd, force: false });

  const existingConfig = await readFile(existingConfigPath, "utf8");
  const snippet = await readFile(path.join(cwd, "opencode-with-claude.snippet.jsonc"), "utf8");

  assert.equal(existingConfig, '{"existing":true}\n');
  assert.match(output, /Existing opencode\.jsonc preserved/);
  assert.match(snippet, /"with-claude"/);
});

test("built installer entrypoint keeps a node shebang", async () => {
  const builtInstaller = await readFile(path.join(process.cwd(), "dist", "cli.js"), "utf8");
  assert.match(builtInstaller, /^#!\/usr\/bin\/env node/);
});
