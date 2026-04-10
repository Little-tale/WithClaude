import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PACKAGE_NAME = "opencode-with-claude";

type InstallOptions = {
  cwd: string;
  force: boolean;
};

function parseArgs(argv: string[]): InstallOptions {
  let cwd = process.cwd();
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "install") continue;
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--cwd") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --cwd");
      }
      cwd = path.resolve(next);
      index += 1;
      continue;
    }
  }

  return { cwd, force };
}

function bundledRoot(): string {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const base = path.basename(currentDir);
  if (base === "src" || base === "dist") {
    return path.dirname(currentDir);
  }
  return currentDir;
}

function installTarget(relativePath: string, cwd: string): string {
  return path.join(cwd, relativePath);
}

async function copyBundledFile(cwd: string, relativePath: string, force: boolean): Promise<"written" | "skipped"> {
  const source = path.join(bundledRoot(), relativePath);
  const target = installTarget(relativePath, cwd);
  await mkdir(path.dirname(target), { recursive: true });

  try {
    if (!force) {
      await readFile(target, "utf8");
      return "skipped";
    }
  } catch {
    // target missing; continue
  }

  await copyFile(source, target);
  return "written";
}

function providerConfigSnippet(): string {
  return [
    '{',
    '  "$schema": "https://opencode.ai/config.json",',
    '  "provider": {',
    '    "with-claude": {',
    `      "npm": "${PACKAGE_NAME}",`,
    '      "models": {',
    '        "haiku": { "name": "WithClaude Haiku", "attachment": false, "limit": { "context": 200000, "output": 8192 }, "capabilities": { "reasoning": false, "toolcall": true } },',
    '        "sonnet": { "name": "WithClaude Sonnet", "attachment": false, "limit": { "context": 1000000, "output": 16384 }, "capabilities": { "reasoning": true, "toolcall": true } },',
    '        "opus": { "name": "WithClaude Opus", "attachment": false, "limit": { "context": 1000000, "output": 16384 }, "capabilities": { "reasoning": true, "toolcall": true } }',
    '      },',
    '      "options": { "cliPath": "claude" }',
    '    }',
    '  },',
    '  "agent": {',
    '    "implClaude": { "description": "Claude implementation executor for approved workflow tasks", "mode": "subagent", "hidden": false, "model": "with-claude/sonnet", "prompt": "{file:.opencode/agents/implClaude.md}", "tools": {} },',
    '    "planClaude": { "description": "Claude planning assistant for workflow task plans", "mode": "subagent", "hidden": false, "model": "with-claude/opus", "prompt": "{file:.opencode/agents/planClaude.md}", "tools": {} },',
    '    "reviewClaude": { "description": "Claude review assistant for implementation verification", "mode": "subagent", "hidden": false, "model": "with-claude/sonnet", "prompt": "{file:.opencode/agents/reviewClaude.md}", "tools": {} }',
    '  }',
    '}',
    ''
  ].join("\n");
}

async function writeProjectConfig(cwd: string, force: boolean): Promise<{ mode: "created" | "snippet" | "skipped"; path: string }> {
  const target = installTarget("opencode.jsonc", cwd);
  const snippetTarget = installTarget("opencode-with-claude.snippet.jsonc", cwd);
  const content = providerConfigSnippet();

  try {
    await readFile(target, "utf8");
    if (!force) {
      await writeFile(snippetTarget, content, "utf8");
      return { mode: "snippet", path: snippetTarget };
    }
  } catch {
    // missing; create full config
  }

  await writeFile(target, content, "utf8");
  return { mode: "created", path: target };
}

export async function installOpenCodeWithClaude(options: InstallOptions): Promise<string> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const relativePath of [
    ".opencode/opencode-with-claude.jsonc",
    ".opencode/agents/implClaude.md",
    ".opencode/agents/planClaude.md",
    ".opencode/agents/reviewClaude.md",
    ".opencode/command/implClaude.md",
    ".opencode/command/planClaude.md",
    ".opencode/command/reviewClaude.md"
  ]) {
    const outcome = await copyBundledFile(options.cwd, relativePath, options.force);
    (outcome === "written" ? copied : skipped).push(relativePath);
  }

  const config = await writeProjectConfig(options.cwd, options.force);

  return [
    `Installed ${PACKAGE_NAME} into ${options.cwd}`,
    copied.length > 0 ? `Wrote: ${copied.join(", ")}` : "Wrote: (none)",
    skipped.length > 0 ? `Kept existing: ${skipped.join(", ")}` : "Kept existing: (none)",
    config.mode === "created"
      ? `Created project config: ${path.relative(options.cwd, config.path) || "opencode.jsonc"}`
      : `Existing opencode.jsonc preserved. Merge snippet: ${path.relative(options.cwd, config.path)}`,
    "Next: open OpenCode in this directory and use @planClaude / @implClaude / @reviewClaude."
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = argv;
  if (args.length === 0 || args[0] !== "install") {
    console.error("Usage: opencode-with-claude install [--cwd <path>] [--force]");
    process.exitCode = 1;
    return;
  }

  const options = parseArgs(args);
  const result = await installOpenCodeWithClaude(options);
  process.stdout.write(`${result}\n`);
}
