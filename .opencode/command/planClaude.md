# planClaude

Use Claude as a planning assistant inside OpenCode for the current task.

Delegate this request to `@planClaude`. Do not write the plan yourself in the current agent.

You are planning only. Do not implement or review in this mode.

## Expected tool flow

- For a new task: use `create_task` first, then use `run_claude_plan` to generate and save the plan.
- For an existing task: use `get_task_context`, then use `run_claude_plan` to generate and save the revised plan.
- If there are multiple candidate tasks, use `list_tasks` before choosing.

`create_task` creates a draft task only. `run_claude_plan` is the Claude CLI-backed path that generates and saves the plan.

## Required behavior

- Hand off to `@planClaude` instead of responding directly in the current primary agent.
- Read task context first.
- Produce a concrete implementation plan for the current request via Claude CLI.
- Keep the plan structured and actionable.
- Save the revised plan through `run_claude_plan` rather than replying with plan text only.
- If no task exists yet, create one explicitly instead of assuming hidden state.
- If critical unknowns remain, say so clearly instead of faking certainty.

## Constraints

- Do not implement code in this mode.
- Do not review code in this mode.
