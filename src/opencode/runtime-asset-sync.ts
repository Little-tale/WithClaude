import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginInput } from "@opencode-ai/plugin";

import { defaultOpenCodeConfigDir } from "./default-config-dir.js";
import { bundledOverrideTemplate } from "./override-template.js";
import { ensurePluginRuntimeBootstrap } from "./plugin-runtime-bootstrap.js";
import { isTopLevelSessionCreated, type SessionEventLike } from "./session-event.js";
import { parseJsoncObject, readBundledDefaultConfig } from "./with-claude-config.js";

const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function syncBundledFile(configDir: string, relativePath: string): Promise<boolean> {
  const source = path.join(packageRoot, relativePath);
  const target = path.join(configDir, relativePath);
  const sourceContent = await readFile(source, "utf8");
  try {
    const targetContent = await readFile(target, "utf8");
    if (targetContent === sourceContent) {
      return false;
    }
  } catch {
    // target missing; continue
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return true;
}

async function migrateLegacyOverrideFile(configDir: string): Promise<boolean> {
  const target = path.join(configDir, ".opencode", "opencode-with-claude.jsonc");
  let existingContent: string;
  try {
    existingContent = await readFile(target, "utf8");
  } catch {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bundledOverrideTemplate(), "utf8");
    return true;
  }

  let existingParsed: unknown;
  try {
    existingParsed = parseJsoncObject(existingContent);
  } catch {
    return false;
  }
  const bundledParsed = await readBundledDefaultConfig();
  if (JSON.stringify(existingParsed) !== JSON.stringify(bundledParsed)) {
    return false;
  }

  await writeFile(target, bundledOverrideTemplate(), "utf8");
  return true;
}

export function createRuntimeAssetSyncHook(ctx: PluginInput) {
  let fired = false;

  return {
    event: async ({ event }: { event: SessionEventLike }) => {
      if (fired || !isTopLevelSessionCreated(event)) return;
      fired = true;

      const configDir = defaultOpenCodeConfigDir();
      const bootstrap = ensurePluginRuntimeBootstrap(configDir);
      const results = await Promise.all([
        migrateLegacyOverrideFile(configDir),
        syncBundledFile(configDir, ".opencode/agents/implClaude.md"),
        syncBundledFile(configDir, ".opencode/agents/planClaude.md"),
        syncBundledFile(configDir, ".opencode/agents/reviewClaude.md"),
        syncBundledFile(configDir, ".opencode/command/implClaude.md"),
        syncBundledFile(configDir, ".opencode/command/planClaude.md"),
        syncBundledFile(configDir, ".opencode/command/reviewClaude.md")
      ]);

      if (!results.some(Boolean) && !bootstrap.dependencyChanged && !bootstrap.shimChanged) {
        return;
      }

      await ctx.client.tui.showToast({
        body: {
          title: "WithClaude Updated",
          message: "Bundled prompts and default Claude settings were synced from the installed package.",
          variant: "success",
          duration: 5000
        }
      }).catch(() => {});
    }
  };
}
