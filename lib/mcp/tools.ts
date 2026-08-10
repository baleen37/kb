/**
 * The three tools: query, get, status.
 *
 * Handlers know about the store and about MCP's response shape, but nothing
 * about transports. Search options are forwarded only when the caller supplied
 * them, so qmd's own defaults stand.
 */

import { z } from "zod";
import { addLineNumbers } from "@tobilu/qmd";
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

export const getSchema = {
  file: z.string().describe("File path or docid from search results."),
  fromLine: z.number().optional().describe("Start from this line number (1-indexed)"),
  maxLines: z.number().optional().describe("Maximum number of lines to return"),
  lineNumbers: z.boolean().optional().describe("Add line numbers to output (default: true)"),
};

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
