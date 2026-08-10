# kb MCP 서버 설계

qmd SDK를 직접 import해 vault 격리를 구조적으로 보장하는 MCP 서버.

## 배경

kb 플러그인은 현재 각 working repo가 `.mcp.json`에서 `qmd mcp`를 직접 띄우도록 안내한다.
그 방식에는 문서로만 막아둔 함정이 둘 있다.

**글로벌 config 오염.** qmd의 설정은 기본적으로 전역이다 (`~/.config/qmd/index.yml`,
인덱스는 `~/.cache/qmd/`). vault-local `.qmd/`는 그것이 존재할 때만 우선한다. 따라서
`qmd init` 없이 컬렉션을 등록하면 전역 config에 들어가고, 그 vault는 다른 모든 vault의
컬렉션까지 보게 된다. 아무 에러도 나지 않는다.

이 저장소에서 실제로 재현됐다. kb 저장소에는 `.kb.yaml`도 `.qmd/`도 없어서, 여기서 띄운
`qmd mcp`는 인덱스로 `/Users/jito.hello/dev/search-knowledge-based/wiki`를 집어왔다.
README가 경고한 상황이 문서상의 우려가 아니라 실제 동작이다.

**`collections` 파라미터.** `query` 툴의 필터 파라미터는 복수형 배열 `collections`인데,
서버가 initialize 응답에 실어 보내는 `instructions` 문자열은 단수 `collection`으로
스코프하라고 안내한다. MCP는 모르는 파라미터를 조용히 버리므로 단수형을 쓰면 필터가
적용되지 않은 채 에러도 없다. README에 적힌 이 함정의 출처가 그 안내문 자체다.

두 문제 모두 사람이 문서를 읽고 지켜야 막힌다. 이 설계는 그것을 코드로 옮긴다.

## 목표

`qmd mcp`와 같은 툴 4개(`query`, `get`, `multi_get`, `status`)를 노출하되,
`@tobilu/qmd` SDK를 직접 import해 구현한다. CLI 래핑도, MCP 프록시도 쓰지 않는다.

비목표: 툴 축소, 검색 결과 가공, 검색 옵션 튜닝. 전부 이후 레이어의 문제다.

## 접근

`@tobilu/qmd`는 타입 선언까지 배포되는 정식 SDK를 export한다 (`dist/index.d.ts`).
진입점은 `createStore({ dbPath, config })` 하나다.

SDK 타입이 MCP 표면과 이미 맞아떨어진다.

- `ExpandedQuery`가 `{ type: 'lex' | 'vec' | 'hyde', query: string }` — MCP `query` 툴의
  `searches` 항목과 같은 모양이다. 번역 없이 그대로 넘긴다.
- `IndexStatus`가 `{ totalDocuments, needsEmbedding, hasVectorIndex, collections }` —
  실제 `status` 응답의 `structuredContent`와 필드가 일치한다.
- `HybridQueryResult`가 `file`, `displayPath`, `score`, `context`, `docid`, `bestChunk`를
  포함한다. 검색 결과 구성에 필요한 것이 다 들어있다.

`addLineNumbers`와 `DEFAULT_MULTI_GET_MAX_BYTES`도 export되므로 라인 번호 포맷과
크기 기본값까지 원본과 맞출 수 있다.

CLI를 감쌌다면 `searches` 배열을 `$'lex: ...\nvec: ...'` 문법으로 번역하고 텍스트 출력에서
점수와 라인 번호를 복원해야 했다. SDK를 쓰면 그 층이 통째로 사라진다.

## 구조

```text
lib/mcp/
  server.ts    # 진입점. stdio 트랜스포트, 툴 등록, 복구 오케스트레이션
  store.ts     # createStore 래핑 — vault에서 dbPath/config 결정, 수명 관리
  tools.ts     # 툴 4개의 스키마와 핸들러
```

기존 `lib/lint.ts`, `lib/vault.ts`와 같은 자리, 같은 실행 방식(`bun`). 새 런타임을
도입하지 않는다. vault 해석은 `lib/vault.ts`의 `loadVault()`를 그대로 재사용한다.

의존성으로 `@tobilu/qmd`와 `@modelcontextprotocol/sdk`가 추가된다. 현재 `package.json`에는
런타임 의존성이 없으므로 여기서 처음 생긴다.

### 각 모듈의 책임

**`store.ts`** — vault 설정을 qmd store로 바꾼다. `loadVault()`가 준 root, pages,
collection을 `createStore` 인자로 번역하고, 복구 상태를 추적하며, 종료 시 `close()`한다.
바깥에는 "준비된 store를 준다"는 하나의 약속만 노출한다.

**`tools.ts`** — 툴 4개의 입력 스키마와 핸들러. store를 주입받고 MCP 프로토콜은 모른다.
SDK 호출 결과를 MCP `content` / `structuredContent`로 감싸는 것까지가 범위다.

**`server.ts`** — MCP 서버 수명. 트랜스포트를 열고, 툴을 등록하고, 복구를 띄운다.

## 격리

이 설계의 핵심 소득이다.

```ts
createStore({
  dbPath: join(vault.root, ".qmd", "index.sqlite"),
  config: { collections: { [vault.collection]: { path: join(vault.root, vault.pages) } } },
})
```

`pattern`은 `**/*.md`로 명시한다. 생략하면 qmd 기본값에 의존하게 되고, 그 기본값이 바뀌면
vault가 인덱싱하는 파일 집합이 조용히 달라진다.

`dbPath`와 `config`를 인자로 직접 넘기므로 qmd의 전역 config 탐색이 **일어나지 않는다.**
잘못된 인덱스를 볼 경로가 없다. 위에서 재현한 사고 — 이 저장소에서 엉뚱한 컬렉션을
집어오는 일 — 이 구조적으로 불가능해진다.

검증이나 방어 코드로 막는 것이 아니라, 틀린 상태를 표현할 수 없게 만드는 방식이다.
그 결과 초기 논의에서 필요하다고 봤던 "글로벌 config로 떨어졌는지 검증하고 거부하는"
층이 전부 불필요해졌다.

`.kb.yaml`이 없으면 `loadVault()`가 `VaultNotFound`를 던진다. 그때는 서버를 띄우지 않고
`lint.ts`와 같은 방식으로 무엇을 만들어야 하는지 안내하며 죽는다.

## 자동 복구

인덱스가 없거나 비어 있어도 서버가 스스로 검색 가능한 상태를 만든다.

측정한 비용은 다음과 같다 (문서 5개, kb 저장소 자체를 대상으로).

| 단계 | 비용 | 생략하면 |
|---|---|---|
| `createStore` | 26ms | — |
| `update()` | 18ms | 검색 결과 0건 |
| `embed()` | 3.3s (모델 로딩 포함) | `vec`/`hyde` 무력화, `lex`만 동작 |

`createStore`는 인덱스가 없어도 에러를 내지 않고 빈 DB를 만든다. 실측으로 확인했다.

복구 절차는 `update()` 후 `needsEmbedding > 0`이면 `embed()`다.

**시작을 블로킹하지 않는다.** 임베딩이 초 단위이므로 (문서가 많으면 그 배수로 늘어난다)
MCP initialize 핸드셰이크를 붙잡으면 클라이언트가 타임아웃날 수 있다. 서버는 즉시 뜨고
복구는 백그라운드로 돈다. 그 사이 도착한 툴 호출은 복구 완료를 await한다.

복구가 실패해도 서버는 죽지 않는다. 실패는 기록되고 `status`에 드러난다. 부분적으로
동작하는 서버가 죽은 서버보다 낫다 — `embed`만 실패한 상태에서도 `lex` 검색은 된다.

## 툴 매핑

| MCP 툴 | SDK 호출 |
|---|---|
| `query` | `search({ queries: searches, intent, limit, minScore, candidateLimit, rerank, collections })` |
| `get` | `get()` + `getDocumentBody({ fromLine, maxLines })` + `addLineNumbers()` |
| `multi_get` | `multiGet(pattern, { maxBytes })` |
| `status` | `getStatus()` |

입력 스키마는 `qmd mcp`의 것을 그대로 따른다. 검색 옵션에는 손대지 않는다 — `rerank`를
비롯한 기본값은 qmd가 정한 대로 둔다.

`collections` 파라미터는 복수형 배열로 유지한다. 스키마가 곧 계약이므로 여기서 이름을
바꾸면 호출자가 깨진다.

## instructions

`qmd mcp`는 문서 수와 임베딩 상태를 담은 동적 `instructions` 문자열을 initialize 응답에
싣는다. SDK는 이것을 만들어주지 않으므로 `getStatus()` 결과로 조립한다.

원문의 단수 `collection` 오기는 복수 `collections`로 고쳐 쓴다. 배경 절에서 설명한
그 함정의 출처이고, 우리가 이 문자열을 소유하는 이상 틀린 채로 옮길 이유가 없다.

## 에러 처리

- **vault 없음** — 서버를 띄우지 않고 `.kb.yaml` 예시를 보이며 종료. `lint.ts`의 기존 방식.
- **복구 실패** — 서버는 유지. 실패를 기록하고 `status`로 노출.
- **문서 없음** — `get`이 `DocumentNotFound`를 반환하면 MCP 에러가 아니라 결과로 전달.
  SDK가 유사 파일을 제안하므로 그것을 함께 싣는다.

## 테스트

vault 픽스처(임시 디렉터리 + `.kb.yaml` + 마크다운 몇 개)를 만들고 그 위에서 검증한다.
임베딩이 필요한 경로는 느리므로 분리한다.

- `store.ts` — `.kb.yaml`의 pages/collection이 `createStore` 인자로 옳게 번역되는가.
  전역 config 경로를 참조하지 않는가.
- 복구 — 빈 인덱스에서 시작해 `update()` 후 `lex` 검색이 결과를 내는가.
  복구 중 도착한 호출이 완료를 기다리는가. `embed()` 실패가 서버를 죽이지 않는가.
- `tools.ts` — 각 툴이 `qmd mcp`와 같은 모양의 응답을 내는가. 특히 `status`의
  `structuredContent`가 `IndexStatus`와 일치하는가.
- 격리 — 전역 config(`~/.config/qmd/index.yml`)에 다른 컬렉션이 등록되어 있는 상태에서
  서버를 띄웠을 때, 그 컬렉션의 문서가 검색 결과에 섞이지 않는가. 픽스처 두 개를 나란히
  두는 것만으로는 부족하다. 인라인 config를 주는 이상 그건 자동으로 참이기 때문이다.
  실제 위험은 전역 상태가 새어드는 경우이므로 그것을 재현해서 확인한다.

마지막 항목이 이 설계가 존재하는 이유이므로 반드시 자동화한다.

## 미결

**임베딩 비용의 확장.** 3.3초는 문서 5개 기준이다. 실제 vault는 42개였다. 선형이라면
30초 안쪽이지만 재보지 않았다. 큰 vault에서 첫 실행이 불편하면 복구를 증분으로 쪼개거나
`embed`를 명시적 트리거로 돌리는 선택지가 있다.

**모델 로딩 지연.** SDK 주석은 LLM이 lazy-load되고 유휴 시 unload된다고 한다. unload 후
다음 쿼리가 얼마나 느려지는지는 측정하지 않았다.

둘 다 구현 후 실측으로 정한다. 설계를 바꾸지는 않는다.

## 구현하며 알게 된 것

설계 당시 몰랐던 것들. 코드가 왜 이런 모양인지는 여기에 있다.

**qmd는 `process.stdout.write`를 가로챈다.** llama를 초기화할 때마다 stderr로 쓰는 함수로
바꾼다 (`dist/llm.js`의 `withNativeStdoutRedirectedToStderr`). 네이티브 라이브러리 잡음이
JSON 출력을 더럽히지 않게 하려는 조치다. 그런데 우리는 그 stdout으로 JSON-RPC를 말하므로,
그 창에 걸린 응답이 통째로 stderr로 새어나가고 클라이언트는 영원히 기다린다.

이것이 이 프로젝트에서 가장 값비싼 버그였다. 단위 테스트 22개가 전부 통과하는 동안 실제
서버는 침묵했다. E2E 테스트가 아니었으면 배포된 뒤에 발견됐을 것이다.

해결까지 세 단계를 거쳤다.

1. 임베딩을 자식 프로세스로 분리 — **불충분**. `query`의 리랭킹도 서버 프로세스에서 모델을
   로드하고, 가로채기는 임베딩만이 아니라 **모든 모델 로드**에서 일어난다.
2. `defineProperty`로 `process.stdout.write` 고정 — **폐기**. 가로채기는 막히지만 qmd의
   대입이 `TypeError`로 죽어 검색 결과가 0건이 된다. 검색을 희생한 stdout은 수정이 아니다.
3. `StdioServerTransport`에 fd 1의 독립 핸들을 넘김 — **채택**. 전송은 생성 시점의 스트림을
   붙잡으므로, qmd가 `process.stdout`을 어떻게 바꾸든 우리 응답은 그 경로를 지나지 않는다.
   싸우는 대신 비켜간 것이다.

`lib/mcp/embed.ts`는 그래서 남았지만 이유가 바뀌었다. 이제 정확성이 아니라 응답성 때문이다 —
임베딩이 수 초간 CPU/GPU를 점유하면 그동안 툴 호출이 뒤에 줄 선다.

**qmd는 `dbPath`의 부모 디렉터리를 만들어주지 않는다** (`dist/db.js`가 `new _Database(path)`를
그대로 호출). 새 vault마다 `SQLITE_CANTOPEN`으로 죽는다. `openStore`가 `mkdirSync`를 책임진다.

**macOS에서 `GGML_METAL_NO_RESIDENCY=1`이 필요하다.** libggml-metal이 정적 소멸자에서
어서션하며 종료 시 abort한다 (업스트림 `ggml-org/llama.cpp#22593`). 테스트는 전부 통과하는데
exit code만 134가 되어 CI가 실패로 읽는다. libc `getenv`로 모듈 로드 시점에 읽히므로 프로세스
시작 **전에** 설정해야 한다 — `package.json`의 test 스크립트와 `lib/mcp/start.sh`가 그 일을 한다.

**테스트가 진짜인지 따로 확인했다.** 격리 테스트는 일부러 `configPath`로 전역 config를 넘겨
누출을 재현해 봤고(낯선 vault 문서가 그대로 검색됐다), `transport.test.ts`는 수정을 되돌리면
실패하는 것을 확인했다. 반대로 E2E 테스트 하나는 **삭제했다** — 수정 없이도 통과해서 아무것도
지키지 않았기 때문이다. 자식 임베더가 모델 캐시를 미리 데워 가로채기 창이 열리지 않았다.
통과만 하고 아무것도 증명하지 않는 테스트는 없느니만 못하다.
