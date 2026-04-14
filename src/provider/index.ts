import type { LanguageModelV2, ProviderV2 } from "@ai-sdk/provider";

import { defaultOpenCodeConfigDir } from "../opencode/default-config-dir.js";
import { ensurePluginRuntimeBootstrap } from "../opencode/plugin-runtime-bootstrap.js";
import { WithClaudeLanguageModel } from "./with-claude-language-model.js";
import { WithGeminiLanguageModel } from "./with-gemini-language-model.js";
import type { WithClaudeProviderSettings } from "./types.js";

let bootstrappedRuntime = false;

function bootstrapPluginRuntimeOnce(): void {
  if (bootstrappedRuntime) {
    return;
  }
  bootstrappedRuntime = true;
  try {
    ensurePluginRuntimeBootstrap(defaultOpenCodeConfigDir());
  } catch {
    // Provider creation should not fail just because plugin bootstrap cannot write.
  }
}

export interface WithClaudeProvider extends ProviderV2 {
  (modelId: string): LanguageModelV2;
  languageModel(modelId: string): LanguageModelV2;
}

export interface WithGeminiProvider extends ProviderV2 {
  (modelId: string): LanguageModelV2;
  languageModel(modelId: string): LanguageModelV2;
}

export function createWithClaude(settings: WithClaudeProviderSettings = {}): WithClaudeProvider {
  bootstrapPluginRuntimeOnce();
  const providerName = settings.name ?? "with-claude";
  const cliPath = settings.cliPath ?? (providerName === "with-gemini" ? (process.env.GEMINI_CLI_PATH ?? "gemini") : (process.env.CLAUDE_CLI_PATH ?? "claude"));
  const cwd = settings.cwd ?? process.cwd();

  const createModel = (modelId: string): LanguageModelV2 => {
    if (providerName === "with-gemini") {
      return new WithGeminiLanguageModel(modelId, {
        provider: providerName,
        cliPath,
        cwd,
        skipPermissions: settings.skipPermissions ?? false
      });
    }
    return new WithClaudeLanguageModel(modelId, {
      provider: providerName,
      cliPath,
      cwd,
      skipPermissions: settings.skipPermissions ?? true
    });
  };

  const provider = function (modelId: string) {
    return createModel(modelId);
  } as WithClaudeProvider;

  provider.languageModel = createModel;
  return provider;
}

export function createWithGemini(settings: WithClaudeProviderSettings = {}): WithGeminiProvider {
  return createWithClaude({ ...settings, name: "with-gemini", skipPermissions: settings.skipPermissions ?? false }) as WithGeminiProvider;
}

export { WithClaudeLanguageModel } from "./with-claude-language-model.js";
export { WithGeminiLanguageModel } from "./with-gemini-language-model.js";
export type { WithClaudeProviderSettings } from "./types.js";
