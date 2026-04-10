import assert from "node:assert/strict";
import test from "node:test";

import createWithClaude, { createWithClaude as namedCreateWithClaude, WithClaudeLanguageModel } from "../index.js";

test("package root exports a provider factory", () => {
  assert.equal(typeof createWithClaude, "function");
  assert.equal(createWithClaude, namedCreateWithClaude);

  const provider = createWithClaude({
    cliPath: "claude",
    cwd: process.cwd(),
    name: "with-claude"
  });

  assert.equal(typeof provider, "function");
  assert.equal(typeof provider.languageModel, "function");

  const model = provider("sonnet");
  assert.ok(model instanceof WithClaudeLanguageModel);
  assert.equal(model.modelId, "sonnet");
  assert.equal(model.provider, "with-claude");
});
