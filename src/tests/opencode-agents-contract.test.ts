import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const agentFiles = ["designGemini.md", "implClaude.md", "planClaude.md", "reviewClaude.md", "reviewGemini.md"];

test("OpenCode agent manifests exist for the bundled Claude and Gemini workflow agents", async () => {
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
  const designAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "designGemini.md"), "utf8");
  const implAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "implClaude.md"), "utf8");
  const reviewAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "reviewClaude.md"), "utf8");
  const reviewGeminiAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "reviewGemini.md"), "utf8");

  assert.match(planAgent, /## Selection rules/);
  assert.match(planAgent, /create_task/);
  assert.match(planAgent, /run_claude_plan/);
  assert.match(planAgent, /Using the save path is mandatory whenever the tool is available/);
  assert.match(planAgent, /Consider the plan incomplete until `run_claude_plan` has saved it/);
  assert.match(planAgent, /Do not reply with unsaved plan text when `run_claude_plan` is available/);
  assert.match(planAgent, /Do not wait for the user to mention `\.md`, markdown, or saving before persisting the plan/);
  assert.match(planAgent, /Do not implement code/);

  assert.match(designAgent, /## Working style/);
  assert.match(designAgent, /frontend styling and component structure/);
  assert.match(designAgent, /direct-call design agent/);
  assert.doesNotMatch(designAgent, /run_gemini_design/);
  assert.doesNotMatch(designAgent, /get_task_context/);

  assert.match(implAgent, /## Preconditions/);
  assert.match(implAgent, /Only continue if the task is in an implementation-ready state/);
  assert.match(implAgent, /run_claude_implementation/);
  assert.doesNotMatch(implAgent, /approve_task:\s*true/);
  assert.doesNotMatch(implAgent, /create_task:\s*true/);

  assert.match(reviewAgent, /## Preconditions/);
  assert.match(reviewAgent, /Only continue if implementation has actually been recorded/);
  assert.match(reviewAgent, /run_claude_review/);

  assert.match(reviewGeminiAgent, /## Preconditions/);
  assert.match(reviewGeminiAgent, /Only continue if implementation has actually been recorded/);
  assert.match(reviewGeminiAgent, /run_gemini_review/);
});

test("command prompts delegate to the matching Claude and Gemini subagents", async () => {
  const designCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "designGemini.md"), "utf8");
  const planCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "planClaude.md"), "utf8");
  const implCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "implClaude.md"), "utf8");
  const reviewCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "reviewClaude.md"), "utf8");
  const reviewGeminiCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "reviewGemini.md"), "utf8");

  assert.match(designCommand, /@designGemini/);
  assert.match(designCommand, /Do not implement directly/i);
  assert.match(designCommand, /direct-call design agent/i);
  assert.doesNotMatch(designCommand, /approved plan/i);
  assert.doesNotMatch(designCommand, /run_gemini_design/);

  assert.match(planCommand, /@planClaude/);
  assert.match(planCommand, /Do not write the plan yourself/i);
  assert.match(planCommand, /This tool-backed save path is the default behavior, not an optional extra/);
  assert.match(planCommand, /Treat a saved markdown artifact as the expected completion condition for planning/);
  assert.match(planCommand, /Do not stop after drafting plan text in-chat when `run_claude_plan` is available/);
  assert.match(planCommand, /Do not treat an explicit user request for a markdown file as required/);

  assert.match(implCommand, /@implClaude/);
  assert.match(implCommand, /Do not implement directly/i);

  assert.match(reviewCommand, /@reviewClaude/);
  assert.match(reviewCommand, /Do not review directly/i);

  assert.match(reviewGeminiCommand, /@reviewGemini/);
  assert.match(reviewGeminiCommand, /Do not review directly/i);
});
