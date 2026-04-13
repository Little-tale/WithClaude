export function bundledOverrideTemplate(): string {
  return [
    "{",
    "  // Optional user overrides only.",
    "  // Bundled defaults for role models and Claude CLI behavior now load from the installed npm package at runtime.",
    "  // Add only the settings you want to override locally.",
    "  // To switch model for all roles:",
    "  // \"claudeCli\": { \"defaultModel\": \"opus\" }",
    "  //",
    "  // To override a single role only:",
    "  // \"claudeCli\": { \"roles\": { \"planClaude\": { \"model\": \"opus\" } } }",
    "}",
    ""
  ].join("\n");
}
