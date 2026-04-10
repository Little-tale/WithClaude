import assert from "node:assert/strict";
import test from "node:test";

import { getClaudeUserMessage } from "../provider/message-builder.js";

test("getClaudeUserMessage preserves user text content", () => {
  const payload = JSON.parse(getClaudeUserMessage([
    { role: "user", content: "reply only with OK" }
  ] as never));

  assert.equal(payload.message.content[0].text, "reply only with OK");
});

test("getClaudeUserMessage includes non-user context before user content", () => {
  const payload = JSON.parse(getClaudeUserMessage([
    { role: "system", content: "Create a 2-word title." },
    { role: "user", content: "reply only with OK" }
  ] as never));

  assert.match(payload.message.content[0].text, /\[system\] Create a 2-word title\./);
  assert.equal(payload.message.content[1].text, "reply only with OK");
});

test("getClaudeUserMessage falls back to non-user text when prompt has no user message", () => {
  const payload = JSON.parse(getClaudeUserMessage([
    { role: "system", content: "Create a 2-word title." },
    { role: "assistant", content: "Previous response." }
  ] as never));

  assert.match(payload.message.content[0].text, /\[system\] Create a 2-word title\./);
  assert.match(payload.message.content[0].text, /\[assistant\] Previous response\./);
  assert.notEqual(payload.message.content[0].text, "");
});
