import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GeminiCliRole = "designGemini" | "reviewGemini";

export type GeminiExecutionPolicy = "read-only" | "write-enabled";

export type GeminiCliRoleConfig = {
  model?: string;
  args?: string[];
  executionPolicy?: GeminiExecutionPolicy;
};

export type GeminiCliConfig = {
  command?: string;
  commonArgs?: string[];
  timeoutMs?: number;
  auto?: string;
  roles?: Partial<Record<GeminiCliRole, GeminiCliRoleConfig>>;
};

type WorkspaceSnapshot = {
  root: string;
  files: Map<string, { contents: Buffer; hash: string }>;
};

type GeminiCliEnvelope = {
  response?: unknown;
  error?: {
    type?: string;
    message?: string;
    code?: string | number;
  };
};

export async function runGeminiCliJson<T>(options: {
  config: GeminiCliConfig;
  role: GeminiCliRole;
  prompt: string;
  cwd: string;
  templates?: Record<string, string>;
  validate?: (value: unknown) => T;
}): Promise<T> {
  const command = options.config.command?.trim() || "gemini";
  const commonArgs = options.config.commonArgs ?? ["--output-format", "json", "-p"];
  const roleConfig = options.config.roles?.[options.role] ?? {};
  const timeoutMs = options.config.timeoutMs ?? 900000;
  const args = commonArgs.map((value) => replaceTemplate(value, options.templates ?? {}));
  const model = roleConfig.model ?? options.config.auto;

  if (model) {
    args.push("--model", model);
  }
  if (roleConfig.args?.length) {
    args.push(...roleConfig.args.map((value) => replaceTemplate(value, options.templates ?? {})));
  }
  applyExecutionPolicyArgs(args, roleConfig.executionPolicy);
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
      reject(new Error(`Gemini CLI timed out after ${timeoutMs}ms.`));
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
      reject(new Error(`Failed to start Gemini CLI: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Gemini CLI failed: ${stderr.trim() || stdout.trim() || `exit ${code}${signal ? ` (${signal})` : ""}`}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as GeminiCliEnvelope;
        if (parsed.error) {
          reject(new Error(`Gemini CLI failed: ${parsed.error.message ?? parsed.error.type ?? "unknown error"}`));
          return;
        }
        const result = parseGeminiResponseJson<unknown>(parsed.response);
        resolve(options.validate ? options.validate(result) : (result as T));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to parse Gemini CLI JSON output."));
      }
    });
  });
}

function applyExecutionPolicyArgs(args: string[], executionPolicy: GeminiExecutionPolicy | undefined): void {
  if (executionPolicy !== "write-enabled") {
    return;
  }
  if (args.includes("--yolo") || args.includes("-y")) {
    return;
  }
  const approvalModeIndex = args.findIndex((value) => value === "--approval-mode");
  if (approvalModeIndex >= 0) {
    return;
  }
  const inlineApprovalMode = args.find((value) => value.startsWith("--approval-mode="));
  if (inlineApprovalMode) {
    return;
  }
  args.push("--approval-mode", "yolo");
}

export async function runGeminiDesignWithRollback<T>(options: {
  config: GeminiCliConfig;
  prompt: string;
  cwd: string;
  templates?: Record<string, string>;
  validate?: (value: unknown) => T;
}): Promise<T> {
  const snapshot = await createWorkspaceSnapshot(options.cwd);

  try {
    return await runGeminiCliJson<T>({
      config: options.config,
      role: "designGemini",
      prompt: options.prompt,
      cwd: options.cwd,
      templates: options.templates,
      validate: options.validate
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown Gemini design failure.");
    const rollbackApplied = snapshot ? await restoreWorkspaceSnapshot(snapshot) : false;
    const nextAction = buildGeminiNextAction(failure);
    const rollbackText = rollbackApplied
      ? "Rollback: reverted changes made during this designGemini run."
      : "Rollback: unable to confirm rollback automatically for this designGemini run.";
    throw new Error(`${failure.message}\n${rollbackText}\nNext action: ${nextAction}`);
  }
}

function parseGeminiResponseJson<T>(response: unknown): T {
  if (response && typeof response === "object") {
    return response as T;
  }
  if (typeof response !== "string") {
    throw new Error("Gemini CLI JSON output did not include a parseable response payload.");
  }

  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1]?.trim() || trimmed;
  return JSON.parse(jsonText) as T;
}

function replaceTemplate(value: string, templates: Record<string, string>): string {
  let result = value;
  for (const [key, replacement] of Object.entries(templates)) {
    result = result.replaceAll(`{{${key}}}`, replacement);
  }
  return result;
}

async function createWorkspaceSnapshot(root: string): Promise<WorkspaceSnapshot | null> {
  try {
    const files = await listWorkspaceFiles(root);
    const snapshot = new Map<string, { contents: Buffer; hash: string }>();
    await Promise.all(files.map(async (relativePath) => {
      try {
        const contents = await readFile(path.join(root, relativePath));
        snapshot.set(relativePath, { contents, hash: contentHash(contents) });
      } catch {
        // ignore files that disappear during snapshot creation
      }
    }));
    return { root, files: snapshot };
  } catch {
    return null;
  }
}

async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<boolean> {
  try {
    const currentFiles = new Set(await listWorkspaceFiles(snapshot.root));
    const baselineFiles = new Set(snapshot.files.keys());
    const changedFiles = new Set<string>();

    await Promise.all(Array.from(snapshot.files.entries()).map(async ([relativePath, baseline]) => {
      try {
        const currentContents = await readFile(path.join(snapshot.root, relativePath));
        if (contentHash(currentContents) !== baseline.hash) {
          changedFiles.add(relativePath);
        }
      } catch {
        changedFiles.add(relativePath);
      }
    }));

    for (const relativePath of currentFiles) {
      if (!baselineFiles.has(relativePath)) {
        changedFiles.add(relativePath);
      }
    }

    await Promise.all(Array.from(changedFiles).filter((relativePath) => !baselineFiles.has(relativePath)).map(async (relativePath) => {
      await rm(path.join(snapshot.root, relativePath), { force: true });
    }));

    await Promise.all(Array.from(changedFiles).filter((relativePath) => baselineFiles.has(relativePath)).map(async (relativePath) => {
      const baseline = snapshot.files.get(relativePath);
      if (!baseline) {
        return;
      }
      const absolutePath = path.join(snapshot.root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, baseline.contents);
    }));

    return true;
  } catch {
    return false;
  }
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const gitTracked = await listGitWorkspaceFiles(root);
  if (gitTracked) {
    return gitTracked;
  }
  return walkWorkspaceFiles(root);
}

async function listGitWorkspaceFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "-z", "-c", "-o", "--exclude-standard"], {
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function walkWorkspaceFiles(root: string, relativeDir = ""): Promise<string[]> {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (shouldSkipSnapshotPath(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await walkWorkspaceFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function shouldSkipSnapshotPath(name: string): boolean {
  return [".git", "node_modules", ".next", "dist", "build", "coverage", "out", "target"].includes(name);
}

function buildGeminiNextAction(error: Error): string {
  const message = error.message.toLowerCase();
  if (message.includes("failed to start gemini cli") || message.includes("enoent")) {
    return "Ensure the Gemini CLI is installed or set geminiCli.command in .opencode/opencode-with-claude.jsonc.";
  }
  if (message.includes("timed out")) {
    return "Retry after increasing geminiCli.timeoutMs or simplifying the request.";
  }
  if (message.includes("auth") || message.includes("api key") || message.includes("login") || message.includes("credential")) {
    return "Authenticate Gemini CLI or configure the required API key before retrying.";
  }
  return "Inspect the Gemini CLI error output and retry after fixing the reported issue.";
}

function contentHash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function validateGeminiDesignSummary(value: unknown): { summary: string } {
  if (!value || typeof value !== "object" || typeof (value as { summary?: unknown }).summary !== "string") {
    throw new Error("Gemini CLI returned invalid design output: expected JSON object with string summary.");
  }
  return { summary: (value as { summary: string }).summary };
}

export function validateGeminiReviewResult(value: unknown): { decision: "approved" | "rejected"; summary: string } {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini CLI returned invalid review output: expected JSON object.");
  }

  const candidate = value as { decision?: unknown; summary?: unknown };
  if ((candidate.decision !== "approved" && candidate.decision !== "rejected") || typeof candidate.summary !== "string") {
    throw new Error("Gemini CLI returned invalid review output: expected decision=approved|rejected and string summary.");
  }

  return {
    decision: candidate.decision,
    summary: candidate.summary
  };
}
