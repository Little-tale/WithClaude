import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { LOCAL_PLUGIN_FILE, PACKAGE_NAME, PLUGIN_IMPORT_SPEC } from "../package-identity.js";

type PackageJsonShape = {
  dependencies?: Record<string, string>;
};

function pluginShimSource(): string {
  return [
    `import plugin from "${PLUGIN_IMPORT_SPEC}";`,
    "",
    "export const WithClaudePlugin = plugin;",
    ""
  ].join("\n");
}

function readPackageJson(packageJsonPath: string): PackageJsonShape {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;
  } catch {
    return {};
  }
}

function ensurePluginDependency(configDir: string): boolean {
  const packageJsonPath = path.join(configDir, "package.json");
  const current = readPackageJson(packageJsonPath);
  const next: PackageJsonShape = {
    ...current,
    dependencies: {
      ...(current.dependencies ?? {}),
      [PACKAGE_NAME]: current.dependencies?.[PACKAGE_NAME] ?? "latest"
    }
  };

  if (JSON.stringify(current) === JSON.stringify(next)) {
    return false;
  }

  mkdirSync(configDir, { recursive: true });
  writeFileSync(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return true;
}

function ensurePluginShim(configDir: string): boolean {
  const pluginsDir = path.join(configDir, "plugins");
  const pluginFilePath = path.join(pluginsDir, LOCAL_PLUGIN_FILE);
  const content = pluginShimSource();

  if (existsSync(pluginFilePath) && readFileSync(pluginFilePath, "utf8") === content) {
    return false;
  }

  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(pluginFilePath, content, "utf8");
  return true;
}

export function ensurePluginRuntimeBootstrap(configDir: string): { dependencyChanged: boolean; shimChanged: boolean } {
  return {
    dependencyChanged: ensurePluginDependency(configDir),
    shimChanged: ensurePluginShim(configDir)
  };
}
