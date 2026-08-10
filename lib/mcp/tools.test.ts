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
