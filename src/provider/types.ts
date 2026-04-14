export interface ProviderCliConfig {
  provider: string;
  cliPath: string;
  cwd?: string;
  skipPermissions?: boolean;
}

export interface WithClaudeConfig extends ProviderCliConfig {}

export interface WithClaudeProviderSettings {
  cliPath?: string;
  cwd?: string;
  name?: string;
  skipPermissions?: boolean;
}

export interface ClaudeCliStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    model?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      id?: string;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
      thinking?: string;
    }>;
  };
  content_block?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: string;
    thinking?: string;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
  tool?: {
    name?: string;
    id?: string;
    input?: unknown;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  duration_ms?: number;
  result?: string;
  is_error?: boolean;
  index?: number;
}

export interface GeminiCliStreamMessage {
  type: string;
  timestamp?: string;
  session_id?: string;
  model?: string;
  content?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: unknown;
  status?: string;
  output?: unknown;
  error?: unknown;
  stats?: {
    models?: Record<string, {
      tokens?: {
        prompt?: number;
        input?: number;
        candidates?: number;
        output?: number;
        total?: number;
      };
    }>;
  };
}
