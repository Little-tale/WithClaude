import type { LanguageModelV2 } from "@ai-sdk/provider";

type Prompt = Parameters<LanguageModelV2["doGenerate"]>[0] extends infer T
  ? T extends { prompt: infer P }
    ? P
    : never
  : never;

export function getClaudeUserMessage(prompt: Prompt): string {
  const content: Array<{ type: string; text?: string; tool_use_id?: string; content?: string }> = [];
  const contextText: string[] = [];

  for (const message of prompt) {
    if (typeof message.content === "string") {
      if (message.role === "user") {
        content.push({ type: "text", text: message.content });
      } else if (message.content.trim()) {
        contextText.push(`[${message.role}] ${message.content}`);
      }
      continue;
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content as any[]) {
        if (part.type === "text") {
          if (message.role === "user") {
            content.push({ type: "text", text: part.text });
          } else if (typeof part.text === "string" && part.text.trim()) {
            contextText.push(`[${message.role}] ${part.text}`);
          }
        }
        if (message.role === "user" && part.type === "tool-result") {
          content.push({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: typeof part.result === "string" ? part.result : JSON.stringify(part.result)
          });
        }
      }
    }
  }

  if (contextText.length > 0) {
    content.unshift({ type: "text", text: contextText.join("\n\n") });
  }

  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: content.length > 0
        ? content
        : [{ type: "text", text: "Continue." }]
    }
  });
}

export function getGeminiPromptText(prompt: Prompt): string {
  const sections: string[] = [];

  for (const message of prompt) {
    const textParts: string[] = [];

    if (typeof message.content === "string") {
      if (message.content.trim()) {
        textParts.push(message.content.trim());
      }
    } else if (Array.isArray(message.content)) {
      for (const part of message.content as Array<{ type?: string; text?: string; toolCallId?: string; result?: unknown }>) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          textParts.push(part.text.trim());
        }
        if (part.type === "tool-result") {
          textParts.push(`Tool result (${part.toolCallId ?? "unknown"}): ${typeof part.result === "string" ? part.result : JSON.stringify(part.result ?? {})}`);
        }
      }
    }

    if (textParts.length > 0) {
      sections.push(`[${message.role}]\n${textParts.join("\n\n")}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : "[user]\nContinue.";
}
