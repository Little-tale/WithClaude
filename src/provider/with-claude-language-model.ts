import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage
} from "@ai-sdk/provider";
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

import type { ClaudeCliStreamMessage, WithClaudeConfig } from "./types.js";
import { getClaudeUserMessage } from "./message-builder.js";
import { buildCliArgs, deleteActiveProcess, deleteClaudeSessionId, getActiveProcess, sessionKey, setClaudeSessionId, spawnClaudeProcess } from "./session-manager.js";
import { mapTool } from "./tool-mapping.js";

export class WithClaudeLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v3" as any;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  private readonly config: WithClaudeConfig;

  constructor(modelId: string, config: WithClaudeConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(options: Parameters<LanguageModelV2["doGenerate"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    await this.debugPrompt("generate", options.prompt);
    if (this.requestScope(options) === "no-tools" && this.shouldSynthesizeTitle(options.prompt)) {
      const text = this.synthesizeTitle(options.prompt);
      return {
        content: [{ type: "text", text } as any],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        request: { body: { synthetic: true, text } },
        response: {
          id: randomUUID(),
          timestamp: new Date(),
          modelId: this.modelId,
        },
        warnings: [],
        providerMetadata: {
          "with-claude": { synthetic: true, path: "title" }
        }
      };
    }
    const warnings: LanguageModelV2CallWarning[] = [];
    const cwd = this.config.cwd ?? process.cwd();
    const key = sessionKey(cwd, this.modelId);
    deleteClaudeSessionId(key);
    deleteActiveProcess(key);
    const userMessage = getClaudeUserMessage(options.prompt);
    const cliArgs = buildCliArgs({
      sessionKey: key,
      skipPermissions: this.config.skipPermissions !== false,
      includeSessionId: false,
      model: this.modelId
    });

    const { spawn } = await import("node:child_process");
    const { createInterface } = await import("node:readline");
    const proc = spawn(this.config.cliPath, cliArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" }
    });
    const rl = createInterface({ input: proc.stdout! });

    let responseText = "";
    let thinkingText = "";
    const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
    let usage: ClaudeCliStreamMessage["usage"];
    let sessionId: string | undefined;

    const result = await new Promise<{ text: string; thinking: string }>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        try { rl.close(); } catch {}
        try { proc.stdin?.end(); } catch {}
        try { proc.stdin?.destroy(); } catch {}
        try { proc.stdout?.destroy(); } catch {}
        try { proc.stderr?.destroy(); } catch {}
        try { proc.kill("SIGKILL"); } catch {}
      };

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line) as ClaudeCliStreamMessage;
          if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
            sessionId = msg.session_id;
          }
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) responseText += block.text;
              if (block.type === "thinking" && block.thinking) thinkingText += block.thinking;
              if (block.type === "tool_use" && block.id && block.name) {
                toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
              }
            }
          }
          if (msg.type === "content_block_delta" && msg.delta) {
            if (msg.delta.type === "text_delta" && msg.delta.text) responseText += msg.delta.text;
            if (msg.delta.type === "thinking_delta" && msg.delta.thinking) thinkingText += msg.delta.thinking;
          }
          if (msg.type === "result") {
            sessionId = msg.session_id ?? sessionId;
            usage = msg.usage;
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ text: responseText, thinking: thinkingText });
          }
        } catch {}
      });
      rl.on("close", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ text: responseText, thinking: thinkingText });
      });
      proc.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
      proc.stdin?.write(userMessage + "\n");
    });

    const content: LanguageModelV2Content[] = [];
    if (result.thinking) content.push({ type: "reasoning", text: result.thinking } as any);
    if (result.text) content.push({ type: "text", text: result.text } as any);
    for (const tc of toolCalls) {
      const mapped = mapTool(tc.name, tc.args);
      if (mapped.skip) continue;
      content.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: mapped.name,
        input: JSON.stringify(mapped.input ?? {}),
        providerExecuted: mapped.executed
      } as any);
    }

    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const mappedUsage: LanguageModelV2Usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    };

    return {
      content,
      finishReason: (toolCalls.length > 0 ? "tool-calls" : "stop") as LanguageModelV2FinishReason,
      usage: mappedUsage,
      request: { body: { text: userMessage } },
      response: {
        id: sessionId ?? randomUUID(),
        timestamp: new Date(),
        modelId: this.modelId
      },
      warnings,
      providerMetadata: {
        "with-claude": { sessionId: sessionId ?? null }
      }
    };
  }

  async doStream(options: Parameters<LanguageModelV2["doStream"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    await this.debugPrompt("stream", options.prompt);
    if (this.requestScope(options) === "no-tools" && this.shouldSynthesizeTitle(options.prompt)) {
      const text = this.synthesizeTitle(options.prompt);
      const textId = randomUUID();
      const responseId = randomUUID();
      const modelId = this.modelId;
      return {
        stream: new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "response-metadata", id: responseId, modelId, timestamp: new Date() } as any);
            controller.enqueue({ type: "text-start", id: textId } as any);
            controller.enqueue({ type: "text-delta", id: textId, delta: text } as any);
            controller.enqueue({ type: "text-end", id: textId } as any);
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              rawFinishReason: "stop",
              usage: {
                inputTokens: { total: 0 },
                outputTokens: { total: 0 },
                totalTokens: 0
              },
              providerMetadata: {
                "with-claude": { synthetic: true, path: "title", sessionId: responseId }
              }
            } as any);
            controller.close();
          }
        }),
        request: { body: { synthetic: true, text } },
        response: { headers: {} }
      };
    }
    const warnings: LanguageModelV2CallWarning[] = [];
    const cwd = this.config.cwd ?? process.cwd();
    const key = sessionKey(cwd, this.modelId);
    deleteClaudeSessionId(key);
    deleteActiveProcess(key);
    const userMessage = getClaudeUserMessage(options.prompt);
    const cliArgs = buildCliArgs({
      sessionKey: key,
      skipPermissions: this.config.skipPermissions !== false,
      includeSessionId: false,
      model: this.modelId
    });

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        const proc = spawnClaudeProcess(this.config.cliPath, cliArgs, cwd, key).proc;
        const lineEmitter = getActiveProcess(key)!.lineEmitter;
        controller.enqueue({ type: "stream-start", warnings });
        const textId = randomUUID();
        let currentSessionId: string | undefined;
        let responseMetadataSent = false;
        let textStarted = false;
        let controllerClosed = false;
        const toolCalls = new Map<string, { name: string; input: unknown }>();
        let emittedToolCallCount = 0;
        let abortHandler: (() => void) | undefined;

        const cleanup = () => {
          lineEmitter.off("line", lineHandler);
          lineEmitter.off("close", closeHandler);
          proc.off("error", errorHandler);
          if (abortHandler) {
            options.abortSignal?.removeEventListener("abort", abortHandler);
          }
          deleteActiveProcess(key);
        };

        const ensureTextStarted = () => {
          if (!textStarted) {
            controller.enqueue({ type: "text-start", id: textId } as any);
            textStarted = true;
          }
        };

        const closeStream = (finishReason: LanguageModelV2FinishReason, usage?: ClaudeCliStreamMessage["usage"]) => {
          if (controllerClosed) return;
          controllerClosed = true;
          if (textStarted) controller.enqueue({ type: "text-end", id: textId } as any);
          const inputTokens = usage?.input_tokens ?? 0;
          const outputTokens = usage?.output_tokens ?? 0;
          const rawFinishReason = finishReason;
          const finishEvent = {
            type: "finish",
            finishReason: {
              unified: rawFinishReason === "unknown" ? "other" : rawFinishReason,
              raw: rawFinishReason
            },
            rawFinishReason,
            usage: {
              inputTokens: { total: inputTokens },
              outputTokens: { total: outputTokens },
              totalTokens: inputTokens + outputTokens
            },
            providerMetadata: {
              "with-claude": { sessionId: currentSessionId ?? null }
            }
          };
          void this.debugStreamEvent({
            modelId: this.modelId,
            specificationVersion: this.specificationVersion,
            finishEvent
          });
          controller.enqueue(finishEvent as any);
          cleanup();
          try { controller.close(); } catch {}
        };

        const lineHandler = (line: string) => {
          if (!line.trim() || controllerClosed) return;
          try {
            const msg = JSON.parse(line) as ClaudeCliStreamMessage;
            if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
              setClaudeSessionId(key, msg.session_id);
              currentSessionId = msg.session_id;
              if (!responseMetadataSent) {
                controller.enqueue({
                  type: "response-metadata",
                  id: msg.session_id,
                  modelId: this.modelId,
                  timestamp: new Date()
                } as any);
                responseMetadataSent = true;
              }
            }
            if (msg.type === "content_block_start" && msg.content_block?.type === "text") {
              ensureTextStarted();
            }
            if (msg.type === "content_block_delta" && msg.delta?.type === "text_delta" && msg.delta.text) {
              ensureTextStarted();
              controller.enqueue({ type: "text-delta", id: textId, delta: msg.delta.text } as any);
            }
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                  ensureTextStarted();
                  controller.enqueue({ type: "text-delta", id: textId, delta: block.text } as any);
                }
                if (block.type === "thinking" && block.thinking) {
                  const reasoningId = randomUUID();
                  controller.enqueue({ type: "reasoning-start", id: reasoningId } as any);
                  controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: block.thinking } as any);
                  controller.enqueue({ type: "reasoning-end", id: reasoningId } as any);
                }
                if (block.type === "tool_use" && block.id && block.name) {
                  toolCalls.set(block.id, { name: block.name, input: block.input ?? {} });
                  const mapped = mapTool(block.name, block.input);
                  if (!mapped.skip) {
                    emittedToolCallCount += 1;
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: block.id,
                      toolName: mapped.name,
                      input: JSON.stringify(mapped.input ?? {}),
                      providerExecuted: mapped.executed
                    } as any);
                  }
                }
              }
            }
            if (msg.type === "user" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "tool_result" && block.tool_use_id) {
                  const toolCall = toolCalls.get(block.tool_use_id);
                  if (toolCall) {
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId: block.tool_use_id,
                      toolName: toolCall.name,
                      result: {
                        title: toolCall.name,
                        output: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
                        metadata: {}
                      },
                      providerExecuted: true
                    } as any);
                  }
                }
              }
            }
            if (msg.type === "result") {
              closeStream(emittedToolCallCount > 0 ? "tool-calls" : "stop", msg.usage);
            }
          } catch {}
        };

        const closeHandler = () => {
          closeStream(emittedToolCallCount > 0 ? "tool-calls" : "stop");
        };

        const errorHandler = (err: Error) => {
          if (controllerClosed) return;
          controllerClosed = true;
          cleanup();
          try { controller.enqueue({ type: "error", error: err } as any); } catch {}
          try { controller.close(); } catch {}
        };

        abortHandler = () => {
          closeStream("other");
        };

        lineEmitter.on("line", lineHandler);
        lineEmitter.on("close", closeHandler);
        proc.on("error", errorHandler);
        options.abortSignal?.addEventListener("abort", abortHandler, { once: true });
        proc.stdin?.write(userMessage + "\n");
      }
    });

    return {
      stream,
      request: { body: { text: userMessage } },
      response: { headers: {} }
    };
  }

  private async debugPrompt(mode: "generate" | "stream", prompt: unknown): Promise<void> {
    if (!process.env.WITH_CLAUDE_DEBUG_PROMPT) return;
    const logPath = process.env.WITH_CLAUDE_DEBUG_PROMPT;
    const payload = {
      mode,
      modelId: this.modelId,
      prompt
    };
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  private async debugStreamEvent(event: Record<string, unknown>): Promise<void> {
    if (!process.env.WITH_CLAUDE_DEBUG_STREAM) return;
    await appendFile(process.env.WITH_CLAUDE_DEBUG_STREAM, `${JSON.stringify(event)}\n`, "utf8");
  }

  private requestScope(options: { tools?: unknown }): "tools" | "no-tools" {
    return Array.isArray(options?.tools) ? "tools" : "no-tools";
  }

  private shouldSynthesizeTitle(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): boolean {
    const systemText = prompt
      .filter((message) => message.role === "system")
      .map((message) => {
        if (typeof message.content === "string") return message.content;
        if (!Array.isArray(message.content)) return "";
        const parts = message.content as Array<{ type?: string; text?: string }>;
        return parts
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
      })
      .join("\n\n");

    return systemText.includes("You are a title generator. You output ONLY a thread title. Nothing else.")
      && systemText.includes("Generate a brief title that would help the user find this conversation later.");
  }

  private latestUserText(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): string {
    const chunks: string[] = [];
    for (const message of prompt) {
      if (message.role !== "user") continue;
      if (typeof message.content === "string") {
        chunks.push(message.content);
        continue;
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content as any[]) {
          if (part.type === "text" && typeof part.text === "string") {
            chunks.push(part.text);
          }
        }
      }
    }
    return chunks.join(" ").trim();
  }

  private synthesizeTitle(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): string {
    const source = this.latestUserText(prompt)
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .trim();

    if (!source) return "New Session";

    const stop = new Set([
      "a", "an", "the", "and", "or", "but", "to", "for", "of", "in", "on", "at", "with",
      "can", "could", "would", "should", "please", "hi", "hello", "hey", "there", "you", "your",
      "this", "that", "is", "are", "was", "were", "be", "do", "does", "did", "summarize", "summary", "project"
    ]);

    const words = source
      .split(" ")
      .map((word) => word.trim())
      .filter(Boolean)
      .filter((word) => !stop.has(word.toLowerCase()));

    const picked = (words.length > 0 ? words : source.split(" ").filter(Boolean))
      .slice(0, 6)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    return picked || "New Session";
  }
}
