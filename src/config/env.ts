import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "../..");

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default("./data"),
  IMPLEMENTER_COMMAND: z.string().optional(),
  IMPLEMENTER_ARGS: z.string().optional(),
  IMPLEMENTER_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  IMPLEMENTER_ALLOW_RAW_STDOUT: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true" || value === "1"),
  IMPLEMENTER_MESSAGE_PREFIX: z.string().optional(),
  IMPLEMENTER_PROMPT_ARG_TEMPLATE: z.string().optional(),
  IMPLEMENTER_PROMPT_PREFIX: z.string().optional(),
  IMPLEMENTER_PROMPT_SUFFIX: z.string().optional(),
  IMPLEMENTER_WRITE_PROMPT_TO_STDIN: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === undefined || value === true || value === "true" || value === "1"),
});

export type AppEnv = z.infer<typeof envSchema> & {
  projectRoot: string;
  dataFilePath: string;
};

export function loadEnv(): AppEnv {
  const shellEnvKeys = new Set(Object.keys(process.env).filter((key) => process.env[key] !== undefined));
  applyDotenv(path.resolve(projectRoot, ".env"), shellEnvKeys, false);
  const cwdDotenv = path.resolve(process.cwd(), ".env");
  if (cwdDotenv !== path.resolve(projectRoot, ".env")) {
    applyDotenv(cwdDotenv, shellEnvKeys, true);
  }

  const parsed = envSchema.parse(process.env);
  const dataDir = path.isAbsolute(parsed.DATA_DIR) ? parsed.DATA_DIR : path.resolve(projectRoot, parsed.DATA_DIR);

  return {
    ...parsed,
    projectRoot,
    dataFilePath: path.resolve(dataDir, "tasks.json")
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
