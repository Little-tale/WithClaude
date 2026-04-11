import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export type LoadedSubagent = {
  name: string;
  description: string;
  mode: "subagent" | "primary" | "all";
  prompt: string;
  tools?: Record<string, boolean>;
};

export async function loadBundledSubagent(name: string): Promise<LoadedSubagent> {
  const filePath = path.join(packageRoot, ".opencode", "agents", `${name}.md`);
  const content = await readFile(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid subagent manifest: ${filePath}`);
  }

  const frontmatter = match[1];
  const prompt = match[2].trim();
  let description = "";
  let mode: LoadedSubagent["mode"] = "subagent";
  const tools: Record<string, boolean> = {};
  let inTools = false;
  let currentToolIndent = -1;

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.trim();
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    if (line.startsWith("description:")) {
      description = line.slice("description:".length).trim();
      inTools = false;
      currentToolIndent = -1;
      continue;
    }
    if (line.startsWith("mode:")) {
      const parsed = line.slice("mode:".length).trim();
      if (parsed === "subagent" || parsed === "primary" || parsed === "all") {
        mode = parsed;
      }
      inTools = false;
      currentToolIndent = -1;
      continue;
    }
    if (line === "tools:") {
      inTools = true;
      currentToolIndent = -1;
      continue;
    }
    if (inTools && line.includes(":")) {
      const [toolName, rawValue] = line.split(/:\s*/, 2);
      if (toolName) {
        tools[toolName.trim()] = rawValue ? rawValue.trim() === "true" : true;
        currentToolIndent = indent;
      }
      continue;
    }
    if (inTools && line.length > 0 && currentToolIndent >= 0 && indent > currentToolIndent) {
      continue;
    }
    inTools = false;
    currentToolIndent = -1;
  }

  return {
    name,
    description,
    mode,
    prompt,
    tools: Object.keys(tools).length > 0 ? tools : undefined
  };
}
