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

test("instructions never claim a document count", () => {
  // They are built before indexing runs, so a count would read "0 markdown
  // documents" for a full vault and talk the client out of searching it.
  const empty = { ...status, totalDocuments: 0, collections: [] };
  expect(buildInstructions(empty, "wiki")).not.toMatch(/\d+ markdown documents/);
  expect(buildInstructions(status, "wiki")).not.toMatch(/\d+ markdown documents/);
  expect(buildInstructions(empty, "wiki")).toContain("searchable vault");
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
