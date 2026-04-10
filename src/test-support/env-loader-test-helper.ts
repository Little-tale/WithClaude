import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseDotenv } from "dotenv";

export function loadEnvForProjectRoot(projectRoot: string) {
  const shellEnvKeys = new Set(Object.keys(process.env).filter((key) => process.env[key] !== undefined));
  applyDotenv(path.resolve(projectRoot, ".env"), shellEnvKeys, false);
  const cwdDotenv = path.resolve(process.cwd(), ".env");
  if (cwdDotenv !== path.resolve(projectRoot, ".env")) {
    applyDotenv(cwdDotenv, shellEnvKeys, true);
  }

  return {
    IMPLEMENTER_COMMAND: normalizeOptionalString(process.env.IMPLEMENTER_COMMAND),
    IMPLEMENTER_ARGS: normalizeOptionalString(process.env.IMPLEMENTER_ARGS),
    IMPLEMENTER_ALLOW_RAW_STDOUT: false,
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: true,
    dataFilePath: path.resolve(path.isAbsolute(process.env.DATA_DIR ?? "./data") ? process.env.DATA_DIR ?? "./data" : path.resolve(projectRoot, process.env.DATA_DIR ?? "./data"), "tasks.json")
  };
}

function applyDotenv(filePath: string, shellEnvKeys: Set<string>, overrideNonShell: boolean): void {
  if (!existsSync(filePath)) {
    return;
  }

  const parsed = parseDotenv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (shellEnvKeys.has(key)) {
      continue;
    }

    if (overrideNonShell || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
