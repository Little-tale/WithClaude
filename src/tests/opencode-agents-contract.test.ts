import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const agentFiles = ["implClaude.md", "planClaude.md", "reviewClaude.md"];

test("OpenCode agent manifests exist for @implClaude, @planClaude, and @reviewClaude", async () => {
  for (const file of agentFiles) {
    const pluralPath = path.join(process.cwd(), ".opencode", "agents", file);
    const pluralContent = await readFile(pluralPath, "utf8");

    assert.match(pluralContent, /^---\n/s);
    assert.match(pluralContent, /description:\s*.+/);
    assert.match(pluralContent, /mode:\s*subagent/);
  }
});

test("agent manifests encode distinct role boundaries and workflow expectations", async () => {
  const planAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "planClaude.md"), "utf8");
  const implAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "implClaude.md"), "utf8");
  const reviewAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "reviewClaude.md"), "utf8");

  assert.match(planAgent, /## Selection rules/);
  assert.match(planAgent, /create_task/);
  assert.match(planAgent, /run_claude_plan/);
  assert.match(planAgent, /Do not implement code/);

  assert.match(implAgent, /## Preconditions/);
  assert.match(implAgent, /Only continue if the task is in an implementation-ready state/);
  assert.match(implAgent, /run_claude_implementation/);
  assert.doesNotMatch(implAgent, /approve_task:\s*true/);
  assert.doesNotMatch(implAgent, /create_task:\s*true/);

  assert.match(reviewAgent, /## Preconditions/);
  assert.match(reviewAgent, /Only continue if implementation has actually been recorded/);
  assert.match(reviewAgent, /run_claude_review/);
});
