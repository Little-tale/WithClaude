export function bundledOverrideTemplate(): string {
  return [
    "{",
    "  // Optional user overrides only.",
    "  // Bundled defaults for workflow role models and CLI behavior now load from the installed npm package at runtime.",
    "  // Add only the settings you want to override locally.",
    "  // To switch the default Claude model for all Claude roles:",
    "  // \"claudeCli\": { \"defaultModel\": \"opus\" }",
    "  //",
    "  // To override a single Claude role only:",
    "  // \"claudeCli\": { \"roles\": { \"planClaude\": { \"model\": \"opus\" } } }",
    "  //",
    "  // To override the Gemini CLI command or timeout:",
    "  // \"geminiCli\": { \"command\": \"gemini\", \"timeoutMs\": 900000 }",
    "}",
    ""
  ].join("\n");
}
