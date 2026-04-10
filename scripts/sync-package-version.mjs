import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const outputPath = path.join(repoRoot, "src", "generated", "package-version.ts");
const content = `export const PACKAGE_VERSION = ${JSON.stringify(packageJson.version)};\n`;

await writeFile(outputPath, content, "utf8");
