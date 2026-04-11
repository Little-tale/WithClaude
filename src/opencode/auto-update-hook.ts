import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PluginInput } from "@opencode-ai/plugin";

import { PACKAGE_VERSION } from "../generated/package-version.js";
import { PACKAGE_NAME } from "../package-identity.js";
import { defaultOpenCodeConfigDir } from "./default-config-dir.js";
import { ensurePluginRuntimeBootstrap } from "./plugin-runtime-bootstrap.js";
import { isTopLevelSessionCreated, type SessionEventLike } from "./session-event.js";

type PackageJsonShape = {
  dependencies?: Record<string, string>;
  version?: string;
};

type UpdateCheckResult = {
  updated: boolean;
  updatedTo?: string;
  bootstrapped: boolean;
};

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readInstalledVersion(configDir: string): Promise<string | null> {
  const packageJsonPath = path.join(configDir, "node_modules", PACKAGE_NAME, "package.json");
  const parsed = await readJsonFile<PackageJsonShape>(packageJsonPath);
  return parsed?.version ?? null;
}

async function readDependencySpec(configDir: string): Promise<string | null> {
  const parsed = await readJsonFile<PackageJsonShape>(path.join(configDir, "package.json"));
  return parsed?.dependencies?.[PACKAGE_NAME] ?? null;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`);
    if (!response.ok) return null;
    const parsed = await response.json() as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function runBunAdd(ctx: PluginInput, configDir: string): Promise<boolean> {
  const result = await ctx.$.cwd(configDir).nothrow()`bun add ${`${PACKAGE_NAME}@latest`}`;
  return result.exitCode === 0;
}

export function createAutoUpdateHook(ctx: PluginInput) {
  let fired = false;

  return {
    event: async ({ event }: { event: SessionEventLike }): Promise<UpdateCheckResult> => {
      if (fired || !isTopLevelSessionCreated(event)) return { updated: false, bootstrapped: false };
      fired = true;

      const configDir = defaultOpenCodeConfigDir();
      const bootstrap = ensurePluginRuntimeBootstrap(configDir);
      const dependencySpec = await readDependencySpec(configDir);
      const bootstrapped = bootstrap.dependencyChanged || bootstrap.shimChanged;
      if (!dependencySpec || dependencySpec !== "latest") {
        return { updated: false, bootstrapped };
      }

      const [installedVersion, latestVersion] = await Promise.all([
        readInstalledVersion(configDir),
        fetchLatestVersion()
      ]);

      const currentVersion = installedVersion ?? PACKAGE_VERSION;
      if (!latestVersion || latestVersion === currentVersion) {
        return { updated: false, bootstrapped };
      }

      const installSucceeded = await runBunAdd(ctx, configDir);
      if (!installSucceeded) {
        return { updated: false, bootstrapped };
      }

      await ctx.client.tui.showToast({
        body: {
          title: "WithClaude Auto-updated",
          message: `Updated ${PACKAGE_NAME} from ${currentVersion} to ${latestVersion}. Restart OpenCode if you want the new runtime immediately.`,
          variant: "success",
          duration: 7000
        }
      }).catch(() => {});

      return { updated: true, updatedTo: latestVersion, bootstrapped };
    }
  };
}
