import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const examplePath = path.join(projectRoot, "opencode.example.jsonc");
const outputPath = path.join(projectRoot, "opencode.jsonc");
const localProviderUrl = pathToFileURL(path.join(projectRoot, "dist", "index.js")).href;

function stripJsoncComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const raw = await readFile(examplePath, "utf8");
const config = JSON.parse(stripJsoncComments(raw));

for (const provider of Object.values(config.provider ?? {})) {
  if (provider && typeof provider === "object" && "npm" in provider) {
    provider.npm = localProviderUrl;
  }
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${path.relative(projectRoot, outputPath)} using ${localProviderUrl}\n`);
