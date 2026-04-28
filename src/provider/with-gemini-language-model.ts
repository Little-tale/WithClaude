import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage
} from "@ai-sdk/provider";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { getGeminiPromptText } from "./message-builder.js";
import { mapTool } from "./tool-mapping.js";
import type { GeminiCliStreamMessage, ProviderCliConfig } from "./types.js";

type GeminiDebugStreamContext = {
  mode: "generate" | "stream";
  modelId: string;
  provider: string;
};

function debugGeminiStreamLine(context: GeminiDebugStreamContext, line: string): void {
  const logPath = process.env.WITH_CLAUDE_DEBUG_STREAM;
  if (!logPath) return;

  let messageType: string | null = null;
  let status: string | null = null;
  let sessionId: string | null = null;

  try {
    const parsed = JSON.parse(line) as GeminiCliStreamMessage;
    messageType = typeof parsed.type === "string" ? parsed.type : null;
    status = typeof parsed.status === "string" ? parsed.status : null;
    sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
  } catch {
    // Preserve raw output even when the line is not valid JSON.
  }

  appendFileSync(logPath, `${JSON.stringify({
    provider: context.provider,
    path: "provider",
    mode: context.mode,
    channel: "stdout",
    modelId: context.modelId,
    sessionId,
    messageType,
    status,
    raw: line
  })}\n`, "utf8");
}

export class WithGeminiLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v3" as any;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  private readonly config: ProviderCliConfig;

  constructor(modelId: string, config: ProviderCliConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  private get cliModelId(): string | undefined {
    return this.modelId;
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
        response: { id: randomUUID(), timestamp: new Date(), modelId: this.modelId },
        warnings: [],
        providerMetadata: { [this.config.provider]: { synthetic: true, path: "title" } }
      };
    }

    const promptText = getGeminiPromptText(options.prompt);
    const cliArgs = buildGeminiCliArgs(this.cliModelId, this.config.skipPermissions !== false, promptText, "stream-json");
    const warnings: LanguageModelV2CallWarning[] = [];
    const { parts, usage, sessionId } = await collectGeminiRun({
      cliPath: this.config.cliPath,
      cwd: this.config.cwd ?? process.cwd(),
      cliArgs,
      debug: {
        mode: "generate",
        modelId: this.modelId,
        provider: this.config.provider
      }
    });

    const content: LanguageModelV2Content[] = [];
    for (const part of parts) {
      if (part.kind === "reasoning") content.push({ type: "reasoning", text: part.text } as any);
      if (part.kind === "text") content.push({ type: "text", text: part.text } as any);
      if (part.kind === "tool-call") {
        content.push({ type: "tool-call", toolCallId: part.id, toolName: part.toolName, input: JSON.stringify(part.input ?? {}), providerExecuted: part.executed } as any);
      }
      if (part.kind === "tool-result") {
        content.push({ type: "tool-result", toolCallId: part.id, toolName: part.toolName, result: { title: part.toolName, output: part.output, metadata: {} }, providerExecuted: true } as any);
      }
    }

    return {
      content,
      finishReason: "stop" as LanguageModelV2FinishReason,
      usage,
      request: { body: { text: promptText } },
      response: { id: sessionId ?? randomUUID(), timestamp: new Date(), modelId: this.modelId },
      warnings,
      providerMetadata: { [this.config.provider]: { sessionId: sessionId ?? null } }
    };
  }

  async doStream(options: Parameters<LanguageModelV2["doStream"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    await this.debugPrompt("stream", options.prompt);
    if (this.requestScope(options) === "no-tools" && this.shouldSynthesizeTitle(options.prompt)) {
      const text = this.synthesizeTitle(options.prompt);
      const textId = randomUUID();
      const responseId = randomUUID();
      const modelId = this.modelId;
      const providerKey = this.config.provider;
      return {
        stream: new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "response-metadata", id: responseId, modelId, timestamp: new Date() } as any);
            controller.enqueue({ type: "text-start", id: textId } as any);
            controller.enqueue({ type: "text-delta", id: textId, delta: text } as any);
            controller.enqueue({ type: "text-end", id: textId } as any);
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, rawFinishReason: "stop", usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 }, totalTokens: 0 }, providerMetadata: { [providerKey]: { synthetic: true, path: "title", sessionId: responseId } } } as any);
            controller.close();
          }
        }),
        request: { body: { synthetic: true, text } },
        response: { headers: {} }
      };
    }

    const warnings: LanguageModelV2CallWarning[] = [];
    const cwd = this.config.cwd ?? process.cwd();
    const promptText = getGeminiPromptText(options.prompt);
    const cliArgs = buildGeminiCliArgs(this.cliModelId, this.config.skipPermissions !== false, promptText, "stream-json");
    const providerKey = this.config.provider;
    const modelId = this.modelId;

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        const proc = spawn(this.config.cliPath, cliArgs, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color" } });
        const rl = createInterface({ input: proc.stdout! });
        const textId = randomUUID();
        const toolCalls = new Map<string, { name: string; input: unknown }>();
        let responseMetadataSent = false;
        let textStarted = false;
        let controllerClosed = false;
        let currentSessionId: string | undefined;
        let stderr = "";
        let sawResult = false;
        let resultStatus: string | undefined;

        const cleanup = () => {
          try { rl.close(); } catch {}
          try { proc.stdout?.destroy(); } catch {}
          try { proc.stderr?.destroy(); } catch {}
          try { proc.kill("SIGKILL"); } catch {}
        };

        const closeStream = (finishReason: LanguageModelV2FinishReason, usage?: LanguageModelV2Usage) => {
          if (controllerClosed) return;
          controllerClosed = true;
          if (textStarted) controller.enqueue({ type: "text-end", id: textId } as any);
          controller.enqueue({ type: "finish", finishReason: { unified: finishReason === "unknown" ? "other" : finishReason, raw: finishReason }, rawFinishReason: finishReason, usage: { inputTokens: { total: usage?.inputTokens ?? 0 }, outputTokens: { total: usage?.outputTokens ?? 0 }, totalTokens: usage?.totalTokens ?? 0 }, providerMetadata: { [providerKey]: { sessionId: currentSessionId ?? null } } } as any);
          cleanup();
          try { controller.close(); } catch {}
        };

        const ensureTextStarted = () => {
          if (!textStarted) {
            controller.enqueue({ type: "text-start", id: textId } as any);
            textStarted = true;
          }
        };

        controller.enqueue({ type: "stream-start", warnings });
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        rl.on("line", (line) => {
          if (!line.trim() || controllerClosed) return;
          debugGeminiStreamLine({ mode: "stream", modelId: this.modelId, provider: this.config.provider }, line);
          try {
            const msg = JSON.parse(line) as GeminiCliStreamMessage;
            if (msg.type === "init") {
              currentSessionId = msg.session_id ?? currentSessionId;
              if (!responseMetadataSent) {
                controller.enqueue({ type: "response-metadata", id: currentSessionId ?? randomUUID(), modelId, timestamp: new Date() } as any);
                responseMetadataSent = true;
              }
            }
            if (msg.type === "thought" && msg.content) {
              const reasoningId = randomUUID();
              controller.enqueue({ type: "reasoning-start", id: reasoningId } as any);
              controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: msg.content } as any);
              controller.enqueue({ type: "reasoning-end", id: reasoningId } as any);
            }
            if (msg.type === "message" && msg.content) {
              ensureTextStarted();
              controller.enqueue({ type: "text-delta", id: textId, delta: msg.content } as any);
            }
            if (msg.type === "tool_use" && msg.tool_id && msg.tool_name) {
              toolCalls.set(msg.tool_id, { name: msg.tool_name, input: msg.parameters ?? {} });
              const mapped = mapTool(msg.tool_name, msg.parameters);
              if (!mapped.skip) {
                controller.enqueue({ type: "tool-call", toolCallId: msg.tool_id, toolName: mapped.name, input: JSON.stringify(mapped.input ?? {}), providerExecuted: mapped.executed } as any);
              }
            }
            if (msg.type === "tool_result" && msg.tool_id) {
              const toolCall = toolCalls.get(msg.tool_id);
              if (toolCall) {
                controller.enqueue({ type: "tool-result", toolCallId: msg.tool_id, toolName: mapTool(toolCall.name, toolCall.input).name, result: { title: toolCall.name, output: typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output ?? msg.error ?? {}), metadata: {} }, providerExecuted: true } as any);
              }
            }
            if (msg.type === "result") {
              sawResult = true;
              resultStatus = typeof msg.status === "string" ? msg.status : undefined;
              if (resultStatus !== "success") {
                controllerClosed = true;
                cleanup();
                const error = new Error(`Gemini provider CLI reported invalid result status: ${resultStatus ?? "missing"}`);
                try { controller.enqueue({ type: "error", error } as any); } catch {}
                try { controller.close(); } catch {}
                return;
              }
              closeStream("stop", mapGeminiUsage(msg.stats));
            }
          } catch {}
        });

        proc.on("error", (error) => {
          if (controllerClosed) return;
          controllerClosed = true;
          cleanup();
          try { controller.enqueue({ type: "error", error } as any); } catch {}
          try { controller.close(); } catch {}
        });

        proc.on("close", (code, signal) => {
          if (controllerClosed) return;
          if (!sawResult && code === 0 && !signal) {
            controllerClosed = true;
            cleanup();
            const error = new Error("Gemini provider CLI exited without a terminal result event.");
            try { controller.enqueue({ type: "error", error } as any); } catch {}
            try { controller.close(); } catch {}
            return;
          }
          if (!sawResult && (code !== 0 || signal)) {
            controllerClosed = true;
            cleanup();
            const error = new Error(`Gemini provider CLI failed during stream: ${stderr.trim() || `exit ${code}${signal ? ` (${signal})` : ""}`}`);
            try { controller.enqueue({ type: "error", error } as any); } catch {}
            try { controller.close(); } catch {}
            return;
          }
          closeStream("stop");
        });
        options.abortSignal?.addEventListener("abort", () => closeStream("other"), { once: true });
      }
    });

    return { stream, request: { body: { text: promptText } }, response: { headers: {} } };
  }

  private async debugPrompt(mode: "generate" | "stream", prompt: unknown): Promise<void> {
    if (!process.env.WITH_CLAUDE_DEBUG_PROMPT) return;
    await appendFile(process.env.WITH_CLAUDE_DEBUG_PROMPT, `${JSON.stringify({ mode, modelId: this.modelId, prompt, provider: this.config.provider })}\n`, "utf8");
  }

  private requestScope(options: { tools?: unknown }): "tools" | "no-tools" {
    return Array.isArray(options?.tools) ? "tools" : "no-tools";
  }

  private shouldSynthesizeTitle(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): boolean {
    const systemText = prompt.filter((message) => message.role === "system").map((message) => typeof message.content === "string" ? message.content : "").join("\n\n");
    return systemText.includes("You are a title generator. You output ONLY a thread title. Nothing else.")
      && systemText.includes("Generate a brief title that would help the user find this conversation later.");
  }

  private synthesizeTitle(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): string {
    const latestUser = prompt.filter((message) => message.role === "user").map((message) => typeof message.content === "string" ? message.content : "").join(" ").trim();
    return latestUser.split(/\s+/).slice(0, 6).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || "Conversation";
  }
}

type GeminiCollectedPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; id: string; toolName: string; input: unknown; executed: boolean }
  | { kind: "tool-result"; id: string; toolName: string; output: string };

function buildGeminiCliArgs(modelId: string | undefined, skipPermissions: boolean, promptText: string, outputFormat: "json" | "stream-json"): string[] {
  const args = ["-p", promptText, "--output-format", outputFormat];
  if (modelId) args.push("--model", modelId);
  if (skipPermissions) args.push("--yolo");
  return args;
}

async function collectGeminiRun(options: { cliPath: string; cwd: string; cliArgs: string[]; debug?: GeminiDebugStreamContext }): Promise<{ parts: GeminiCollectedPart[]; usage: LanguageModelV2Usage; sessionId?: string }> {
  const proc = spawn(options.cliPath, options.cliArgs, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color" } });
  const rl = createInterface({ input: proc.stdout! });
  const parts: GeminiCollectedPart[] = [];
  const toolCalls = new Map<string, { name: string; input: unknown }>();
  let stderr = "";
  let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let sessionId: string | undefined;
  let sawResult = false;
  let resultStatus: string | undefined;

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try { rl.close(); } catch {}
      try { proc.stdout?.destroy(); } catch {}
      try { proc.stderr?.destroy(); } catch {}
      try { proc.kill("SIGKILL"); } catch {}
    };

    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (options.debug) {
        debugGeminiStreamLine(options.debug, line);
      }
      try {
        const msg = JSON.parse(line) as GeminiCliStreamMessage;
        if (msg.type === "init") sessionId = msg.session_id ?? sessionId;
        if (msg.type === "message" && msg.content) parts.push({ kind: "text", text: msg.content });
        if (msg.type === "thought" && msg.content) parts.push({ kind: "reasoning", text: msg.content });
        if (msg.type === "tool_use" && msg.tool_id && msg.tool_name) {
          toolCalls.set(msg.tool_id, { name: msg.tool_name, input: msg.parameters ?? {} });
          const mapped = mapTool(msg.tool_name, msg.parameters);
          if (!mapped.skip) parts.push({ kind: "tool-call", id: msg.tool_id, toolName: mapped.name, input: mapped.input ?? {}, executed: mapped.executed });
        }
        if (msg.type === "tool_result" && msg.tool_id) {
          const toolCall = toolCalls.get(msg.tool_id);
          if (toolCall) {
            parts.push({ kind: "tool-result", id: msg.tool_id, toolName: mapTool(toolCall.name, toolCall.input).name, output: typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output ?? msg.error ?? {}) });
          }
        }
        if (msg.type === "result") {
          usage = mapGeminiUsage(msg.stats);
          sawResult = true;
          resultStatus = typeof msg.status === "string" ? msg.status : undefined;
          if (settled) return;
          settled = true;
          cleanup();
          if (resultStatus !== "success") {
            reject(new Error(`Gemini provider CLI reported invalid result status: ${resultStatus ?? "missing"}`));
            return;
          }
          resolve({ parts, usage, sessionId });
        }
      } catch {}
    });

    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(new Error(`Gemini provider CLI failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      if (!sawResult) {
        reject(new Error("Gemini provider CLI exited without a terminal result event."));
        return;
      }
      if (resultStatus !== "success") {
        reject(new Error(`Gemini provider CLI reported invalid result status: ${resultStatus ?? "missing"}`));
        return;
      }
      resolve({ parts, usage, sessionId });
    });
  });
}

function mapGeminiUsage(stats: GeminiCliStreamMessage["stats"]): LanguageModelV2Usage {
  const models = stats?.models ? Object.values(stats.models) : [];
  const inputTokens = models.reduce((sum, model) => sum + (model.tokens?.prompt ?? model.tokens?.input ?? 0), 0);
  const outputTokens = models.reduce((sum, model) => sum + (model.tokens?.candidates ?? model.tokens?.output ?? 0), 0);
  const totalTokens = models.reduce((sum, model) => sum + (model.tokens?.total ?? 0), 0) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}
