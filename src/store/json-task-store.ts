import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RequestedStage, RoutingMode, TaskSource, WorkflowTask } from "../types/task.js";

type PersistedState = {
  tasks: WorkflowTask[];
};

const EMPTY_STATE: PersistedState = { tasks: [] };

export class JsonTaskStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<WorkflowTask[]> {
    const state = await this.readState();
    return state.tasks;
  }

  async get(taskId: string): Promise<WorkflowTask | null> {
    const state = await this.readState();
    return state.tasks.find((task) => task.taskId === taskId) ?? null;
  }

  async save(task: WorkflowTask): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const state = await this.readState();
      const existingIndex = state.tasks.findIndex((item) => item.taskId === task.taskId);

      if (existingIndex >= 0) {
        state.tasks[existingIndex] = task;
      } else {
        state.tasks.push(task);
      }

      await this.writeState(state);
    });

    await this.writeChain;
  }

  private async readState(): Promise<PersistedState> {
    try {
      const content = await readFile(this.filePath, "utf8");
      try {
        return this.normalizeState(JSON.parse(content) as PersistedState);
      } catch {
        const recovered = this.recoverState(content);
        if (!recovered) {
          throw new Error(`Failed to parse task store: ${this.filePath}`);
        }

        const normalized = this.normalizeState(recovered);
        await this.writeState(normalized);
        return normalized;
      }
    } catch (error) {
      const known = error as NodeJS.ErrnoException;
      if (known.code === "ENOENT") {
        return EMPTY_STATE;
      }

      throw error;
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private recoverState(content: string): PersistedState | null {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (character === "\\") {
          escaped = true;
          continue;
        }

        if (character === '"') {
          inString = false;
        }

        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === "{" || character === "[") {
        depth += 1;
        continue;
      }

      if (character === "}" || character === "]") {
        depth -= 1;

        if (depth === 0) {
          const candidate = content.slice(0, index + 1);
          try {
            return JSON.parse(candidate) as PersistedState;
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  private normalizeState(state: PersistedState): PersistedState {
    return {
      tasks: state.tasks.map((task) => this.normalizeTask(task))
    };
  }

  private normalizeTask(task: WorkflowTask): WorkflowTask {
    const requestedStage = (task.requestedStage ?? "request") as RequestedStage;
    const routingMode = (task.routingMode ?? "sequential") as RoutingMode;
    const source = (task.source ?? "http") as TaskSource;

    return {
      ...task,
      requestedStage,
      routingMode,
      source,
      workspaceRoot: task.workspaceRoot ?? null,
      artifacts: {
        requestMarkdownPath: task.artifacts?.requestMarkdownPath ?? null,
        planMarkdownPath: task.artifacts?.planMarkdownPath ?? null,
        implementationMarkdownPath: task.artifacts?.implementationMarkdownPath ?? null,
        reviewMarkdownPath: task.artifacts?.reviewMarkdownPath ?? null
      }
    };
  }
}
