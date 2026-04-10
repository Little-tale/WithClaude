# OpenCode Loop 재진단 — 2026-04-10

> **결론 선언**: 2026-04-09 HANDOFF 의 "OpenCode 자체 primary-loop 문제 (repo 밖)" 결론은 **틀렸음**. 문제는 여전히 **with-claude provider** 에 있음.

## 재진단 발단

사용자 질문: "Sisyphus, Hephaestus 등 다른 Agent 는 정상 동작한다면 어떻게 판단되는가?"

→ 같은 OpenCode 바이너리, 같은 primary session loop 위에서 다른 agent 들이 정상 동작한다면, 차이점은 **provider 뿐**. 따라서 문제는 provider 레이어이며 "OpenCode 내부 동작" 으로 치부할 수 없음.

## 실험 설정

3개 명령을 병렬 background 로 실행:

```bash
# A. 다른 primary agent (nemotron provider 로 fallback 됨)
opencode run --log-level DEBUG --print-logs --agent Sisyphus \
  --title "test-sisyphus" "reply only with the word OK" \
  > /tmp/ok-sisyphus.out 2> /tmp/ok-sisyphus.log

# B. 다른 primary agent (동일 fallback)
opencode run --log-level DEBUG --print-logs --agent Hephaestus \
  --title "test-hephaestus" "reply only with the word OK" \
  > /tmp/ok-hephaestus.out 2> /tmp/ok-hephaestus.log

# C. with-claude provider (60초 타임아웃)
timeout 60 opencode run --log-level DEBUG --print-logs \
  --model with-claude/sonnet \
  --title "test-withclaude" "reply only with the word OK" \
  > /tmp/ok-withclaude.out 2> /tmp/ok-withclaude.log
```

세 실행 모두 동일하게 **`Sisyphus (Ultraworker)` primary agent** 위에서 동작 (A/B 는 agent 이름 대소문자 오타로 default fallback, 결과적으로 같은 primary agent 경로).

유일한 실질적 차이: **어떤 provider/model 을 호출했는가**.

## 관측 결과

### 로그 크기

| 실행 | .log 라인 수 | .out 내용 |
|------|------|-----------|
| Sisyphus | 513 | `OK` |
| Hephaestus | 525 | `OK` |
| with-claude | **34,102** | `OK` |

세 실행 모두 텍스트 "OK" 는 정상 반환. with-claude 만 로그가 66배 더 많음 → 루프.

### Step 진행 패턴

**Sisyphus (정상)**
```
step=0  00:02:57  loop           ← provider 호출
step=1  00:03:06  loop + exiting loop  ← 즉시 종료
```

**with-claude (루프)**
```
step=0  00:02:59  loop           ← provider 호출 (5초)
step=1  00:03:06  loop           ← provider 재호출
step=2  00:03:06  loop           ← 0초 간격
step=3  00:03:06  loop
...
step=N  00:03:XX  loop           ← 초당 4-10 step 무한
```

→ **OpenCode 의 루프 exit 조건을 with-claude 응답이 만족시키지 못하고 있음.**

### DB 직접 확인

SQLite 에서 메시지 상태를 직접 조회:

```bash
sqlite3 ~/.local/share/opencode/opencode.db "SELECT id, 
  json_extract(data, '$.role'), 
  json_extract(data, '$.finish'), 
  json_extract(data, '$.tokens') 
  FROM message WHERE session_id='...';"
```

**Sisyphus**
```
msg_...|user||
msg_...|assistant|stop|{"total":36864,"input":36830,"output":1,"reasoning":33,...}
```
→ `finish = "stop"`, tokens 정상

**with-claude** (200+ 행)
```
msg_...|user||
msg_...|assistant||{"input":0,"output":0,"reasoning":0,"cache":{...}}
msg_...|assistant||{"input":0,"output":0,"reasoning":0,"cache":{...}}
msg_...|assistant||{"input":0,"output":0,"reasoning":0,"cache":{...}}
... (반복)
```
→ **`finish` 필드 완전 누락**, tokens 전부 0

### 메시지 part 상세

```bash
sqlite3 ... "SELECT data FROM part WHERE message_id='msg_...';"
```

첫 with-claude assistant 메시지의 parts:
```json
{"type":"step-start"}
{"type":"text","text":"OK","time":{"start":1775779385931,"end":1775779386211}}
{"type":"step-finish","tokens":{"input":0,"output":0,...},"cost":0}
```

→ `step-finish` part 는 생성됨. 단, **`reason` 필드 없음**.

### 첫 메시지 전체 JSON
```json
{
  "parentID": "msg_...",
  "role": "assistant",
  "mode": "Sisyphus (Ultraworker)",
  "agent": "Sisyphus (Ultraworker)",
  "cost": 0,
  "tokens": {"input":0, "output":0, "reasoning":0, "cache":{"write":0,"read":0}},
  "modelID": "sonnet",
  "providerID": "with-claude",
  "time": {"created": 1775779379116, "completed": 1775779386236}
}
```

- `time.completed` **는 설정됨** (7초 후)
- `finish` 필드 **없음**
- `tokens` 전부 0

## OpenCode 바이너리 디스어셈블 분석

바이너리: `~/.local/share/mise/installs/node/22.22.0/lib/node_modules/opencode-ai/bin/.opencode`  
도구: `strings ... | grep -B/-A ...`

### 루프 exit 조건

```js
const hasToolCalls = lastAssistantMsg?.parts.some(
  (part) => part.type === "tool" && !part.metadata?.providerExecuted
) ?? false;

if (lastAssistant2?.finish 
    && !["tool-calls"].includes(lastAssistant2.finish) 
    && !hasToolCalls 
    && lastUser.id < lastAssistant2.id) {
  log11.info("exiting loop", { sessionID });
  break;
}
step++;
```

네 조건 AND:
1. `lastAssistant2.finish` truthy
2. `finish !== "tool-calls"`
3. user-visible tool call 없음
4. `lastUser.id < lastAssistant2.id`

우리 with-claude 는 **조건 #1** 에서 탈락 (`finish` 가 `undefined`).

### `finish` 필드가 설정되는 경로 (session processor)

```js
case "finish-step": {
  const usage2 = Session.getUsage({
    model: ctx.model,
    usage: value9.usage,
    metadata: value9.providerMetadata
  });
  ctx.assistantMessage.finish = value9.finishReason;  // ← HERE
  ctx.assistantMessage.cost += usage2.cost;
  ctx.assistantMessage.tokens = usage2.tokens;
  yield* session.updatePart({
    id: PartID.ascending(),
    reason: value9.finishReason,  // ← step-finish part 의 reason 필드
    snapshot: ...,
    type: "step-finish",
    tokens: usage2.tokens,
    cost: usage2.cost
  });
}
```

→ `value9.finishReason` 이 undefined/null 이면 `assistantMessage.finish` 도 설정 안됨, `step-finish` part 의 `reason` 도 없음. **DB 상태와 정확히 일치**.

### V2→V3 adapter 가 finishReason 을 object 로 감쌈

```js
function convertV2FinishReasonToV3(finishReason) {
  return {
    unified: finishReason === "unknown" ? "other" : finishReason,
    raw: undefined
  };
}

function convertV2StreamToV3(stream4) {
  return stream4.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "finish":
          controller.enqueue({
            ...chunk,
            finishReason: convertV2FinishReasonToV3(chunk.finishReason),
            usage: convertV2UsageToV3(chunk.usage)
          });
          break;
        default:
          controller.enqueue(chunk);
          break;
      }
    }
  }));
}
```

우리 provider 는 `specificationVersion = "v2"` 로 선언 → 이 adapter 가 활성화. `finishReason: "stop"` → `{unified: "stop", raw: undefined}` object 로 변환됨.

### streamText 의 finish 처리

```js
let stepFinishReason = "other";
...
case "finish": {
  stepUsage = chunk.usage;
  stepFinishReason = chunk.finishReason;  // 여기서 object 통째로 저장
  stepRawFinishReason = chunk.rawFinishReason;  // undefined (없음)
  stepProviderMetadata = chunk.providerMetadata;
  ...
}
...
controller.enqueue({
  type: "finish-step",
  finishReason: stepFinishReason,  // object 그대로 전달
  rawFinishReason: stepRawFinishReason,
  usage: stepUsage,
  ...
});
```

### 가설

1. `stepFinishReason = chunk.finishReason` 이 **object `{unified:"stop",raw:undefined}`** 를 담음
2. session processor 가 `ctx.assistantMessage.finish = value9.finishReason` 에서 object 를 대입
3. DB 저장 시 message 스키마 validation (Zod) 이 `finish` 를 string enum 으로 기대 → object 는 reject → 필드 drop

또는 대안 가설:
- `stepFinishReason` 이 그 object 가 아니라 어딘가에서 `undefined` 로 오염됨 (가능성 낮음, 바이너리 코드에서 그럴 경로 못 찾음)

**어느 쪽이든 현상**: `finish` 필드 DB 에 저장 안됨 → 루프 exit 조건 만족 못함 → 무한 루프.

### 이전 경로와 비교

HANDOFF 의 Bug 4 수정 노트 ("`usage2.inputTokens.total` 크래시 막으려고 0 으로 default") 는 사실 이 V2→V3 변환 경로의 **절반**만 처리한 것. 우리는 usage shape 을 맞췄지만 finishReason shape 은 건드리지 않아서, 바이너리 업데이트 후 이 경로가 다시 문제를 일으키는 것으로 추정.

## 다음 단계 옵션

### Option A — 로깅 기반 검증 (권장, 먼저)
provider 에 stream event dump 를 환경변수로 활성화하고 한 번 실행해서 **우리가 실제로 emit 하는 finish event 의 shape** 과, AI SDK / OpenCode 가 **어느 단계에서 finishReason 을 잃는지** 를 파일로 캡처.

구현 위치: `src/provider/with-claude-language-model.ts` 의 `closeStream` 직전에 `WITH_CLAUDE_DEBUG_STREAM=path` 체크하고 enqueue 전 append.

### Option B — `specificationVersion: "v3"` 직접 선언
```ts
readonly specificationVersion = "v3" as const;
```
와 함께 finish event 를 v3 shape 로 직접 emit:
```ts
controller.enqueue({
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 0, ... },
    outputTokens: { total: 0, ... }
  }
});
```
V2→V3 adapter 를 우회해서 OpenCode 네이티브 v3 경로로 감. 리스크: v3 의 다른 스트림 part 들도 shape 이 바뀌어야 할 수 있음.

### Option C — unixfox 참고 구현 비교
`unixfox/opencode-claude-code-plugin` 을 npm 에서 받아서 **finish event emit 하는 부분** 을 우리 코드와 diff. 동일한 작동 환경에서 동작하는 구현이 있다면 정답 shape 을 복사.

### Option D — v2 emit 에 "명시적 v3 친화 hint" 추가
그대로 v2 로 두되:
- `finish` 이벤트에 `providerMetadata: {"with-claude": {}}` 명시 (undefined 회피)
- `response-metadata` 이벤트 emit (id, modelId, timestamp)
- `text-start` 의 `providerMetadata` 등

효과는 불확실하지만 변경 범위 작음.

## 권장 순서

1. **A** (로깅) 먼저 — 10~15분, 정확한 실상 파악
2. 결과 따라 **C** (참고 구현 diff) 또는 **B** (v3 변환)
3. 수정 후 `npm test` + 본 문서의 재현 시나리오 재실행해서 DB 의 `finish` 필드가 `"stop"` 으로 저장되는지 직접 확인

## 재검증용 명령

```bash
# 1. 빌드
npm run build && npm test

# 2. with-claude 실행 (타임아웃 60초)
timeout 60 opencode run --log-level DEBUG --print-logs \
  --model with-claude/sonnet \
  --title "verify" "reply only with the word OK" \
  > /tmp/verify.out 2> /tmp/verify.log

# 3. 세션 ID 최신 것 가져와서 DB 확인
LATEST_SID=$(sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id FROM session ORDER BY time_created DESC LIMIT 1;")

sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id, json_extract(data, '\$.role'), json_extract(data, '\$.finish'), json_extract(data, '\$.tokens') FROM message WHERE session_id='$LATEST_SID';"

# 성공 판정:
# - assistant 메시지의 finish 가 "stop" 으로 나와야 함
# - step 수가 2 이하여야 함 (step=0 실제 호출 → step=1 exit)
# - /tmp/verify.log 라인 수가 1000줄 이하여야 함
```

## 관련 코드 위치

- `src/provider/with-claude-language-model.ts:17` — `specificationVersion = "v2"` 선언
- `src/provider/with-claude-language-model.ts:241-258` — `closeStream` (finish event emit)
- `src/provider/with-claude-language-model.ts:322-323` — `result` msg 에서 closeStream 호출
- `src/provider/with-claude-language-model.ts:328-330` — `closeHandler` 에서 closeStream 호출
- `src/provider/with-claude-language-model.ts:152-158` — `doGenerate` 의 usage defaulting
