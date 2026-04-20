import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getActiveProcess, sessionKey } from "../provider/session-manager.js";
import { WithClaudeLanguageModel } from "../provider/with-claude-language-model.js";
import { WithGeminiLanguageModel } from "../provider/with-gemini-language-model.js";

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

async function writeFakeGeminiScript(mode: "generate" | "generate-capture-model" | "stream" | "stream-fail" | "generate-no-result" | "generate-failed-result" | "generate-missing-status" | "stream-missing-status" | "stream-no-result-exit-0") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-provider-runtime-gemini-"));
  const file = path.join(dir, "fake-gemini.js");

  const generateScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-1", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "thought", content: "thinking" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "Hello from Gemini CLI" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", status: "success", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 4, candidates: 6, total: 10 } } } } }) + "\\n");'
  ].join("\n");

  const generateCaptureModelScript = [
    "#!/usr/bin/env node",
    'const args = process.argv.slice(2);',
    'const modelIndex = args.indexOf("--model");',
    'const model = modelIndex >= 0 ? args[modelIndex + 1] : "missing-model";',
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-capture", model }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: model }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", status: "success", stats: { models: { [model]: { tokens: { prompt: 1, candidates: 1, total: 2 } } } } }) + "\\n");'
  ].join("\n");

  const streamScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-stream", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "Hello " }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "tool_use", tool_name: "Read", tool_id: "tool-1", parameters: { file: "src/main.ts" } }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "tool_result", tool_id: "tool-1", status: "success", output: "file contents" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "Gemini stream" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", status: "success", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 2, candidates: 5, total: 7 } } } } }) + "\\n");'
  ].join("\n");

  const streamFailScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-fail", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial output" }) + "\\n");',
    'process.stderr.write("gemini stream failed");',
    'process.exit(1);'
  ].join("\n");

  const generateNoResultScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-no-result", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial only" }) + "\\n");'
  ].join("\n");

  const generateFailedResultScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-failed-result", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial only" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", status: "error", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 1, candidates: 1, total: 2 } } } } }) + "\\n");'
  ].join("\n");

  const generateMissingStatusScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-missing-status", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial only" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 1, candidates: 1, total: 2 } } } } }) + "\\n");'
  ].join("\n");

  const streamMissingStatusScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-stream-missing-status", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial output" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "result", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 1, candidates: 1, total: 2 } } } } }) + "\\n");'
  ].join("\n");

  const streamNoResultExitZeroScript = [
    "#!/usr/bin/env node",
    'process.stdout.write(JSON.stringify({ type: "init", session_id: "gemini-session-stream-no-result", model: "gemini-2.5-pro" }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "message", content: "partial output" }) + "\\n");'
  ].join("\n");

  await writeFile(file, mode === "generate"
    ? generateScript
    : mode === "generate-capture-model"
      ? generateCaptureModelScript
    : mode === "stream"
      ? streamScript
      : mode === "stream-fail"
        ? streamFailScript
        : mode === "generate-no-result"
          ? generateNoResultScript
          : mode === "generate-failed-result"
            ? generateFailedResultScript
            : mode === "generate-missing-status"
              ? generateMissingStatusScript
              : mode === "stream-missing-status"
                ? streamMissingStatusScript
                : streamNoResultExitZeroScript, "utf8");
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

test("WithGeminiLanguageModel doGenerate parses stream-json CLI output", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
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

  assert.ok(result.response);
  assert.equal(result.response.modelId, "auto");
  assert.match(JSON.stringify(result.content), /Hello from Gemini CLI/);
  assert.equal(result.usage.outputTokens, 6);
  assert.equal(result.providerMetadata?.["with-gemini"]?.sessionId, "gemini-session-1");
});

test("WithGeminiLanguageModel doGenerate writes Gemini stdout lines to WITH_CLAUDE_DEBUG_STREAM", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate");
  const logPath = path.join(dir, "gemini-debug.ndjson");
  const previous = process.env.WITH_CLAUDE_DEBUG_STREAM;
  process.env.WITH_CLAUDE_DEBUG_STREAM = logPath;

  try {
    const model = new WithGeminiLanguageModel("auto", {
      provider: "with-gemini",
      cliPath: file,
      cwd: dir,
      skipPermissions: false
    });

    await model.doGenerate({
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

    const lines = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(lines.some((line) => line.provider === "with-gemini" && line.mode === "generate" && line.channel === "stdout"));
    assert.ok(lines.some((line) => line.messageType === "message" && String(line.raw).includes("Hello from Gemini CLI")));
    assert.ok(lines.some((line) => line.messageType === "result" && line.status === "success"));
  } finally {
    if (previous === undefined) {
      delete process.env.WITH_CLAUDE_DEBUG_STREAM;
    } else {
      process.env.WITH_CLAUDE_DEBUG_STREAM = previous;
    }
  }
});

test("WithGeminiLanguageModel doGenerate rejects missing terminal result events", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate-no-result");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  await assert.rejects(
    () => model.doGenerate({
      prompt: [{ role: "user", content: "Say hello" }],
      maxOutputTokens: 200,
      temperature: 0,
      topP: 1,
      topK: 0,
      providerOptions: {},
      messages: [] as never,
      abortSignal: new AbortController().signal,
      responseFormat: { type: "text" } as never
    } as never),
    /terminal result event/
  );
});

test("WithGeminiLanguageModel doGenerate rejects non-success result status", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate-failed-result");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  await assert.rejects(
    () => model.doGenerate({
      prompt: [{ role: "user", content: "Say hello" }],
      maxOutputTokens: 200,
      temperature: 0,
      topP: 1,
      topK: 0,
      providerOptions: {},
      messages: [] as never,
      abortSignal: new AbortController().signal,
      responseFormat: { type: "text" } as never
    } as never),
    /invalid result status: error/
  );
});

test("WithGeminiLanguageModel doGenerate rejects missing result status", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate-missing-status");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  await assert.rejects(
    () => model.doGenerate({
      prompt: [{ role: "user", content: "Say hello" }],
      maxOutputTokens: 200,
      temperature: 0,
      topP: 1,
      topK: 0,
      providerOptions: {},
      messages: [] as never,
      abortSignal: new AbortController().signal,
      responseFormat: { type: "text" } as never
    } as never),
    /invalid result status: missing/
  );
});

test("WithGeminiLanguageModel doStream emits text, tool calls, and finish metadata", async () => {
  const { dir, file } = await writeFakeGeminiScript("stream");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  const streamResult = await model.doStream({
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

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "response-metadata" && part.modelId === "auto"));
  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "Hello "));
  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "Gemini stream"));
  assert.ok(parts.some((part) => part.type === "tool-call" && part.toolName === "read"));
  assert.ok(parts.some((part) => part.type === "tool-result"));
  assert.ok(parts.some((part) => part.type === "finish" && (part.providerMetadata as Record<string, any> | undefined)?.["with-gemini"]?.sessionId === "gemini-session-stream"));
});

test("WithGeminiLanguageModel doStream writes Gemini stdout lines to WITH_CLAUDE_DEBUG_STREAM", async () => {
  const { dir, file } = await writeFakeGeminiScript("stream");
  const logPath = path.join(dir, "gemini-stream-debug.ndjson");
  const previous = process.env.WITH_CLAUDE_DEBUG_STREAM;
  process.env.WITH_CLAUDE_DEBUG_STREAM = logPath;

  try {
    const model = new WithGeminiLanguageModel("auto", {
      provider: "with-gemini",
      cliPath: file,
      cwd: dir,
      skipPermissions: false
    });

    const streamResult = await model.doStream({
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

    const reader = streamResult.stream.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
    }

    const lines = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(lines.some((line) => line.provider === "with-gemini" && line.mode === "stream" && line.channel === "stdout"));
    assert.ok(lines.some((line) => line.messageType === "tool_use"));
    assert.ok(lines.some((line) => line.messageType === "result" && line.status === "success"));
  } finally {
    if (previous === undefined) {
      delete process.env.WITH_CLAUDE_DEBUG_STREAM;
    } else {
      process.env.WITH_CLAUDE_DEBUG_STREAM = previous;
    }
  }
});

test("WithGeminiLanguageModel doStream surfaces non-zero exit failures instead of finishing with stop", async () => {
  const { dir, file } = await writeFakeGeminiScript("stream-fail");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  const streamResult = await model.doStream({
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

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "partial output"));
  assert.ok(parts.some((part) => part.type === "error" && String(part.error).includes("gemini stream failed")));
  assert.ok(!parts.some((part) => part.type === "finish"));
});

test("WithGeminiLanguageModel doStream rejects missing result status", async () => {
  const { dir, file } = await writeFakeGeminiScript("stream-missing-status");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  const streamResult = await model.doStream({
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

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "error" && String(part.error).includes("invalid result status: missing")));
  assert.ok(!parts.some((part) => part.type === "finish"));
});

test("WithGeminiLanguageModel doStream rejects zero-exit runs without a terminal result event", async () => {
  const { dir, file } = await writeFakeGeminiScript("stream-no-result-exit-0");
  const model = new WithGeminiLanguageModel("auto", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
  });

  const streamResult = await model.doStream({
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

  const reader = streamResult.stream.getReader();
  const parts: Array<Record<string, unknown>> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value as Record<string, unknown>);
  }

  assert.ok(parts.some((part) => part.type === "error" && String(part.error).includes("terminal result event")));
  assert.ok(!parts.some((part) => part.type === "finish"));
});

test("WithGeminiLanguageModel passes the selected alias directly to Gemini CLI", async () => {
  const { dir, file } = await writeFakeGeminiScript("generate-capture-model");
  const model = new WithGeminiLanguageModel("flash", {
    provider: "with-gemini",
    cliPath: file,
    cwd: dir,
    skipPermissions: false
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

  assert.match(JSON.stringify(result.content), /flash/);
  assert.ok(result.response);
  assert.equal(result.response.modelId, "flash");
});
