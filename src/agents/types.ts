import type { ReviewDecision, WorkflowTask } from "../types/task.js";

export type PlannerInput = {
  task: WorkflowTask;
  feedback?: string;
};

export type PlannerResult = {
  planText: string;
};

export interface PlannerAdapter {
  readonly name: string;
  runPlanning(input: PlannerInput): Promise<PlannerResult>;
  dispose?(): Promise<void>;
}

export type ImplementerInput = {
  task: WorkflowTask;
};

export type ImplementerResult = {
  summary: string;
};

export interface ImplementerAdapter {
  readonly name: string;
  runImplementation(input: ImplementerInput): Promise<ImplementerResult>;
}

export type ReviewerInput = {
  task: WorkflowTask;
};

export type ReviewerResult = {
  decision: ReviewDecision;
  summary: string;
};

export interface ReviewerAdapter {
  readonly name: string;
  runReview(input: ReviewerInput): Promise<ReviewerResult>;
}
