import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export interface ActiveProcess {
  proc: ChildProcess;
  lineEmitter: EventEmitter;
}

const activeProcesses = new Map<string, ActiveProcess>();
const claudeSessions = new Map<string, string>();

export function getActiveProcess(key: string): ActiveProcess | undefined {
  return activeProcesses.get(key);
}

export function setClaudeSessionId(key: string, sessionId: string): void {
  claudeSessions.set(key, sessionId);
}

export function getClaudeSessionId(key: string): string | undefined {
  return claudeSessions.get(key);
}

export function deleteClaudeSessionId(key: string): void {
  claudeSessions.delete(key);
}

export function deleteActiveProcess(key: string): void {
  const active = activeProcesses.get(key);
  if (active) {
    active.proc.kill();
    activeProcesses.delete(key);
  }
}

export function sessionKey(cwd: string, modelId: string): string {
  return `${cwd}::${modelId}`;
}

export function buildCliArgs(options: {
  sessionKey: string;
  skipPermissions: boolean;
  includeSessionId?: boolean;
  model?: string;
}): string[] {
  const args = ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose"];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.includeSessionId !== false) {
    const sessionId = getClaudeSessionId(options.sessionKey);
    if (sessionId && !getActiveProcess(options.sessionKey)) {
      args.push("--session-id", sessionId);
    }
  }
  if (options.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

export function spawnClaudeProcess(cliPath: string, cliArgs: string[], cwd: string, key: string): ActiveProcess {
  const proc = spawn(cliPath, cliArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm-256color" }
  });

  const lineEmitter = new EventEmitter();
  const rl = createInterface({ input: proc.stdout! });
  rl.on("line", (line: string) => lineEmitter.emit("line", line));
  rl.on("close", () => lineEmitter.emit("close"));

  const active = { proc, lineEmitter };
  activeProcesses.set(key, active);

  proc.on("exit", () => {
    activeProcesses.delete(key);
  });

  return active;
}
