import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runGeminiCliJson } from "../agents/gemini-cli.js";

async function writeFakeGeminiJsonScript(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-gemini-cli-"));
  const file = path.join(dir, "fake-gemini-json.js");
  await writeFile(
    file,
    [
      "#!/usr/bin/env node",
      'const args = process.argv.slice(2);',
      'process.stdout.write(JSON.stringify({ response: JSON.stringify({ args }) }));'
    ].join("\n"),
    "utf8"
  );
  await chmod(file, 0o755);
  return file;
}

test("runGeminiCliJson adds yolo approval mode for write-enabled Gemini roles", async () => {
  const script = await writeFakeGeminiJsonScript();
  const result = await runGeminiCliJson<{ args: string[] }>({
    config: {
      command: process.execPath,
      commonArgs: [script, "--output-format", "json", "-p"],
      roles: {
        designGemini: {
          executionPolicy: "write-enabled"
        }
      }
    },
    role: "designGemini",
    prompt: "hello",
    cwd: process.cwd()
  });

  assert.deepEqual(result.args.slice(-3), ["--approval-mode", "yolo", "hello"]);
});

test("runGeminiCliJson keeps reviewGemini read-only by default", async () => {
  const script = await writeFakeGeminiJsonScript();
  const result = await runGeminiCliJson<{ args: string[] }>({
    config: {
      command: process.execPath,
      commonArgs: [script, "--output-format", "json", "-p"],
      roles: {
        reviewGemini: {
          executionPolicy: "read-only"
        }
      }
    },
    role: "reviewGemini",
    prompt: "hello",
    cwd: process.cwd()
  });

  assert.ok(!result.args.includes("--approval-mode"));
  assert.ok(!result.args.includes("--yolo"));
});
