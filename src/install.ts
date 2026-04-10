import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const PACKAGE_NAME = "opencode-with-claude";

type InstallOptions = {
  configDir: string;
  force: boolean;
};

type OpenCodeConfig = {
  $schema?: string;
  provider?: Record<string, unknown>;
  agent?: Record<string, unknown>;
  [key: string]: unknown;
};

function defaultConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome
    ? path.resolve(xdgConfigHome, "opencode")
    : path.join(os.homedir(), ".config", "opencode");
}

export function parseArgs(argv: string[]): InstallOptions {
  let configDir = defaultConfigDir();
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "install") continue;
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--config-dir") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --config-dir");
      }
      configDir = path.resolve(next);
      index += 1;
      continue;
    }
  }

  return { configDir, force };
}

function bundledRoot(): string {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const base = path.basename(currentDir);
  if (base === "src" || base === "dist") {
    return path.dirname(currentDir);
  }
  return currentDir;
}

function installTarget(relativePath: string, configDir: string): string {
  return path.join(configDir, relativePath);
}

function promptReference(configDir: string, relativePath: string): string {
  return `{file:${installTarget(relativePath, configDir)}}`;
}

async function copyBundledFile(configDir: string, relativePath: string, force: boolean): Promise<"written" | "skipped"> {
  const source = path.join(bundledRoot(), relativePath);
  const target = installTarget(relativePath, configDir);
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

function withClaudePatch(configDir: string): OpenCodeConfig {
  return {
    provider: {
      "with-claude": {
        npm: PACKAGE_NAME,
        models: {
          haiku: {
            name: "WithClaude Haiku",
            attachment: false,
            limit: { context: 200000, output: 8192 },
            capabilities: { reasoning: false, toolcall: true }
          },
          sonnet: {
            name: "WithClaude Sonnet",
            attachment: false,
            limit: { context: 1000000, output: 16384 },
            capabilities: { reasoning: true, toolcall: true }
          },
          opus: {
            name: "WithClaude Opus",
            attachment: false,
            limit: { context: 1000000, output: 16384 },
            capabilities: { reasoning: true, toolcall: true }
          }
        },
        options: { cliPath: "claude" }
      }
    },
    agent: {
      implClaude: {
        description: "Claude implementation executor for approved workflow tasks",
        mode: "subagent",
        hidden: false,
        model: "with-claude/sonnet",
        prompt: promptReference(configDir, ".opencode/agents/implClaude.md"),
        tools: {}
      },
      planClaude: {
        description: "Claude planning assistant for workflow task plans",
        mode: "subagent",
        hidden: false,
        model: "with-claude/opus",
        prompt: promptReference(configDir, ".opencode/agents/planClaude.md"),
        tools: {}
      },
      reviewClaude: {
        description: "Claude review assistant for implementation verification",
        mode: "subagent",
        hidden: false,
        model: "with-claude/sonnet",
        prompt: promptReference(configDir, ".opencode/agents/reviewClaude.md"),
        tools: {}
      }
    }
  };
}

function deepMerge(base: OpenCodeConfig, patch: OpenCodeConfig): OpenCodeConfig {
  return {
    ...base,
    provider: {
      ...(base.provider ?? {}),
      ...(patch.provider ?? {})
    },
    agent: {
      ...(base.agent ?? {}),
      ...(patch.agent ?? {})
    }
  };
}

async function readGlobalConfig(configDir: string): Promise<OpenCodeConfig> {
  const target = installTarget("opencode.json", configDir);
  try {
    const existing = await readFile(target, "utf8");
    return JSON.parse(existing) as OpenCodeConfig;
  } catch {
    return { $schema: "https://opencode.ai/config.json" };
  }
}

async function writeGlobalConfig(configDir: string): Promise<string> {
  const target = installTarget("opencode.json", configDir);
  await mkdir(path.dirname(target), { recursive: true });

  const current = await readGlobalConfig(configDir);
  const merged = deepMerge(current, withClaudePatch(configDir));
  if (!merged.$schema) {
    merged.$schema = "https://opencode.ai/config.json";
  }

  await writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return target;
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
    const outcome = await copyBundledFile(options.configDir, relativePath, options.force);
    (outcome === "written" ? copied : skipped).push(relativePath);
  }

  const configPath = await writeGlobalConfig(options.configDir);

  return [
    `Installed ${PACKAGE_NAME} into global OpenCode config: ${options.configDir}`,
    copied.length > 0 ? `Wrote: ${copied.join(", ")}` : "Wrote: (none)",
    skipped.length > 0 ? `Kept existing: ${skipped.join(", ")}` : "Kept existing: (none)",
    `Updated global config: ${path.relative(options.configDir, configPath) || "opencode.json"}`,
    "Next: open OpenCode anywhere and use @planClaude / @implClaude / @reviewClaude."
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = argv;
  if (args.length === 0 || args[0] !== "install") {
    console.error("Usage: opencode-with-claude install [--config-dir <path>] [--force]");
    process.exitCode = 1;
    return;
  }

  const options = parseArgs(args);
  const result = await installOpenCodeWithClaude(options);
  process.stdout.write(`${result}\n`);
}
