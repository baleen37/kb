# kb MCP 서버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `qmd mcp`와 같은 툴 4개(`query`, `get`, `multi_get`, `status`)를 `@tobilu/qmd` SDK를 직접 import해 노출하는 MCP 서버를 만든다. vault 격리는 검증이 아니라 구조로 보장한다.

**Architecture:** `lib/mcp/`에 세 모듈. `store.ts`가 `.kb.yaml`을 qmd store로 번역하며 격리와 자동 복구를 책임지고, `tools.ts`가 SDK 호출을 MCP 응답으로 감싸고, `server.ts`가 stdio 트랜스포트와 수명을 다룬다. CLI 래핑도 프로세스 프록시도 없다.

**Tech Stack:** TypeScript, bun (실행 + 테스트 러너), `@tobilu/qmd` 2.5.3 SDK, `@modelcontextprotocol/sdk` 1.29.0, zod 4.

## Global Constraints

- **격리 불변식:** `createStore`에는 항상 `dbPath`와 인라인 `config`를 함께 넘긴다. `configPath`는 절대 쓰지 않는다. 전역 config(`~/.config/qmd/index.yml`)를 읽을 경로를 만들지 않는 것이 이 프로젝트의 존재 이유다.
- **`pattern`은 항상 `**/*.md`로 명시.** 생략해 qmd 기본값에 의존하지 않는다.
- **검색 옵션은 qmd 기본값 그대로.** `rerank` 등에 손대지 않는다. 호출자가 안 주면 SDK에 안 넘긴다.
- **`collections`는 복수형 배열로 유지.** 스키마가 계약이므로 이름을 바꾸지 않는다.
- **`loadVault()`가 돌려주는 `pages`/`sources`는 이미 절대경로다** (`join(root, cfg.pages)`가 내부에서 끝남). 다시 `join(root, ...)` 하지 말 것.
- 의존성 버전은 qmd가 쓰는 것과 맞춘다: `@modelcontextprotocol/sdk` 1.29.0, `zod` 4.2.1.
- 파일은 `bun`으로 실행한다. 새 런타임이나 빌드 단계를 도입하지 않는다.

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/mcp/store.ts` | vault 설정 → qmd store 번역. 격리, 자동 복구, 수명 |
| `lib/mcp/tools.ts` | 툴 4개의 스키마와 핸들러. MCP 프로토콜은 모름 |
| `lib/mcp/server.ts` | 진입점. stdio 트랜스포트, 툴 등록, instructions |
| `lib/mcp/store.test.ts` | 격리와 복구 검증 |
| `lib/mcp/tools.test.ts` | 툴 응답 모양 검증 |
| `lib/mcp/fixture.ts` | 테스트용 임시 vault 생성 헬퍼 |

---

### Task 1: 의존성 추가와 vault 픽스처

지금 `@modelcontextprotocol/sdk`와 `zod`는 qmd의 중첩 `node_modules`에만 있다. 그대로 두면 qmd가 의존성을 정리하는 순간 깨지므로 직접 의존성으로 선언한다. 이후 모든 태스크의 테스트가 vault 픽스처를 쓰므로 함께 만든다.

**Files:**
- Modify: `package.json`
- Create: `lib/mcp/fixture.ts`
- Test: `lib/mcp/fixture.test.ts`

**Interfaces:**
- Consumes: `lib/vault.ts`의 `loadVault(from?: string): VaultConfig`
- Produces: `makeVault(opts?: { pages?: string; collection?: string; docs?: Record<string, string> }): { root: string; cleanup: () => void }`

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/jito.hello/dev/kb
bun add @tobilu/qmd@2.5.3 @modelcontextprotocol/sdk@1.29.0 zod@4.2.1
```

`package.json`에 `dependencies`가 새로 생긴다. 지금까지 `devDependencies`만 있었다.

- [ ] **Step 2: 설치 확인**

Run: `bun -e "import('@tobilu/qmd').then(m => console.log(typeof m.createStore))"`
Expected: `function`

- [ ] **Step 3: 픽스처 테스트를 먼저 쓴다**

Create `lib/mcp/fixture.test.ts`:

```ts
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";
import { loadVault } from "../vault.ts";

test("makeVault creates a vault loadVault can read", () => {
  const v = makeVault({ docs: { "a.md": "# A\n\nalpha content" } });
  try {
    expect(existsSync(join(v.root, ".kb.yaml"))).toBe(true);
    expect(readFileSync(join(v.root, "wiki", "a.md"), "utf8")).toContain("alpha");

    const cfg = loadVault(v.root);
    expect(cfg.root).toBe(v.root);
    expect(cfg.collection).toBe("wiki");
    // loadVault already absolutizes pages — it must not be joined again
    expect(cfg.pages).toBe(join(v.root, "wiki"));
  } finally {
    v.cleanup();
  }
});

test("makeVault honors custom pages and collection", () => {
  const v = makeVault({ pages: "notes", collection: "kb-notes", docs: { "b.md": "# B" } });
  try {
    const cfg = loadVault(v.root);
    expect(cfg.collection).toBe("kb-notes");
    expect(cfg.pages).toBe(join(v.root, "notes"));
  } finally {
    v.cleanup();
  }
});

test("cleanup removes the vault", () => {
  const v = makeVault();
  const root = v.root;
  v.cleanup();
  expect(existsSync(root)).toBe(false);
});
```

- [ ] **Step 4: 실패 확인**

Run: `bun test lib/mcp/fixture.test.ts`
Expected: FAIL — `Cannot find module './fixture.ts'`

- [ ] **Step 5: 픽스처 구현**

Create `lib/mcp/fixture.ts`:

```ts
/**
 * Throwaway vaults for tests. Each one is a real directory with .kb.yaml,
 * so tests exercise the same loadVault path production uses.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Fixture = { root: string; cleanup: () => void };

export function makeVault(
  opts: { pages?: string; collection?: string; docs?: Record<string, string> } = {},
): Fixture {
  const pages = opts.pages ?? "wiki";
  const collection = opts.collection ?? "wiki";
  const root = mkdtempSync(join(tmpdir(), "kb-vault-"));

  writeFileSync(
    join(root, ".kb.yaml"),
    `pages: ${pages}\nsources: raw\ncollection: ${collection}\n`,
  );
  mkdirSync(join(root, pages), { recursive: true });

  for (const [name, body] of Object.entries(opts.docs ?? {})) {
    writeFileSync(join(root, pages, name), body);
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
```

- [ ] **Step 6: 통과 확인**

Run: `bun test lib/mcp/fixture.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 7: 커밋**

```bash
git add package.json bun.lock lib/mcp/fixture.ts lib/mcp/fixture.test.ts
git commit -m "test: add vault fixture and declare mcp dependencies

The SDK and zod were only reachable through qmd's nested node_modules.
Declare them directly so a qmd dependency cleanup cannot break us."
```

---

### Task 2: store.ts — 격리

이 태스크가 프로젝트 전체의 이유다. vault 설정을 `createStore` 인자로 번역하고, 전역 config가 오염되어 있어도 그것이 새어들지 않음을 증명한다.

**Files:**
- Create: `lib/mcp/store.ts`
- Test: `lib/mcp/store.test.ts`

**Interfaces:**
- Consumes: `makeVault` (Task 1), `loadVault` from `../vault.ts`, `createStore` / `QMDStore` from `@tobilu/qmd`
- Produces:
  - `storeOptionsFor(vault: VaultConfig): { dbPath: string; config: { collections: Record<string, { path: string; pattern: string }> } }`
  - `openStore(from?: string): Promise<{ store: QMDStore; vault: VaultConfig }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/mcp/store.test.ts`:

```ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";
import { loadVault } from "../vault.ts";
import { storeOptionsFor, openStore } from "./store.ts";

test("storeOptionsFor puts the index inside the vault", () => {
  const v = makeVault();
  try {
    const opts = storeOptionsFor(loadVault(v.root));
    expect(opts.dbPath).toBe(join(v.root, ".qmd", "index.sqlite"));
  } finally {
    v.cleanup();
  }
});

test("storeOptionsFor names the collection from .kb.yaml and pins the pattern", () => {
  const v = makeVault({ pages: "notes", collection: "kb-notes" });
  try {
    const opts = storeOptionsFor(loadVault(v.root));
    expect(Object.keys(opts.config.collections)).toEqual(["kb-notes"]);
    expect(opts.config.collections["kb-notes"]).toEqual({
      path: join(v.root, "notes"),
      pattern: "**/*.md",
    });
  } finally {
    v.cleanup();
  }
});

test("storeOptionsFor never yields a configPath", () => {
  const v = makeVault();
  try {
    // A configPath would send qmd looking for global config. It must not exist.
    expect("configPath" in storeOptionsFor(loadVault(v.root))).toBe(false);
  } finally {
    v.cleanup();
  }
});

test("openStore fails loudly when there is no vault", async () => {
  await expect(openStore("/")).rejects.toThrow(/No vault found/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test lib/mcp/store.test.ts`
Expected: FAIL — `Cannot find module './store.ts'`

- [ ] **Step 3: store.ts 구현**

Create `lib/mcp/store.ts`:

```ts
/**
 * Turns a vault's .kb.yaml into a qmd store.
 *
 * Isolation is the whole point. We pass dbPath and an inline collection config,
 * so qmd never consults its global config (~/.config/qmd/index.yml). A vault
 * cannot reach another vault's index because there is no path by which to do so.
 */

import { join } from "node:path";
import { createStore, type QMDStore } from "@tobilu/qmd";
import { loadVault, type VaultConfig } from "../vault.ts";

/** qmd's default pattern is not ours to inherit — pin it. */
const PATTERN = "**/*.md";

export type StoreOptions = {
  dbPath: string;
  config: { collections: Record<string, { path: string; pattern: string }> };
};

export function storeOptionsFor(vault: VaultConfig): StoreOptions {
  return {
    dbPath: join(vault.root, ".qmd", "index.sqlite"),
    // vault.pages is already absolute — loadVault joined it against root.
    config: { collections: { [vault.collection]: { path: vault.pages, pattern: PATTERN } } },
  };
}

export async function openStore(from?: string): Promise<{ store: QMDStore; vault: VaultConfig }> {
  const vault = loadVault(from);
  return { store: await createStore(storeOptionsFor(vault)), vault };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test lib/mcp/store.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: 격리 회귀 테스트를 추가한다**

이것이 스펙이 "반드시 자동화한다"고 못박은 테스트다. 전역 config에 다른 컬렉션이 있는 상태를 재현하고, 그것이 결과에 섞이지 않음을 확인한다.

Append to `lib/mcp/store.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

test("a polluted global config does not leak into the vault", async () => {
  // Point qmd's global config at a directory full of documents that must never
  // show up. This is the failure the whole design exists to prevent.
  const stranger = mkdtempSync(join(tmpdir(), "kb-stranger-"));
  mkdirSync(join(stranger, "docs"), { recursive: true });
  writeFileSync(join(stranger, "docs", "secret.md"), "# Secret\n\nzzyzx marker");

  const home = mkdtempSync(join(tmpdir(), "kb-home-"));
  mkdirSync(join(home, ".config", "qmd"), { recursive: true });
  writeFileSync(
    join(home, ".config", "qmd", "index.yml"),
    `collections:\n  stranger:\n    path: ${join(stranger, "docs")}\n    pattern: "**/*.md"\n`,
  );

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");

  const v = makeVault({ docs: { "own.md": "# Own\n\nqwyjibo marker" } });
  try {
    const { store } = await openStore(v.root);
    await store.update();

    const names = (await store.listCollections()).map((c) => c.name);
    expect(names).toEqual(["wiki"]);
    expect(names).not.toContain("stranger");

    const hits = await store.searchLex("zzyzx");
    expect(hits).toHaveLength(0);

    await store.close();
  } finally {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    v.cleanup();
  }
});
```

- [ ] **Step 6: 격리 테스트 통과 확인**

Run: `bun test lib/mcp/store.test.ts`
Expected: PASS, 5 tests

실패한다면 격리가 실제로 안 되는 것이므로 설계 전제가 무너진다. 넘어가지 말고 보고할 것.

- [ ] **Step 7: 커밋**

```bash
git add lib/mcp/store.ts lib/mcp/store.test.ts
git commit -m "feat(mcp): resolve a vault into an isolated qmd store

Passing dbPath plus an inline collection config means qmd never reads its
global config, so one vault cannot see another's collections. The
regression test pollutes a fake global config and asserts nothing leaks."
```

---

### Task 3: store.ts — 자동 복구

인덱스가 없거나 비어 있어도 검색이 되게 만든다. 실측상 `update()`는 18ms, `embed()`는 3.3초(문서 5개, 모델 로딩 포함)다. 임베딩이 초 단위이므로 MCP 핸드셰이크를 붙잡지 않도록 백그라운드로 돌리고 툴 호출이 기다리게 한다.

**Files:**
- Modify: `lib/mcp/store.ts`
- Test: `lib/mcp/store.test.ts`

**Interfaces:**
- Consumes: Task 2의 `openStore`
- Produces: `prepareStore(from?: string): Promise<Prepared>` where
  ```ts
  type Prepared = {
    store: QMDStore;
    vault: VaultConfig;
    ready: Promise<void>;      // resolves when recovery finishes; never rejects
    recovery: { state: "pending" | "done" | "failed"; error?: string };
    close: () => Promise<void>;
  };
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Append to `lib/mcp/store.test.ts`:

```ts
import { prepareStore } from "./store.ts";

test("recovery indexes an empty vault so lex search works", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nthe quokka is a marsupial" } });
  try {
    const p = await prepareStore(v.root);
    expect(p.recovery.state).toBe("pending");

    await p.ready;
    expect(p.recovery.state).toBe("done");

    const hits = await p.store.searchLex("quokka");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].displayPath).toContain("a.md");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 60_000);

test("recovery embeds so vector search is available", async () => {
  const v = makeVault({ docs: { "b.md": "# Beta\n\npostgres connection pooling" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const status = await p.store.getStatus();
    expect(status.totalDocuments).toBe(1);
    expect(status.needsEmbedding).toBe(0);
    expect(status.hasVectorIndex).toBe(true);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("a failed recovery leaves the server usable", async () => {
  const v = makeVault({ docs: { "c.md": "# Gamma\n\nnumbat" } });
  try {
    const p = await prepareStore(v.root);
    // Break embedding only. Indexing already happened, so lex must still work.
    p.store.embed = () => Promise.reject(new Error("no model"));
    await p.ready;

    expect(p.recovery.state).toBe("failed");
    expect(p.recovery.error).toContain("no model");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 60_000);
```

- [ ] **Step 2: 실패 확인**

Run: `bun test lib/mcp/store.test.ts`
Expected: FAIL — `prepareStore is not a function`

- [ ] **Step 3: prepareStore 구현**

Append to `lib/mcp/store.ts`:

```ts
export type Recovery = { state: "pending" | "done" | "failed"; error?: string };

export type Prepared = {
  store: QMDStore;
  vault: VaultConfig;
  /** Resolves when recovery settles. Never rejects — check `recovery` instead. */
  ready: Promise<void>;
  recovery: Recovery;
  close: () => Promise<void>;
};

/**
 * Open a vault's store and bring it to a searchable state.
 *
 * Recovery runs in the background: embedding takes seconds, and blocking the MCP
 * handshake that long risks a client timeout. Tool handlers await `ready`.
 *
 * A failure here does not kill the server. Lex search still works when only
 * embedding failed, and a partly working server beats a dead one.
 */
export async function prepareStore(from?: string): Promise<Prepared> {
  const { store, vault } = await openStore(from);
  const recovery: Recovery = { state: "pending" };

  const ready = (async () => {
    try {
      await store.update();
      if ((await store.getStatus()).needsEmbedding > 0) await store.embed();
      recovery.state = "done";
    } catch (error) {
      recovery.state = "failed";
      recovery.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return {
    store,
    vault,
    ready,
    recovery,
    close: async () => {
      await ready;
      await store.close();
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test lib/mcp/store.test.ts`
Expected: PASS, 8 tests. 임베딩 때문에 수십 초 걸린다.

- [ ] **Step 5: 커밋**

```bash
git add lib/mcp/store.ts lib/mcp/store.test.ts
git commit -m "feat(mcp): recover an empty index in the background

update() then embed() when needed. Recovery runs off the handshake path
because embedding takes seconds; tool handlers await it. A failure is
recorded rather than fatal — lex search survives a missing model."
```

---

### Task 4: tools.ts — query와 status

툴 4개 중 검색과 상태. SDK 호출을 MCP 응답으로 감싼다. `search()`에는 호출자가 준 옵션만 넘긴다 — 기본값은 qmd 것을 쓴다.

**Files:**
- Create: `lib/mcp/tools.ts`
- Test: `lib/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `Prepared` (Task 3)
- Produces:
  - `querySchema` / `statusSchema`: zod raw shape 객체
  - `handleQuery(p: Prepared, args): Promise<{ content: [{type:"text";text:string}]; structuredContent: { results: QueryHit[] } }>`
  - `handleStatus(p: Prepared): Promise<{ content: [{type:"text";text:string}]; structuredContent: IndexStatus }>`
  - `type QueryHit = { file: string; displayPath: string; title: string; score: number; line: number; context: string | null; docid: string; snippet: string }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/mcp/tools.test.ts`:

```ts
import { test, expect } from "bun:test";
import { makeVault } from "./fixture.ts";
import { prepareStore } from "./store.ts";
import { handleQuery, handleStatus, querySchema } from "./tools.ts";

test("query returns hits with the fields callers cite", async () => {
  const v = makeVault({ docs: { "pool.md": "# Pools\n\nconnection pool timeouts under load" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleQuery(p, { searches: [{ type: "lex", query: "connection pool" }] });
    expect(out.structuredContent.results.length).toBeGreaterThan(0);

    const hit = out.structuredContent.results[0];
    expect(hit.displayPath).toContain("pool.md");
    expect(typeof hit.score).toBe("number");
    expect(typeof hit.line).toBe("number");
    expect(typeof hit.docid).toBe("string");
    expect(out.content[0].type).toBe("text");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("status mirrors IndexStatus exactly", async () => {
  const v = makeVault({ docs: { "a.md": "# A\n\nalpha" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleStatus(p);
    expect(Object.keys(out.structuredContent).sort()).toEqual(
      ["collections", "hasVectorIndex", "needsEmbedding", "totalDocuments"],
    );
    expect(out.structuredContent.totalDocuments).toBe(1);
    expect(out.structuredContent.collections[0].name).toBe("wiki");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("query schema keeps collections plural", () => {
  // The singular form is the trap this project exists to close.
  expect(querySchema.collections).toBeDefined();
  expect((querySchema as Record<string, unknown>).collection).toBeUndefined();
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test lib/mcp/tools.test.ts`
Expected: FAIL — `Cannot find module './tools.ts'`

- [ ] **Step 3: tools.ts 구현**

Create `lib/mcp/tools.ts`:

```ts
/**
 * The four tools, mirroring qmd mcp's surface.
 *
 * Handlers know about the store and about MCP's response shape, but nothing
 * about transports. Search options are forwarded only when the caller supplied
 * them, so qmd's own defaults stand.
 */

import { z } from "zod";
import type { HybridQueryResult, IndexStatus } from "@tobilu/qmd";
import type { Prepared } from "./store.ts";

export const querySchema = {
  searches: z
    .array(
      z.object({
        type: z.enum(["lex", "vec", "hyde"]),
        query: z.string(),
      }),
    )
    .min(1)
    .max(10)
    .describe("Typed sub-queries to execute (lex/vec/hyde). First gets 2x weight."),
  limit: z.number().optional().describe("Max results (default: 10)"),
  minScore: z.number().optional().describe("Min relevance 0-1 (default: 0)"),
  candidateLimit: z.number().optional().describe("Maximum candidates to rerank (default: 40)"),
  collections: z.array(z.string()).optional().describe("Filter to collections (OR match)"),
  intent: z.string().optional().describe("Background context to disambiguate the query."),
  rerank: z.boolean().optional().describe("Rerank results using LLM (default: true)"),
};

export const statusSchema = {};

export type QueryHit = {
  file: string;
  displayPath: string;
  title: string;
  score: number;
  line: number;
  context: string | null;
  docid: string;
  snippet: string;
};

/** qmd reports the best chunk's character offset; callers want a line number. */
function lineOf(body: string, charPos: number): number {
  if (charPos <= 0) return 1;
  let line = 1;
  for (let i = 0; i < Math.min(charPos, body.length); i++) {
    if (body[i] === "\n") line++;
  }
  return line;
}

function toHit(r: HybridQueryResult): QueryHit {
  return {
    file: r.file,
    displayPath: r.displayPath,
    title: r.title,
    score: r.score,
    line: lineOf(r.body, r.bestChunkPos),
    context: r.context,
    docid: r.docid,
    snippet: r.bestChunk,
  };
}

export async function handleQuery(
  p: Prepared,
  args: {
    searches: { type: "lex" | "vec" | "hyde"; query: string }[];
    limit?: number;
    minScore?: number;
    candidateLimit?: number;
    collections?: string[];
    intent?: string;
    rerank?: boolean;
  },
) {
  await p.ready;

  // Forward only what the caller set; omitted keys must fall through to qmd's defaults.
  const results = await p.store.search({
    queries: args.searches,
    ...(args.limit !== undefined && { limit: args.limit }),
    ...(args.minScore !== undefined && { minScore: args.minScore }),
    ...(args.candidateLimit !== undefined && { candidateLimit: args.candidateLimit }),
    ...(args.collections !== undefined && { collections: args.collections }),
    ...(args.intent !== undefined && { intent: args.intent }),
    ...(args.rerank !== undefined && { rerank: args.rerank }),
  });

  const hits = results.map(toHit);
  const text = hits.length
    ? hits.map((h) => `${h.displayPath}:${h.line} (${h.score.toFixed(3)})\n${h.snippet}`).join("\n\n")
    : "No results.";

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { results: hits },
  };
}

export async function handleStatus(p: Prepared) {
  await p.ready;
  const status: IndexStatus = await p.store.getStatus();

  const lines = [
    "QMD Index Status:",
    `  Total documents: ${status.totalDocuments}`,
    `  Needs embedding: ${status.needsEmbedding}`,
    `  Vector index: ${status.hasVectorIndex ? "yes" : "no"}`,
    `  Collections: ${status.collections.length}`,
    ...status.collections.map((c) => `    - ${c.name}: ${c.path} (${c.documents} docs)`),
  ];
  if (p.recovery.state === "failed") lines.push(`  Recovery failed: ${p.recovery.error}`);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: status,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test lib/mcp/tools.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: 커밋**

```bash
git add lib/mcp/tools.ts lib/mcp/tools.test.ts
git commit -m "feat(mcp): add query and status handlers

Search options are forwarded only when supplied so qmd's defaults hold.
The filter parameter stays plural — the singular spelling is the trap
this server exists to close."
```

---

### Task 5: tools.ts — get과 multi_get

문서 검색 결과를 실제로 읽는 두 툴.

**Files:**
- Modify: `lib/mcp/tools.ts`
- Test: `lib/mcp/tools.test.ts`

**Interfaces:**
- Consumes: Task 4의 `Prepared`, `handleQuery`
- Produces:
  - `getSchema` / `multiGetSchema`: zod raw shape
  - `handleGet(p, args): Promise<{ content: [{type:"text";text:string}]; structuredContent: object }>`
  - `handleMultiGet(p, args): Promise<{ content: [{type:"text";text:string}]; structuredContent: object }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Append to `lib/mcp/tools.test.ts`:

```ts
import { handleGet, handleMultiGet } from "./tools.ts";

test("get returns numbered lines by default", async () => {
  const v = makeVault({ docs: { "a.md": "# A\n\nline two\nline three\nline four" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleGet(p, { file: "a.md" });
    expect(out.content[0].text).toContain("1: # A");
    expect(out.content[0].text).toContain("line four");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("get slices by line range and can drop numbers", async () => {
  const v = makeVault({ docs: { "a.md": "one\ntwo\nthree\nfour\nfive" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleGet(p, { file: "a.md", fromLine: 2, maxLines: 2, lineNumbers: false });
    expect(out.content[0].text).toContain("two");
    expect(out.content[0].text).toContain("three");
    expect(out.content[0].text).not.toContain("five");
    expect(out.content[0].text).not.toMatch(/^\d+: /m);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("a missing document is a result, not a protocol error", async () => {
  const v = makeVault({ docs: { "a.md": "# A" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleGet(p, { file: "nope.md" });
    expect(out.content[0].text).toContain("not found");
    expect((out.structuredContent as { error?: string }).error).toBe("not_found");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("multi_get fetches by glob", async () => {
  const v = makeVault({ docs: { "a.md": "# A\n\nalpha", "b.md": "# B\n\nbeta" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleMultiGet(p, { pattern: "*.md" });
    expect(out.content[0].text).toContain("alpha");
    expect(out.content[0].text).toContain("beta");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);
```

- [ ] **Step 2: 실패 확인**

Run: `bun test lib/mcp/tools.test.ts`
Expected: FAIL — `handleGet is not a function`

- [ ] **Step 3: 두 핸들러 구현**

Append to `lib/mcp/tools.ts`:

```ts
import { addLineNumbers, DEFAULT_MULTI_GET_MAX_BYTES } from "@tobilu/qmd";

export const getSchema = {
  file: z.string().describe("File path or docid from search results."),
  fromLine: z.number().optional().describe("Start from this line number (1-indexed)"),
  maxLines: z.number().optional().describe("Maximum number of lines to return"),
  lineNumbers: z.boolean().optional().describe("Add line numbers to output (default: true)"),
};

export const multiGetSchema = {
  pattern: z.string().describe("Glob pattern or comma-separated list of file paths"),
  maxLines: z.number().optional().describe("Maximum lines per file"),
  maxBytes: z.number().optional().describe("Skip files larger than this (default: 10240)"),
  lineNumbers: z.boolean().optional().describe("Add line numbers to output (default: true)"),
};

function clip(body: string, maxLines?: number): string {
  if (maxLines === undefined) return body;
  return body.split("\n").slice(0, maxLines).join("\n");
}

export async function handleGet(
  p: Prepared,
  args: { file: string; fromLine?: number; maxLines?: number; lineNumbers?: boolean },
) {
  await p.ready;

  const doc = await p.store.get(args.file);
  if ("error" in doc) {
    const suggestion = doc.similarFiles.length
      ? `\nSimilar files: ${doc.similarFiles.join(", ")}`
      : "";
    return {
      content: [{ type: "text" as const, text: `Document not found: ${args.file}${suggestion}` }],
      structuredContent: doc,
    };
  }

  const body =
    (await p.store.getDocumentBody(args.file, {
      ...(args.fromLine !== undefined && { fromLine: args.fromLine }),
      ...(args.maxLines !== undefined && { maxLines: args.maxLines }),
    })) ?? "";

  const numbered =
    args.lineNumbers === false ? body : addLineNumbers(body, args.fromLine ?? 1);

  return {
    content: [{ type: "text" as const, text: `${doc.displayPath} (#${doc.docid})\n${numbered}` }],
    structuredContent: { ...doc, body },
  };
}

export async function handleMultiGet(
  p: Prepared,
  args: { pattern: string; maxLines?: number; maxBytes?: number; lineNumbers?: boolean },
) {
  await p.ready;

  const { docs, errors } = await p.store.multiGet(args.pattern, {
    includeBody: true,
    maxBytes: args.maxBytes ?? DEFAULT_MULTI_GET_MAX_BYTES,
  });

  const chunks = docs.map((entry) => {
    if (entry.skipped) return `${entry.doc.displayPath}\n[skipped: ${entry.skipReason}]`;
    const body = clip(entry.doc.body ?? "", args.maxLines);
    const shown = args.lineNumbers === false ? body : addLineNumbers(body, 1);
    return `${entry.doc.displayPath} (#${entry.doc.docid})\n${shown}`;
  });

  if (errors.length) chunks.push(`Errors: ${errors.join(", ")}`);

  return {
    content: [{ type: "text" as const, text: chunks.join("\n\n") || "No documents matched." }],
    structuredContent: { docs, errors },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test lib/mcp/tools.test.ts`
Expected: PASS, 7 tests

시그니처는 확인했다: `addLineNumbers(text: string, startLine?: number): string`

- [ ] **Step 5: 커밋**

```bash
git add lib/mcp/tools.ts lib/mcp/tools.test.ts
git commit -m "feat(mcp): add get and multi_get handlers

A missing document comes back as a result with qmd's suggestions rather
than a protocol error — the caller can act on it either way."
```

---

### Task 6: server.ts — 진입점

트랜스포트를 열고 툴 4개를 등록한다. `instructions`는 `getStatus()`로 조립하되, 원문의 단수 `collection` 오기는 복수로 고쳐 쓴다.

**Files:**
- Create: `lib/mcp/server.ts`
- Test: `lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: `prepareStore` (Task 3), 모든 스키마와 핸들러 (Task 4-5)
- Produces: `buildInstructions(status: IndexStatus, collection: string): string`, `createMcpServer(p: Prepared): Promise<McpServer>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/mcp/server.test.ts`:

```ts
import { test, expect } from "bun:test";
import { buildInstructions } from "./server.ts";

const status = {
  totalDocuments: 42,
  needsEmbedding: 0,
  hasVectorIndex: true,
  collections: [
    { name: "wiki", path: "/vault/wiki", pattern: "**/*.md", documents: 42, lastUpdated: "" },
  ],
};

test("instructions report the live document count", () => {
  expect(buildInstructions(status, "wiki")).toContain("42 markdown documents");
});

test("instructions say collections, never the singular trap", () => {
  const text = buildInstructions(status, "wiki");
  expect(text).toContain("`collections`");
  expect(text).not.toMatch(/`collection`[^s]/);
});

test("instructions surface pending embedding work", () => {
  const stale = { ...status, needsEmbedding: 41 };
  expect(buildInstructions(stale, "wiki")).toContain("41 documents need embedding");
});

test("instructions stay quiet when the index is healthy", () => {
  expect(buildInstructions(status, "wiki")).not.toContain("need embedding");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test lib/mcp/server.test.ts`
Expected: FAIL — `Cannot find module './server.ts'`

- [ ] **Step 3: server.ts 구현**

Create `lib/mcp/server.ts`:

```ts
#!/usr/bin/env bun
/**
 * kb MCP server.
 *
 *   bun lib/mcp/server.ts     # serves the vault containing cwd
 *
 * Same four tools as `qmd mcp`, built on the qmd SDK so the vault's index is
 * the only one reachable.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { IndexStatus } from "@tobilu/qmd";
import { VaultNotFound } from "../vault.ts";
import { prepareStore, type Prepared } from "./store.ts";
import {
  querySchema,
  statusSchema,
  getSchema,
  multiGetSchema,
  handleQuery,
  handleStatus,
  handleGet,
  handleMultiGet,
} from "./tools.ts";

/**
 * qmd's own instructions tell callers to scope with a singular `collection`
 * while the schema takes plural `collections`. We own this text, so we fix it.
 */
export function buildInstructions(status: IndexStatus, collection: string): string {
  const lines = [
    `This vault holds ${status.totalDocuments} markdown documents.`,
    "",
    `Collection: ${collection}. Filter with the \`collections\` parameter — plural, an array.`,
  ];

  if (status.needsEmbedding > 0) {
    lines.push(
      "",
      `Note: ${status.needsEmbedding} documents need embedding. Vector and hyde searches stay incomplete until that finishes.`,
    );
  }

  lines.push(
    "",
    "Search with `query` using typed sub-queries:",
    "  - lex — BM25 keywords (exact terms, fast)",
    "  - vec — semantic vector search (meaning-based)",
    "  - hyde — hypothetical answer passage",
    "",
    "Retrieval: `get` for one document (path or #docid, line ranges supported),",
    "`multi_get` for a glob or comma-separated list.",
  );

  return lines.join("\n");
}

export async function createMcpServer(p: Prepared): Promise<McpServer> {
  const server = new McpServer(
    { name: "kb", version: "1.0.0" },
    { instructions: buildInstructions(await p.store.getStatus(), p.vault.collection) },
  );

  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "query",
    {
      title: "Query",
      description:
        "Search the vault with one or more typed sub-queries (lex/vec/hyde) combined for recall. " +
        "Each result carries a `line` field — call get(file, fromLine, maxLines) to read around it.",
      inputSchema: querySchema,
      annotations: readOnly,
    },
    (args) => handleQuery(p, args),
  );

  server.registerTool(
    "get",
    {
      title: "Get Document",
      description:
        "Retrieve a document by file path or docid (#abc123). Suggests similar files if not found.",
      inputSchema: getSchema,
      annotations: readOnly,
    },
    (args) => handleGet(p, args),
  );

  server.registerTool(
    "multi_get",
    {
      title: "Multi-Get Documents",
      description:
        "Retrieve multiple documents by glob pattern or comma-separated list. Skips oversized files.",
      inputSchema: multiGetSchema,
      annotations: readOnly,
    },
    (args) => handleMultiGet(p, args),
  );

  server.registerTool(
    "status",
    {
      title: "Index Status",
      description: "Show the vault index: collections, document counts, embedding state.",
      inputSchema: statusSchema,
      annotations: readOnly,
    },
    () => handleStatus(p),
  );

  return server;
}

if (import.meta.main) {
  let prepared: Prepared;
  try {
    prepared = await prepareStore();
  } catch (error) {
    // A stack trace helps nobody here. Show what to create instead.
    if (error instanceof VaultNotFound) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  const server = await createMcpServer(prepared);
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test lib/mcp/server.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: vault 없을 때 동작 확인**

Run: `cd /tmp && bun /Users/jito.hello/dev/kb/lib/mcp/server.ts; echo "exit=$?"`
Expected: `.kb.yaml` 예시를 담은 안내 출력, `exit=2`

- [ ] **Step 6: 커밋**

```bash
git add lib/mcp/server.ts lib/mcp/server.test.ts
git commit -m "feat(mcp): serve the four tools over stdio

Instructions are assembled from live status. qmd's version tells callers
to scope with a singular \`collection\` while its schema takes the plural;
we own this text now, so it says \`collections\`."
```

---

### Task 7: 엔드투엔드 검증과 문서

서버를 실제 MCP 클라이언트로 두드려 `qmd mcp`와 같은 표면인지 확인하고, README를 새 방식으로 갱신한다.

**Files:**
- Create: `lib/mcp/e2e.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: 전부

- [ ] **Step 1: 엔드투엔드 테스트를 쓴다**

Create `lib/mcp/e2e.test.ts`:

```ts
import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";

const SERVER = join(import.meta.dir, "server.ts");

test("the server exposes exactly the four qmd tools", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nwombat husbandry notes" } });
  try {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: "bun", args: [SERVER], cwd: v.root }),
    );

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get", "multi_get", "query", "status"]);

    await client.close();
  } finally {
    v.cleanup();
  }
}, 180_000);

test("a query round-trips through the protocol", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nwombat husbandry notes" } });
  try {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: "bun", args: [SERVER], cwd: v.root }),
    );

    const res = await client.callTool({
      name: "query",
      arguments: { searches: [{ type: "lex", query: "wombat" }] },
    });
    expect(JSON.stringify(res.content)).toContain("a.md");

    await client.close();
  } finally {
    v.cleanup();
  }
}, 180_000);
```

- [ ] **Step 2: 실행**

Run: `bun test lib/mcp/e2e.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 3: 전체 테스트 실행**

Run: `bun test`
Expected: 전부 PASS

- [ ] **Step 4: README 갱신**

`README.md`의 "Point a working repo at its vault via `.mcp.json`" 블록을 교체한다. 기존:

```json
{
  "mcpServers": {
    "kb": { "command": "qmd", "args": ["mcp"], "cwd": "/path/to/vault" }
  }
}
```

새 내용:

```json
{
  "mcpServers": {
    "kb": {
      "command": "bun",
      "args": ["${CLAUDE_PLUGIN_ROOT}/lib/mcp/server.ts"],
      "cwd": "/path/to/vault"
    }
  }
}
```

그리고 Setup 절의 `qmd init` 3줄 블록과 그 아래 글로벌 config 경고 문단을 다음으로 교체한다. 서버가 `.kb.yaml`만 보고 인덱스를 만들므로 수동 등록이 필요 없어졌다:

```markdown
The server reads `.kb.yaml`, keeps its index in the vault's own `.qmd/`, and
indexes on first run. No `qmd init`, no collection registration — it passes the
collection to qmd directly, so the global config is never consulted and one
vault cannot see another's collections.

The qmd CLI still works inside a vault for ad-hoc searching, but it follows the
global config rules described in its own docs.
```

`collections` 복수형 경고 문단은 남긴다. 서버 스키마가 복수형이므로 여전히 맞는 정보다.

- [ ] **Step 5: 린트**

Run: `bun lib/lint.ts`
Expected: vault가 아니므로 exit 2 (정상). README 변경은 markdownlint 대상이 아니다.

- [ ] **Step 6: 커밋**

```bash
git add lib/mcp/e2e.test.ts README.md
git commit -m "test(mcp): verify the tool surface end to end

Point .mcp.json at the wrapper instead of qmd mcp. Setup loses the manual
qmd init dance — the server builds its own vault-local index on first run."
```

---

## Self-Review

**Spec coverage**

| 스펙 요구 | 태스크 |
|---|---|
| 툴 4개 노출 | 4, 5, 6 |
| SDK 직접 import | 2 |
| `lib/mcp/{server,store,tools}.ts` 구조 | 2, 4, 6 |
| 격리 (dbPath + 인라인 config) | 2 |
| `pattern` 명시 | 2 |
| 자동 복구 (update → embed) | 3 |
| 복구 비블로킹 + 툴이 await | 3 |
| 복구 실패해도 생존 | 3 |
| 검색 옵션 qmd 기본값 | 4 |
| `collections` 복수 유지 | 4 |
| instructions 조립 + 단수 오기 수정 | 6 |
| vault 없음 → 안내 후 종료 | 6 |
| 문서 없음 → 결과로 전달 | 5 |
| 격리 회귀 테스트 (전역 config 오염) | 2 Step 5 |

전 항목이 태스크에 대응한다.

**Type consistency**

`Prepared`는 Task 3에서 정의되어 4, 5, 6이 그대로 쓴다. `storeOptionsFor`/`openStore`/`prepareStore` 이름이 태스크 간 일치한다. 핸들러는 전부 `handleX(p, args)` 형태다. `IndexStatus`, `HybridQueryResult`, `DocumentResult`는 SDK에서 확인한 실제 필드명을 쓴다 (`filepath`/`displayPath`/`docid`, `bestChunkPos`, `similarFiles`).

**남은 검증 지점**

- `store.search({ queries })`가 `ExpandedQuery[]`를 받는 것은 타입 선언으로 확인했으나 런타임 동작은 Task 4 테스트가 처음 증명한다.
- 전역 config 오염 재현이 `HOME`/`XDG_CONFIG_HOME` 조작으로 되는지는 Task 2 Step 6에서 처음 밝혀진다. 안 되면 그 테스트가 무의미해지므로 보고 대상이다.
