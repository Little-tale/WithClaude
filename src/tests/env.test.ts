import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("loadEnv helper prefers cwd .env over package .env for non-shell values", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-env-test-"));
  const fakeProjectRoot = path.join(tempRoot, "package-root");
  const cwdRoot = path.join(tempRoot, "workspace");
  await mkdir(fakeProjectRoot, { recursive: true });
  await mkdir(cwdRoot, { recursive: true });
  await writeFile(path.join(fakeProjectRoot, ".env"), "IMPLEMENTER_COMMAND=claude\nDATA_DIR=./pkg-data\n", "utf8");
  await writeFile(path.join(cwdRoot, ".env"), "IMPLEMENTER_COMMAND=custom-claude\nDATA_DIR=./cwd-data\n", "utf8");

  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  try {
    process.chdir(cwdRoot);
    process.env = { ...originalEnv };
    delete process.env.IMPLEMENTER_COMMAND;
    const { loadEnvForProjectRoot } = await import("../test-support/env-loader-test-helper.js");
    const env = loadEnvForProjectRoot(fakeProjectRoot);
    assert.equal(env.IMPLEMENTER_COMMAND, "custom-claude");
    assert.match(env.dataFilePath, /cwd-data\/tasks\.json$/);
  } finally {
    process.chdir(originalCwd);
    process.env = originalEnv;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
