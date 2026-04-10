export function mapTool(name: string, input?: unknown): { name: string; input?: unknown; executed: boolean; skip?: boolean } {
  if (name === "ToolSearch" || name === "Agent" || name === "AskFollowupQuestion") {
    return { name, input, executed: true, skip: true };
  }

  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    if (parts.length >= 2) {
      return {
        name: `${parts[0]}_${parts.slice(1).join("_")}`,
        input,
        executed: false
      };
    }
  }

  return {
    name: name.toLowerCase(),
    input,
    executed: true
  };
}
