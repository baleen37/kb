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
