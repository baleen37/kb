import { test, expect } from "bun:test";
import { makeVault } from "./fixture.ts";
import { prepareStore } from "./store.ts";
import { handleQuery, handleStatus, handleGet, querySchema } from "./tools.ts";

// rerank runs an LLM, and qmd refuses that whenever CI=true, so a reranked
// query cannot resolve on a runner. The fields asserted here come from the hit
// itself, not from the ordering, so this turns rerank off and covers the
// forwarding separately below.
test("query returns hits with the fields callers cite", async () => {
  const v = makeVault({ docs: { "pool.md": "# Pools\n\nconnection pool timeouts under load" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleQuery(p, {
      searches: [{ type: "lex", query: "connection pool" }],
      rerank: false,
    });
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

// The real store reranks by default, which an LLM-less runner cannot do. A stub
// store records what handleQuery forwarded, so the default and an explicit
// override are both covered without reaching a model.
test("query leaves rerank to qmd unless the caller sets it", async () => {
  const calls: Record<string, unknown>[] = [];
  const p = {
    ready: Promise.resolve(),
    vault: { collection: "wiki" },
    store: {
      search: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return [];
      },
    },
  } as unknown as Parameters<typeof handleQuery>[0];

  await handleQuery(p, { searches: [{ type: "lex", query: "pool" }] });
  expect("rerank" in calls[0]).toBe(false);

  await handleQuery(p, { searches: [{ type: "lex", query: "pool" }], rerank: false });
  expect(calls[1].rerank).toBe(false);
});

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

test("query exposes no collection filter", () => {
  // A vault holds one collection, so a filter had two outcomes: the right name,
  // which changed nothing, or any other string, which silently found nothing.
  // handleQuery scopes to the vault's own collection instead.
  expect((querySchema as Record<string, unknown>).collections).toBeUndefined();
  expect((querySchema as Record<string, unknown>).collection).toBeUndefined();
});

test("query scopes itself to the vault's collection", async () => {
  const v = makeVault({ collection: "kb-notes", docs: { "a.md": "# A\n\nBM25 ranking" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    // Passing a collection is no longer possible, so the scoping has to come
    // from the store. If handleQuery stopped naming it, an unscoped search
    // would still pass — hence the assertion on what qmd was asked for.
    const asked: string[][] = [];
    const real = p.store.search.bind(p.store);
    p.store.search = ((opts: { collections?: string[] }) => {
      if (opts.collections) asked.push(opts.collections);
      return real(opts as Parameters<typeof real>[0]);
    }) as typeof p.store.search;

    const out = await handleQuery(p, {
      searches: [{ type: "lex", query: "BM25" }],
      rerank: false,
    });

    expect(asked).toEqual([["kb-notes"]]);
    expect(out.structuredContent.results.length).toBe(1);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

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
