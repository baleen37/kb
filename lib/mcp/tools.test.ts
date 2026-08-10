import { test, expect } from "bun:test";
import { makeVault } from "./fixture.ts";
import { prepareStore } from "./store.ts";
import { handleQuery, handleStatus, querySchema } from "./tools.ts";
import { handleGet, handleMultiGet } from "./tools.ts";

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

test("query schema keeps collections plural", () => {
  // The singular form is the trap this project exists to close.
  expect(querySchema.collections).toBeDefined();
  expect((querySchema as Record<string, unknown>).collection).toBeUndefined();
});

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

test("multi_get says when it truncated a document", async () => {
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const v = makeVault({ docs: { "long.md": `# Long\n\n${long}` } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleMultiGet(p, { pattern: "*.md", maxLines: 5 });
    const text = out.content[0].text;

    // Silently ending mid-document gives the caller no reason to re-fetch.
    expect(text).toContain("truncated");
    expect(text).toMatch(/\[\.\.\. truncated \d+ more lines\]/);
    expect(text).not.toContain("line 29");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("multi_get stays quiet when nothing was dropped", async () => {
  const v = makeVault({ docs: { "short.md": "# Short\n\njust two lines" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const out = await handleMultiGet(p, { pattern: "*.md", maxLines: 500 });
    expect(out.content[0].text).not.toContain("truncated");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);
