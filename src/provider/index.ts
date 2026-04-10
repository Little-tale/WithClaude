import type { LanguageModelV2, ProviderV2 } from "@ai-sdk/provider";

import { WithClaudeLanguageModel } from "./with-claude-language-model.js";
import type { WithClaudeProviderSettings } from "./types.js";

export interface WithClaudeProvider extends ProviderV2 {
  (modelId: string): LanguageModelV2;
  languageModel(modelId: string): LanguageModelV2;
}

export function createWithClaude(settings: WithClaudeProviderSettings = {}): WithClaudeProvider {
  const cliPath = settings.cliPath ?? process.env.CLAUDE_CLI_PATH ?? "claude";
  const cwd = settings.cwd ?? process.cwd();
  const providerName = settings.name ?? "with-claude";

  const createModel = (modelId: string): LanguageModelV2 => {
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

export { WithClaudeLanguageModel } from "./with-claude-language-model.js";
export type { WithClaudeProviderSettings } from "./types.js";
