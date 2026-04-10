import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getActiveProcess, sessionKey } from "../provider/session-manager.js";
import { WithClaudeLanguageModel } from "../provider/with-claude-language-model.js";

async function writeFakeClaudeScript(mode: "generate" | "generate-hang" | "stream" | "stream-hang" | "stream-skipped-tool") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-provider-runtime-"));
  const file = path.join(dir, "fake-claude.js");

  const generateScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({type:"system", subtype:"init", session_id:"session-1"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"assistant", message:{content:[{type:"text", text:"Hello from Claude CLI"}]}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"result", session_id:"session-1", usage:{input_tokens:3, output_tokens:5}}) + "\\n");'
  ].join("\n");

  const streamScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({type:"system", subtype:"init", session_id:"session-stream"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"content_block_start", index:0, content_block:{type:"text"}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"content_block_delta", index:0, delta:{type:"text_delta", text:"Hello "}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"content_block_delta", index:0, delta:{type:"text_delta", text:"stream"}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"result", session_id:"session-stream", usage:{input_tokens:2, output_tokens:4}}) + "\\n");'
  ].join("\n");

  const streamHangScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({type:"system", subtype:"init", session_id:"session-hang"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"content_block_start", index:0, content_block:{type:"text"}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"content_block_delta", index:0, delta:{type:"text_delta", text:"done"}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"result", session_id:"session-hang", usage:{input_tokens:1, output_tokens:1}}) + "\\n");',
    'setInterval(() => {}, 1000);'
  ].join("\n");

  const streamSkippedToolScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({type:"system", subtype:"init", session_id:"session-skip"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"assistant", message:{content:[{type:"text", text:"OK"},{type:"tool_use", id:"tool-1", name:"Agent", input:{prompt:"ignored"}}]}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"result", session_id:"session-skip", usage:{input_tokens:1, output_tokens:1}}) + "\\n");'
  ].join("\n");

  const generateHangScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({type:"system", subtype:"init", session_id:"session-generate-hang"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"assistant", message:{content:[{type:"text", text:"Hello from Claude CLI"}]}}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"result", session_id:"session-generate-hang", usage:{input_tokens:3, output_tokens:5}}) + "\\n");',
    'setInterval(() => {}, 1000);'
  ].join("\n");

  const script = mode === "generate"
    ? generateScript
    : mode === "generate-hang"
      ? generateHangScript
    : mode === "stream"
      ? streamScript
      : mode === "stream-hang"
        ? streamHangScript
        : streamSkippedToolScript;

  await writeFile(file, script, "utf8");
  await chmod(file, 0o755);
  return { dir, file };
}

test("WithClaudeLanguageModel doGenerate parses stream-json CLI output", async () => {
  const { dir, file } = await writeFakeClaudeScript("generate");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const result = await model.doGenerate({
    prompt: [{ role: "user", content: "Say hello" }],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    tools: undefined,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  assert.ok(result.response);
  assert.equal(result.response.modelId, "sonnet");
  assert.match(JSON.stringify(result.content), /Hello from Claude CLI/);
  assert.equal(result.usage.outputTokens, 5);
  assert.equal(result.providerMetadata?.["with-claude"]?.sessionId, "session-1");
});

test("WithClaudeLanguageModel doGenerate tears down hanging Claude process after result", async () => {
  const { dir, file } = await writeFakeClaudeScript("generate-hang");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const result = await model.doGenerate({
    prompt: [{ role: "user", content: "Say hello" }],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  assert.match(JSON.stringify(result.content), /Hello from Claude CLI/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(getActiveProcess(sessionKey(dir, "sonnet")), undefined);
});

test("WithClaudeLanguageModel doStream emits text deltas from CLI stream-json output", async () => {
  const { dir, file } = await writeFakeClaudeScript("stream");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const streamResult = await model.doStream({
    prompt: [{ role: "user", content: "Say hello" }],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    tools: undefined,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "text-start"));
  assert.ok(parts.some((part) => part.type === "response-metadata" && part.modelId === "sonnet"));
  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "Hello "));
  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "stream"));
  assert.ok(parts.some((part) => part.type === "finish" && (part.providerMetadata as Record<string, any> | undefined)?.["with-claude"]?.sessionId === "session-stream"));
});

test("WithClaudeLanguageModel doStream tears down hanging Claude process after result", async () => {
  const { dir, file } = await writeFakeClaudeScript("stream-hang");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const streamResult = await model.doStream({
    prompt: [{ role: "user", content: "Say done" }],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  const reader = streamResult.stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(getActiveProcess(sessionKey(dir, "sonnet")), undefined);
});

test("WithClaudeLanguageModel doStream finishes with stop when only skipped tools were present", async () => {
  const { dir, file } = await writeFakeClaudeScript("stream-skipped-tool");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const streamResult = await model.doStream({
    prompt: [{ role: "user", content: "Say OK" }],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  const finish = parts.find((part) => part.type === "finish");
  assert.ok(finish);
  assert.deepEqual(finish.finishReason, { unified: "stop", raw: "stop" });
  assert.ok(!parts.some((part) => part.type === "tool-call"));
});

test("WithClaudeLanguageModel doGenerate synthesizes title prompts without spawning Claude", async () => {
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: "/definitely/not/a/real/claude/path",
    skipPermissions: true
  });

  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: "You are a title generator. You output ONLY a thread title. Nothing else.\n\nGenerate a brief title that would help the user find this conversation later." },
      { role: "user", content: "debug 500 errors in production" }
    ],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  assert.match(JSON.stringify(result.content), /Debug 500 Errors Production/);
  assert.equal(result.finishReason, "stop");
  assert.equal(result.providerMetadata?.["with-claude"]?.synthetic, true);
});

test("WithClaudeLanguageModel doStream synthesizes title prompts without spawning Claude", async () => {
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: "/definitely/not/a/real/claude/path",
    skipPermissions: true
  });

  const streamResult = await model.doStream({
    prompt: [
      { role: "system", content: "You are a title generator. You output ONLY a thread title. Nothing else.\n\nGenerate a brief title that would help the user find this conversation later." },
      { role: "user", content: "refactor user service" }
    ],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "response-metadata" && part.modelId === "sonnet"));
  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "Refactor User Service"));
  assert.ok(parts.some((part) => part.type === "finish" && JSON.stringify(part.finishReason) === JSON.stringify({ unified: "stop", raw: "stop" }) && (part.providerMetadata as Record<string, any> | undefined)?.["with-claude"]?.synthetic === true));
});

test("WithClaudeLanguageModel does not synthesize title prompts when tools are present", async () => {
  const { dir, file } = await writeFakeClaudeScript("stream");
  const model = new WithClaudeLanguageModel("sonnet", {
    provider: "with-claude",
    cliPath: file,
    cwd: dir,
    skipPermissions: true
  });

  const streamResult = await model.doStream({
    prompt: [
      { role: "system", content: "You are a title generator. You output ONLY a thread title. Nothing else.\n\nGenerate a brief title that would help the user find this conversation later." },
      { role: "user", content: "refactor user service" }
    ],
    maxOutputTokens: 200,
    temperature: 0,
    topP: 1,
    topK: 0,
    tools: [],
    providerOptions: {},
    messages: [] as never,
    abortSignal: new AbortController().signal,
    responseFormat: { type: "text" } as never
  } as never);

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "Hello "));
  assert.ok(!parts.some((part) => part.type === "text-delta" && part.delta === "Refactor User Service"));
});
