import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClaudeCliConfig } from "../agents/claude-cli.js";
import type { GeminiCliConfig } from "../agents/gemini-cli.js";
import { defaultOpenCodeConfigDir } from "./default-config-dir.js";

const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export type WithClaudeAgentConfig = {
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  model?: string;
  prompt?: string;
  tools?: Record<string, boolean>;
};

export type WithClaudeConfig = {
  agent?: Record<string, WithClaudeAgentConfig>;
  claudeCli?: ClaudeCliConfig;
  geminiCli?: GeminiCliConfig;
};

export function parseJsoncObject(content: string): unknown {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutLineComments);
}

export async function readWithClaudeConfigFile(filePath: string): Promise<WithClaudeConfig> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = parseJsoncObject(content) as unknown;
    return parsed && typeof parsed === "object" ? normalizeLegacyGeminiConfig(parsed as WithClaudeConfig) : {};
  } catch {
    return {};
  }
}

function normalizeLegacyGeminiConfig(config: WithClaudeConfig): WithClaudeConfig {
  const geminiCli = config.geminiCli as (GeminiCliConfig & { defaultModel?: string }) | undefined;
  if (!geminiCli) {
    return config;
  }

  if (geminiCli.auto || !geminiCli.defaultModel) {
    return config;
  }

  return {
    ...config,
    geminiCli: {
      ...geminiCli,
      auto: geminiCli.defaultModel
    }
  };
}

export function mergeWithClaudeConfig(base: WithClaudeConfig, override: WithClaudeConfig): WithClaudeConfig {
  const mergedAgent = base.agent || override.agent
    ? Object.fromEntries(
        Array.from(new Set([...Object.keys(base.agent ?? {}), ...Object.keys(override.agent ?? {})])).map((agentName) => [
          agentName,
          {
            ...(base.agent?.[agentName] ?? {}),
            ...(override.agent?.[agentName] ?? {})
          }
        ])
      )
    : undefined;

  const mergedClaudeCli = mergeCliSection(base.claudeCli, override.claudeCli);
  const mergedGeminiCli = mergeCliSection(base.geminiCli, override.geminiCli);

  return {
    ...(base ?? {}),
    ...(override ?? {}),
    ...(mergedAgent ? { agent: mergedAgent } : {}),
    ...(mergedClaudeCli ? { claudeCli: mergedClaudeCli } : {}),
    ...(mergedGeminiCli ? { geminiCli: mergedGeminiCli } : {})
  };
}

function mergeCliSection<T extends { roles?: Record<string, Record<string, unknown>> }>(
  base: T | undefined,
  override: T | undefined
): T | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(override ?? {}),
    roles: Object.fromEntries(
      Array.from(new Set([...Object.keys(base?.roles ?? {}), ...Object.keys(override?.roles ?? {})])).map((roleName) => [
        roleName,
        {
          ...(base?.roles?.[roleName] ?? {}),
          ...(override?.roles?.[roleName] ?? {})
        }
      ])
    )
  } as T;
}

export async function loadWithClaudeConfig(projectRoot: string): Promise<WithClaudeConfig> {
  const bundledFilePath = path.join(packageRoot, ".opencode", "opencode-with-claude.jsonc");
  const globalFilePath = path.join(defaultOpenCodeConfigDir(), ".opencode", "opencode-with-claude.jsonc");
  const projectFilePath = path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc");
  const [bundledConfig, globalConfig, projectConfig] = await Promise.all([
    readWithClaudeConfigFile(bundledFilePath),
    readWithClaudeConfigFile(globalFilePath),
    readWithClaudeConfigFile(projectFilePath)
  ]);

  return mergeWithClaudeConfig(mergeWithClaudeConfig(bundledConfig, globalConfig), projectConfig);
}

export async function readBundledDefaultConfig(): Promise<WithClaudeConfig> {
  return readWithClaudeConfigFile(path.join(packageRoot, ".opencode", "opencode-with-claude.jsonc"));
}
