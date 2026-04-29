import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

function stripJsoncComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const execFileAsync = promisify(execFile);

test("opencode.example.jsonc declares portable provider config and binds Claude agents to it", async () => {
  const raw = await readFile(path.join(process.cwd(), "opencode.example.jsonc"), "utf8");
  const parsed = JSON.parse(stripJsoncComments(raw)) as {
    provider?: Record<string, { npm?: string; models?: Record<string, unknown>; options?: Record<string, unknown> }>;
    agent?: Record<string, { model?: string }>;
  };

  assert.ok(parsed.provider?.["with-claude"]);
  const npmSpec = parsed.provider?.["with-claude"]?.npm;
  assert.equal(npmSpec, "@little_tale/opencode-with-claude");
  assert.doesNotMatch(raw, /file:\/\/\/Users\//);
  assert.doesNotMatch(raw, /\/Users\/[^/]+\//);
  assert.deepEqual(Object.keys(parsed.provider?.["with-claude"]?.models ?? {}).sort(), ["haiku", "opus", "sonnet"]);
  assert.equal(parsed.agent?.planClaude?.model, "with-claude/opus");
  assert.equal(parsed.agent?.implClaude?.model, "with-claude/sonnet");
  assert.equal(parsed.agent?.reviewClaude?.model, "with-claude/sonnet");
});

test("local OpenCode setup script generates checkout-specific file provider config", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "withclaude-local-opencode-"));
  await copyFile(path.join(process.cwd(), "opencode.example.jsonc"), path.join(tmp, "opencode.example.jsonc"));
  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "scripts", "setup-local-opencode.mjs")
  ], { cwd: tmp });

  const raw = await readFile(path.join(tmp, "opencode.jsonc"), "utf8");
  const parsed = JSON.parse(raw) as {
    provider?: Record<string, { npm?: string }>;
  };
  const expectedDistUrl = pathToFileURL(path.join(await realpath(tmp), "dist", "index.js")).href;
  assert.equal(parsed.provider?.["with-claude"]?.npm, expectedDistUrl);
});
