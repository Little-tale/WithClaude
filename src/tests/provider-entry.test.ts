import assert from "node:assert/strict";
import test from "node:test";

import createWithClaude, { createWithClaude as namedCreateWithClaude, createWithGemini, WithClaudeLanguageModel, WithGeminiLanguageModel } from "../index.js";

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

test("package root exports a Gemini provider factory", () => {
  const provider = createWithGemini({
    cliPath: "gemini",
    cwd: process.cwd()
  });

  assert.equal(typeof provider, "function");
  assert.equal(typeof provider.languageModel, "function");

  const model = provider("default");
  assert.ok(model instanceof WithGeminiLanguageModel);
  assert.equal(model.modelId, "default");
  assert.equal(model.provider, "with-gemini");
});

test("default provider factory returns Gemini runtime when name is with-gemini", () => {
  const provider = createWithClaude({
    cliPath: "gemini",
    cwd: process.cwd(),
    name: "with-gemini"
  });

  const model = provider("default");
  assert.ok(model instanceof WithGeminiLanguageModel);
  assert.equal(model.provider, "with-gemini");
  assert.ok(!(model instanceof WithClaudeLanguageModel));
});
