# implClaude

Use Claude as the implementation executor for the current approved plan.

Keep going. Solve problems. Ask only when truly blocked.

## Expected tool flow

1. Use `get_task_context` to inspect the task.
2. Use `get_approved_plan` to load the approved plan body.
3. Use `run_claude_implementation` to execute Claude CLI in the current project/worktree.
4. Let `run_claude_implementation` persist the final implementation summary.

Only continue if the task context is implementation-ready.

Approval is explicit. `approve_task` does not auto-run implementation for you.

## Required behavior

- Read the current approved plan and task context from the plugin tools.
- Work only in the current project/worktree.
- Make the necessary code changes through Claude CLI.
- Summarize the implementation result clearly.
- Use the Claude CLI-backed execution path rather than manually saving a summary without running Claude.
- Stop and explain if the task has not been approved yet.
- Verify before claiming success.

## Constraints

- Do not create a new plan.
- Do not perform review as the final step.
- Do not bypass the workflow state model.
