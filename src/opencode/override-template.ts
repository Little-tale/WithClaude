export function bundledOverrideTemplate(): string {
  return [
    "{",
    "  // Optional user overrides only.",
    "  // Bundled defaults for role models and Claude CLI behavior now load from the installed npm package at runtime.",
    "  // Add only the settings you want to override locally.",
    "  // Example:",
    "  // \"claudeCli\": {",
    "  //   \"roles\": {",
    "  //     \"planClaude\": { \"model\": \"opus\" }",
    "  //   }",
    "  // }",
    "}",
    ""
  ].join("\n");
}
