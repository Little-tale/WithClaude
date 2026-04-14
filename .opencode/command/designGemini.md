# designGemini

Use Gemini as the implementation executor for frontend styling and component-structure work in the current approved plan.

Delegate this request to `@designGemini`. Do not implement directly in the current agent.

Keep going. Solve problems. Ask only when truly blocked.

## Expected tool flow

1. Use `get_task_context` to inspect the task.
2. Use `get_approved_plan` to load the approved plan body.
3. Use `run_gemini_design` to execute Gemini CLI in the current project/worktree.
4. Let `run_gemini_design` persist the final implementation summary.

Only continue if the task context is implementation-ready.

Approval is explicit. `approve_task` does not auto-run implementation for you.

## Required behavior

- Hand off to `@designGemini` instead of responding directly in the current primary agent.
- Read the current approved plan and task context from the plugin tools.
- Work only in the current project/worktree.
- Make the necessary frontend styling and component-structure changes through Gemini CLI.
- Summarize the implementation result clearly.
- Use the Gemini CLI-backed execution path rather than manually saving a summary without running Gemini.
- Stop and explain if the task has not been approved yet.
- Verify before claiming success.

## Constraints

- Do not create a new plan.
- Do not perform review as the final step.
- Do not bypass the workflow state model.
