# designGemini

Use Gemini as a direct-call design agent for frontend styling and component-structure work in the current workspace.

Delegate this request to `@designGemini`. Do not implement directly in the current agent.

Keep going. Solve problems. Ask only when truly blocked.

## Expected behavior

1. Inspect the relevant files in the current project/worktree.
2. Implement the requested styling and component-structure changes directly.
3. Verify the result.
4. Reply with a concise completion summary.

## Required behavior

- Hand off to `@designGemini` instead of responding directly in the current primary agent.
- Work only in the current project/worktree.
- Make the necessary frontend styling and component-structure changes directly in the workspace.
- Summarize the implementation result clearly when complete.
- Verify before claiming success.

## Constraints

- Do not create a new plan.
- Do not perform review as the final step.
- Do not perform unrelated business-logic work.
