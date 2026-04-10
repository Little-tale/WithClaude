import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function stripJsoncComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("opencode.jsonc declares the with-claude provider and binds Claude agents to it", async () => {
  const raw = await readFile(path.join(process.cwd(), "opencode.jsonc"), "utf8");
  const parsed = JSON.parse(stripJsoncComments(raw)) as {
    provider?: Record<string, { npm?: string; models?: Record<string, unknown>; options?: Record<string, unknown> }>;
    agent?: Record<string, { model?: string }>;
  };

  assert.ok(parsed.provider?.["with-claude"]);
  const npmSpec = parsed.provider?.["with-claude"]?.npm;
  // OpenCode's resolveSDK passes file:// specs directly to Node's import().
  // `file://.` is not a valid import URL — must be `file:///absolute/path/to/file.js`.
  assert.ok(typeof npmSpec === "string" && /^file:\/\/\/.+\/dist\/index\.js$/.test(npmSpec), `npm spec must be an absolute file:// URL to dist/index.js, got: ${npmSpec}`);
  assert.deepEqual(Object.keys(parsed.provider?.["with-claude"]?.models ?? {}).sort(), ["haiku", "opus", "sonnet"]);
  assert.equal(parsed.agent?.planClaude?.model, "with-claude/sonnet");
  assert.equal(parsed.agent?.implClaude?.model, "with-claude/sonnet");
  assert.equal(parsed.agent?.reviewClaude?.model, "with-claude/sonnet");
});
