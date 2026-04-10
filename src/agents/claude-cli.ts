import { spawn } from "node:child_process";

export type ClaudeCliRole = "planClaude" | "implClaude" | "reviewClaude";

export type ClaudeCliRoleConfig = {
  model?: string;
  args?: string[];
};

export type ClaudeCliConfig = {
  command?: string;
  commonArgs?: string[];
  timeoutMs?: number;
  roles?: Partial<Record<ClaudeCliRole, ClaudeCliRoleConfig>>;
};

export async function runClaudeCliJson<T>(options: {
  config: ClaudeCliConfig;
  role: ClaudeCliRole;
  prompt: string;
  cwd: string;
  schema: Record<string, unknown>;
  templates?: Record<string, string>;
}): Promise<T> {
  const command = options.config.command?.trim() || "claude";
  const commonArgs = options.config.commonArgs ?? ["-p", "--output-format", "json"];
  const roleConfig = options.config.roles?.[options.role] ?? {};
  const timeoutMs = options.config.timeoutMs ?? 900000;
  const args = commonArgs.map((value) => replaceTemplate(value, options.templates ?? {}));

  if (!args.includes("--json-schema")) {
    args.push("--json-schema", JSON.stringify(options.schema));
  }
  if (roleConfig.model) {
    args.push("--model", roleConfig.model);
  }
  if (roleConfig.args?.length) {
    args.push(...roleConfig.args.map((value) => replaceTemplate(value, options.templates ?? {})));
  }
  args.push(options.prompt);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms.`));
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
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to start Claude CLI: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Claude CLI failed: ${stderr.trim() || stdout.trim() || `exit ${code}${signal ? ` (${signal})` : ""}`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to parse Claude CLI JSON output."));
      }
    });
  });
}

function replaceTemplate(value: string, templates: Record<string, string>): string {
  let result = value;
  for (const [key, replacement] of Object.entries(templates)) {
    result = result.replaceAll(`{{${key}}}`, replacement);
  }
  return result;
}
