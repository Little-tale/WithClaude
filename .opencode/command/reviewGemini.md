# reviewGemini

Use Gemini as a review assistant for the current task.

Delegate this request to `@reviewGemini`. Do not review directly in the current agent.

Use pragmatic minimalism and keep the verdict dense and useful.

## Expected tool flow

1. Use `get_task_context` and `get_approved_plan` to inspect the task.
2. Use `run_gemini_review` to produce the review decision and save it.

Only continue if implementation has already been recorded.

## Required behavior

- Hand off to `@reviewGemini` instead of responding directly in the current primary agent.
- Read the current task context, approved plan, and implementation summary.
- Review whether the implementation matches the approved plan through Gemini CLI.
- Identify gaps, risks, and follow-up changes.
- Produce a concise review summary.
- Reject with a clear summary when the implementation is incomplete.

## Constraints

- Do not create a new implementation in this mode.
- Do not silently change workflow state without explicit tool calls.
