import { spawn } from "node:child_process";

import type { AppEnv } from "../config/env.js";
import type { ImplementerAdapter, ImplementerInput, ImplementerResult } from "./types.js";

type ImplementerResponse = {
  summary?: unknown;
};

function parseArgs(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to simple whitespace splitting for local setups.
  }

  return raw
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function replaceTemplate(value: string, input: ImplementerInput, prompt: string): string {
  return value
    .replaceAll("{{taskId}}", input.task.taskId)
    .replaceAll("{{workspaceRoot}}", input.task.workspaceRoot ?? "")
    .replaceAll("{{revision}}", String(input.task.planRevision))
    .replaceAll("{{prompt}}", prompt);
}

function buildPrompt(input: ImplementerInput, env: AppEnv): string {
  const lines = [
    env.IMPLEMENTER_MESSAGE_PREFIX?.trim(),
    env.IMPLEMENTER_PROMPT_PREFIX?.trim(),
    "You are the implementation bridge for a workflow orchestrator.",
    "Carry out the approved plan in the target workspace.",
    "Make the necessary code changes in the workspace when the downstream tool supports editing.",
    "Return only the final implementation summary markdown. Do not include hidden reasoning or JSON unless explicitly requested.",
    "",
    "## Runtime context",
    `- taskId: ${input.task.taskId}`,
    `- revision: ${input.task.planRevision}`,
    `- workspace: ${input.task.workspaceRoot ?? env.projectRoot}`,
    `- source: ${input.task.source}`,
    `- requestedStage: ${input.task.requestedStage}`,
    `- routingMode: ${input.task.routingMode}`,
    "",
    "## Original request",
    input.task.request,
    "",
    `## Approved plan (revision ${input.task.planRevision})`,
    input.task.planText,
    ""
  ];

  if (env.IMPLEMENTER_PROMPT_SUFFIX?.trim()) {
    lines.push(env.IMPLEMENTER_PROMPT_SUFFIX.trim(), "");
  }

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function extractJsonEventText(stdout: string): string | null {
  const lines = stdout.split("\n");
  const texts: string[] = [];

  for (const rawLine of lines) {
    const line = stripAnsi(rawLine).trim();
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        type?: unknown;
        part?: { text?: unknown };
      };
      if (parsed.type === "text" && typeof parsed.part?.text === "string" && parsed.part.text.trim().length > 0) {
        texts.push(parsed.part.text);
      }
    } catch {
      continue;
    }
  }

  return texts.length > 0 ? sanitizeExtractedText(texts.join("\n\n")) : null;
}

function sanitizeExtractedText(value: string): string {
  let text = value.trim();
  const firstHeadingIndex = text.search(/^#{1,6}\s+/m);
  if (firstHeadingIndex > 0) {
    text = text.slice(firstHeadingIndex).trim();
  }

  const modelInfoIndex = text.search(/^##?\s+Model Information\b/m);
  if (modelInfoIndex >= 0) {
    text = text.slice(0, modelInfoIndex).trim();
  }

  return text;
}

function parseImplementationOutput(stdout: string, allowRawStdout: boolean): ImplementerResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Implementer command returned empty stdout.");
  }

  const eventText = extractJsonEventText(trimmed);
  if (eventText) {
    return { summary: eventText };
  }

  try {
    const parsed = JSON.parse(trimmed) as ImplementerResponse;
    if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
      return { summary: parsed.summary };
    }
    throw new Error("Implementer command JSON output did not include a non-empty summary.");
  } catch (error) {
    if (!allowRawStdout) {
      throw error instanceof Error ? error : new Error("Implementer command returned invalid JSON output.");
    }
  }

  return { summary: trimmed };
}

export function createCommandImplementer(env: AppEnv): ImplementerAdapter | null {
  const command = env.IMPLEMENTER_COMMAND?.trim();
  if (!command) {
    return null;
  }

  const baseArgs = parseArgs(env.IMPLEMENTER_ARGS);
  const timeoutMs = env.IMPLEMENTER_TIMEOUT_MS ?? 300000;

  return {
    name: "implement-command",
    async runImplementation(input: ImplementerInput): Promise<ImplementerResult> {
      const prompt = buildPrompt(input, env);
      const args = baseArgs.map((value) => replaceTemplate(value, input, prompt));
      if (env.IMPLEMENTER_PROMPT_ARG_TEMPLATE) {
        args.push(replaceTemplate(env.IMPLEMENTER_PROMPT_ARG_TEMPLATE, input, prompt));
      }
      const cwd = input.task.workspaceRoot ?? env.projectRoot;

      return new Promise<ImplementerResult>((resolve, reject) => {
        const child = spawn(replaceTemplate(command, input, prompt), args, {
          cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          child.kill("SIGTERM");
          reject(new Error(`Implementer command timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        child.on("error", (error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to start implementer command: ${error.message}`));
        });

        child.on("close", (code, signal) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          if (code !== 0) {
            const detail = stderr.trim() || stdout.trim() || `exit ${code}${signal ? ` (${signal})` : ""}`;
            reject(new Error(`Implementer command failed: ${detail}`));
            return;
          }

          try {
            resolve(parseImplementationOutput(stdout, Boolean(env.IMPLEMENTER_ALLOW_RAW_STDOUT)));
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Unknown implementer output error."));
          }
        });

        if (env.IMPLEMENTER_WRITE_PROMPT_TO_STDIN) {
          child.stdin.end(prompt);
        } else {
          child.stdin.end();
        }
      });
    }
  };
}
