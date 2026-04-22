import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function stripJsoncComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("opencode.jsonc declares workflow providers and binds Claude and Gemini agents to them", async () => {
  const raw = await readFile(path.join(process.cwd(), "opencode.jsonc"), "utf8");
  const expectedDistUrl = `file://${path.join(process.cwd(), "dist", "index.js")}`;
  const parsed = JSON.parse(stripJsoncComments(raw)) as {
    provider?: Record<string, { npm?: string; models?: Record<string, unknown>; options?: Record<string, unknown> }>;
    agent?: Record<string, { model?: string; geminiExecutionPolicy?: string }>;
  };

  assert.ok(parsed.provider?.["with-claude"]);
  assert.ok(parsed.provider?.["with-gemini"]);
  assert.ok(parsed.provider?.["with-gemini-yolo"]);
  const npmSpec = parsed.provider?.["with-claude"]?.npm;
  assert.equal(npmSpec, expectedDistUrl);
  assert.equal(parsed.provider?.["with-gemini"]?.npm, expectedDistUrl);
  assert.equal(parsed.provider?.["with-gemini-yolo"]?.npm, expectedDistUrl);
  await access(path.join(process.cwd(), "dist", "index.js"));
  assert.deepEqual(Object.keys(parsed.provider?.["with-claude"]?.models ?? {}).sort(), ["haiku", "opus", "sonnet"]);
  assert.deepEqual(Object.keys(parsed.provider?.["with-gemini"]?.models ?? {}).sort(), ["auto", "flash", "flash-lite", "pro"]);
  assert.deepEqual(Object.keys(parsed.provider?.["with-gemini-yolo"]?.models ?? {}).sort(), ["auto", "flash", "flash-lite", "pro"]);
  assert.equal(parsed.provider?.["with-gemini"]?.options?.cliPath, "gemini");
  assert.equal(parsed.provider?.["with-gemini-yolo"]?.options?.skipPermissions, true);
  assert.equal(parsed.agent?.planClaude?.model, "with-claude/opus");
  assert.equal(parsed.agent?.implClaude?.model, "with-claude/sonnet");
  assert.equal(parsed.agent?.reviewClaude?.model, "with-claude/sonnet");
  assert.equal(parsed.agent?.designGemini?.model, "with-gemini/auto");
  assert.equal(parsed.agent?.reviewGemini?.model, "with-gemini/auto");
  assert.equal(parsed.agent?.designGemini?.geminiExecutionPolicy, "write-enabled");
  assert.equal(parsed.agent?.reviewGemini?.geminiExecutionPolicy, "read-only");
});
