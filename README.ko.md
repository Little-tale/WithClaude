# opencode-with-claude

[English](./README.md) | [한국어](./README.ko.md)

OpenCode용 Claude CLI provider 및 workflow surface입니다.

이 패키지는 두 가지를 제공합니다.

- 로컬 **Claude CLI**를 통해 실행되는 `with-claude/*` provider
- `@planClaude`, `@implClaude`, `@reviewClaude`용 OpenCode 서브에이전트 및 커맨드 프롬프트 번들

## 빠른 시작

### 일반 사용자용

```bash
npx @little_tale/opencode-with-claude install
```

## npm 자동 배포

이 저장소에는 `main` 브랜치에서 `CI` 워크플로가 성공한 뒤 패키지를 자동으로 배포하는 GitHub Actions 워크플로가 포함되어 있습니다.

주요 릴리스 동작은 다음과 같습니다.

- `package.json` 버전이 npm에 아직 없을 때만 배포합니다.
- 이미 같은 버전이 존재하면 워크플로는 정상 종료되며 배포를 건너뜁니다.
- 배포에는 장기 보관 npm 토큰 대신 npm trusted publishing(`id-token: write`)을 사용합니다.

다만 npm 웹사이트에서 한 번만 설정해두어야 하는 작업이 있습니다.

1. `@little_tale/opencode-with-claude`를 한 번 수동으로 배포하거나, npm에서 패키지/trusted publisher 항목을 생성합니다.
2. 이 GitHub 저장소를 해당 패키지의 trusted publisher로 추가합니다.
3. 패키지의 `repository.url`이 `https://github.com/Little-tale/WithClaude`를 가리키도록 유지합니다.

이후 새 버전을 릴리스하는 과정은 다음과 같습니다.

1. PR에서 `package.json` 버전을 올립니다.
2. PR을 `main`에 머지합니다.
3. GitHub Actions가 새 버전을 자동으로 배포하도록 둡니다.

### LLM 에이전트용

에이전트에게 이 저장소의 `./AGENT_INSTALL.md`를 읽고 그대로 따르라고 지시하면 됩니다.

에이전트 주도 설치의 기준 문서는 로컬 마크다운 파일이므로, 외부 설치 링크에 의존하지 않습니다.

그 파일 안의 설치 명령은 다음과 같습니다.

```bash
npx @little_tale/opencode-with-claude install
```

## 설치기가 하는 일

설치기는 이 패키지가 동작하는 데 필요한 최소 파일들을 전역 OpenCode 설정 아래에 구성합니다.

기본적으로 `XDG_CONFIG_HOME`이 설정되어 있으면 `XDG_CONFIG_HOME/opencode`를 사용하고, 그렇지 않으면 `~/.config/opencode`를 사용합니다.

설치기는 다음 작업을 수행합니다.

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`를 사용자 override 파일로 생성합니다.
- `~/.config/opencode/package.json`을 생성하고, 이 패키지를 관리되는 local-plugin dependency로 등록합니다.
- 시작 시 plugin hook surface가 로드되도록 `~/.config/opencode/plugins/with-claude-plugin.mjs`를 생성합니다.
- 번들된 재사용 커맨드 프롬프트를 `~/.config/opencode/.opencode/command/`로 복사합니다.
- `~/.config/opencode/opencode.json`을 생성하거나 기존 파일과 병합합니다.

이미 `~/.config/opencode/opencode.json`이 존재하는 경우에도, 기존 최상위 필드는 유지하면서 `with-claude` provider와 Claude 서브에이전트만 전역 설정에 병합합니다.

번들된 Claude 서브에이전트 프롬프트와 기본 role 설정은 이제 설치된 npm 패키지에서 런타임에 직접 로드되므로, 사용자 설정에 다시 복사하지 않아도 새 패키지 릴리스로 기본값을 갱신할 수 있습니다.

OpenCode는 생성된 local plugin shim을 통해 이 패키지의 plugin hook surface도 로드합니다. 세션 시작 시 이 hook은 다음을 수행합니다.

- 필요하다면 이전 설치를 관리형 plugin workspace로 부트스트랩합니다.
- 설치된 패키지에서 번들 프롬프트/커맨드를 동기화합니다.
- 관리되는 dependency가 pin되어 있지 않으면 npm에서 더 새로운 `latest` 릴리스를 확인합니다.
- 새 릴리스가 있으면 `~/.config/opencode`에서 package-manager 업데이트를 자동으로 실행합니다.

시작 도중 새 패키지가 설치되면 OpenCode가 사용자에게 알려줍니다. 방금 설치된 런타임을 현재 세션에 즉시 반영하려면 재시작이 필요할 수 있습니다.

## 사전 요구 사항

- Node.js 22+
- OpenCode가 설치되어 있고 현재 환경에서 사용할 수 있어야 함
- Claude CLI가 설치되어 있고 `claude` 명령으로 실행 가능해야 함

Claude CLI가 다른 경로에 설치되어 있다면, 생성된 설정을 그에 맞게 수정하세요.

> 경고: 이 패키지는 로컬 Claude CLI에 의존합니다. Anthropic이 Claude CLI 정책을 변경하여 사용자가 CLI 사용으로 인해 차단, 정지, 속도 제한 또는 기타 제약을 받게 되더라도, 이 저장소는 그 결과에 대해 책임지지 않습니다.

## 설치 후 제공되는 것

### Provider 모델

이 패키지는 다음 provider-backed 모델을 노출합니다.

- `with-claude/haiku`
- `with-claude/sonnet`
- `with-claude/opus`
- `with-gemini/auto`
- `with-gemini/pro`
- `with-gemini/flash`
- `with-gemini/flash-lite`
- `with-gemini-yolo/auto`
- `with-gemini-yolo/pro`
- `with-gemini-yolo/flash`
- `with-gemini-yolo/flash-lite`

위 Gemini 모델들은 로컬 provider를 통해 그대로 노출되는 Gemini CLI alias입니다.
`with-gemini-yolo/*` 변형은 write-enabled Gemini 실행 경로를 위한 YOLO 승인용 Gemini route alias입니다.

### Workflow 서브에이전트

이 패키지는 다음 OpenCode 서브에이전트를 설치합니다.

- `@planClaude`
- `@implClaude`
- `@designGemini`
- `@reviewClaude`
- `@reviewGemini`

OpenCode UI / TUI에서 mention 스타일 호출로 사용할 수 있습니다.

![Example OpenCode mention-style Claude subagents](docs/assets/claude-subagents-example.svg)

```text
@planClaude
@implClaude
@reviewClaude
```

이들은 **primary agent가 아니라 subagent**입니다. 즉:

- 가능: OpenCode에서 mention 스타일로 subagent 사용
- 불가: `opencode run --agent planClaude ...` 형태로 primary agent를 직접 대체

## 저장되는 파일

플랜 산출물은 workflow tool 경로를 통해 자동으로 저장됩니다.

현재 동작은 다음과 같습니다.

- `<workspaceRoot>/.sisyphus/plans`가 존재하면:
  - `.sisyphus/plans/plan-v<revision>.md`에 저장
- 그렇지 않으면:
  - `plans/plan-v<revision>.md`에 저장

그 외 workflow 산출물은 계속 `.omd/plan/<taskId>/...`를 사용합니다.

## 설정 파일

### `XDG_CONFIG_HOME/opencode/opencode.json` 또는 `~/.config/opencode/opencode.json`

이 파일은 전역 OpenCode 설정입니다.

여기에는 다음이 연결됩니다.

- `with-claude` provider
- `with-gemini` provider
- `with-gemini-yolo` provider
- 번들된 workflow 서브에이전트

### `XDG_CONFIG_HOME/opencode/.opencode/opencode-with-claude.jsonc` 또는 `~/.config/opencode/.opencode/opencode-with-claude.jsonc`

이 파일은 사용자가 수정할 수 있는 workflow role 설정 파일입니다.

다음 항목을 변경할 때 사용합니다.

- 모든 workflow role에 대한 기본 Claude 모델
- 특정 role만 다른 모델을 사용하도록 하는 per-role override
- Claude CLI 인자
- Gemini workflow role에 대한 기본 Gemini CLI alias
- Gemini CLI command / timeout / role override
- timeout 및 관련 런타임 옵션

플러그인은 먼저 번들된 패키지 기본값을 로드한 뒤, 이 전역 파일을 override로 적용합니다. 워크스페이스에 `.opencode/opencode-with-claude.jsonc`가 있으면, 해당 프로젝트 로컬 파일이 그 워크스페이스에서만 전역 값을 다시 override합니다. 워크스페이스 override를 일부만 지정하면, 명시적으로 바꾸지 않은 나머지 값은 번들/global 설정을 그대로 유지합니다.

모델을 변경하는 가장 간단한 방법은 값 하나만 바꾸는 것입니다.

```jsonc
{
  "claudeCli": {
    "defaultModel": "opus",
  },
}
```

이렇게 하면 `@planClaude`, `@implClaude`, `@reviewClaude` 모두 같은 Claude 모델을 사용합니다.

특정 role만 다른 모델을 써야 한다면, 공통 기본값은 유지하고 해당 role만 override하면 됩니다.

```jsonc
{
  "claudeCli": {
    "defaultModel": "sonnet",
    "roles": {
      "planClaude": {
        "model": "opus",
      },
    },
  },
}
```

이 예시에서는 planning은 `opus`, implementation과 review는 계속 `sonnet`을 사용합니다.

Gemini 서브에이전트는 별도의 `geminiCli` 섹션을 사용합니다.

가장 단순한 Gemini 설정은 공통 Gemini alias 하나를 고르는 것입니다.

```jsonc
{
  "geminiCli": {
    "auto": "flash",
  },
}
```

이 설정은 Gemini workflow role들이 공유하는 Gemini CLI alias 값을 바꿉니다.

다만 번들된 workflow agent의 기본 provider route는 서로 다릅니다.

- `@designGemini` 기본값: `with-gemini-yolo/auto`
- `@reviewGemini` 기본값: `with-gemini/auto`

이 분리는 `@designGemini`는 기본적으로 write-enabled이고, `@reviewGemini`는 기본적으로 read-only이기 때문에 존재합니다.

이 동작을 명시적으로 제어하고 싶다면 agent 설정에서 `geminiExecutionPolicy`를 사용하면 됩니다.

```jsonc
{
  "agent": {
    "designGemini": {
      "geminiExecutionPolicy": "write-enabled",
    },
    "reviewGemini": {
      "geminiExecutionPolicy": "read-only",
    },
  },
}
```

`geminiExecutionPolicy` 값은 다음과 같습니다.

- `"write-enabled"` - Gemini 실행을 YOLO 승인 alias(`with-gemini-yolo/*`)로 라우팅
- `"read-only"` - Gemini 실행을 일반 non-YOLO alias(`with-gemini/*`)에 유지

더 세밀한 제어가 필요하다면, 공통 Gemini alias를 유지한 채 특정 role만 override할 수 있습니다.

```jsonc
{
  "geminiCli": {
    "auto": "auto",
    "roles": {
      "reviewGemini": {
        "model": "pro",
      },
    },
  },
}
```

이 설정은 고급 override입니다. 기본 경로는 공통 Gemini alias 하나를 사용하는 것입니다.

### 예시: `oh-my-opencode.json`

oh-my-openagent / oh-my-opencode 스타일의 agent override도 함께 사용한다면, 대상 에이전트가 provider-backed 모델을 명시적으로 가리키도록 설정하면 됩니다.

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "with-claude/opus",
    },
    "atlas": {
      "model": "with-claude/sonnet",
    },
  },
}
```

Gemini 기반 override를 쓰고 싶다면 다음처럼 직접 지정할 수 있습니다.

```jsonc
{
  "categories": {
    "visual-engineering": {
      "model": "with-gemini-yolo/pro",
    },
    "quick": {
      "model": "with-gemini/flash",
    },
  },
}
```

이 설정은 관련 provider가 이미 설치되어 있고 OpenCode provider 설정에 등록되어 있을 때만 동작합니다.

## 패키지 surface

이 패키지는 두 가지 런타임 surface를 노출합니다.

- package root: provider factory (`createWithClaude`)
- `./plugin`: OpenCode workflow tools/state surface

## 개발

```bash
npm install
npm run build
npm test
```

유용한 스크립트:

- `npm run dev`
- `npm run dev:mcp`
- `npm run build`
- `npm test`

## 저장소 문서

- `README.md` - 사람을 위한 개요와 패키지 동작 설명
- `AGENT_INSTALL.md` - 에이전트가 읽을 수 있는 설치 지침
- `CONTRIBUTION.md` - 변경/PR 작업을 위한 기여 워크플로
- `LICENSE` - 프로젝트 라이선스 조건

## 패키지 구성물

배포되는 tarball에는 의도적으로 런타임/패키지 자산만 포함됩니다.

- `dist/`
- `.opencode/agents/`
- `.opencode/command/`
- `.opencode/opencode-with-claude.jsonc`
- `AGENT_INSTALL.md`
- `README.md`
- `LICENSE`
- `.env.example`

`src/`, `Plan/`, `data-*`, 로컬 프로젝트 설정 같은 프로젝트 로컬 개발 파일은 설치 surface에 포함되지 않습니다.

## 참고 사항

- 이 패키지는 **Claude API가 아니라 Claude CLI**를 사용합니다.
- provider runtime이 장기적으로 핵심 실행 경로입니다.
- 번들된 커맨드는 현재 primary agent가 자유 입력을 하는 대신 Claude 서브에이전트로 위임하도록 설계되어 있습니다.

## 제거

전역 OpenCode 설정에서 설치된 파일을 제거하세요.

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`
- `~/.config/opencode/package.json` (또는 `@little_tale/opencode-with-claude` dependency만 제거)
- `~/.config/opencode/plugins/with-claude-plugin.mjs`
- `~/.config/opencode/.opencode/command/implClaude.md`
- `~/.config/opencode/.opencode/command/planClaude.md`
- `~/.config/opencode/.opencode/command/reviewClaude.md`

그 다음 `~/.config/opencode/opencode.json`에서 `with-claude` provider와 Claude 서브에이전트 항목을 수동으로 제거하거나 수정하세요.
