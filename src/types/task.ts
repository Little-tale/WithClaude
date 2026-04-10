export type TaskStatus =
  | "draft_plan"
  | "awaiting_approval"
  | "approved"
  | "implementing"
  | "reviewing"
  | "done"
  | "rejected"
  | "cancelled";

export type TaskHistoryEntry = {
  at: string;
  type:
    | "created"
    | "plan_revised"
    | "approved"
    | "implementation_saved"
    | "review_recorded"
    | "artifacts_updated"
    | "status_changed";
  actorId: string;
  note?: string;
};

export type TaskArtifacts = {
  requestMarkdownPath: string | null;
  planMarkdownPath: string | null;
  implementationMarkdownPath: string | null;
  reviewMarkdownPath: string | null;
};

export type RequestedStage = "request" | "plan" | "implement" | "review";

export type RoutingMode = "sequential" | "directed";

export type TaskSource = "cli" | "http" | "mcp" | "plugin";

export type WorkflowTask = {
  taskId: string;
  title: string;
  request: string;
  planText: string;
  requestedStage: RequestedStage;
  routingMode: RoutingMode;
  source: TaskSource;
  workspaceRoot: string | null;
  status: TaskStatus;
  planRevision: number;
  requesterId: string;
  approvedBy: string | null;
  approvedAt: string | null;
  implementationSummary: string | null;
  reviewSummary: string | null;
  artifacts: TaskArtifacts;
  createdAt: string;
  updatedAt: string;
  history: TaskHistoryEntry[];
};

export type CreateTaskInput = {
  title: string;
  request: string;
  requesterId: string;
  planText?: string;
  requestedStage?: RequestedStage;
  routingMode?: RoutingMode;
  source?: TaskSource;
  workspaceRoot?: string | null;
};

export type ReviewDecision = "approved" | "rejected";
