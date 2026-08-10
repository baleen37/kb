#!/usr/bin/env bun
/**
 * kb MCP server.
 *
 *   bun lib/mcp/server.ts     # serves the vault containing cwd
 *
 * Same four tools as `qmd mcp`, built on the qmd SDK so the vault's index is
 * the only one reachable.
 */

import { createWriteStream } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
export function buildInstructions(collection: string): string {
  // No figures from `status` here. Instructions are built at startup, before
  // recovery has indexed anything, so every count reads zero — a full vault
  // would look empty, and the "documents need embedding" warning would stay
  // silent on exactly the cold start where it matters. `status` reports live.
  const lines = [
    `A searchable vault of markdown documents.`,
    "",
    `Collection: ${collection}. Filter with the \`collections\` parameter — plural, an array.`,
    "",
    "Call `status` before relying on `vec` or `hyde`: until embedding finishes",
    "they return little or nothing, while `lex` works as soon as indexing does.",
  ];

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

export function createMcpServer(p: Prepared): McpServer {
  const server = new McpServer(
    { name: "kb", version: "1.0.0" },
    { instructions: buildInstructions(p.vault.collection) },
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

  const server = createMcpServer(prepared);

  // Our own handle on fd 1, rather than process.stdout.
  //
  // qmd swaps process.stdout.write for one that writes to stderr whenever it
  // initializes llama — on import, and again on every model load (its llm.ts,
  // withNativeStdoutRedirectedToStderr). It does that so native library noise
  // cannot corrupt a JSON stream, which is reasonable; the trouble is we speak
  // JSON-RPC over the same stdout, so replies emitted during the swap went to
  // stderr and clients hung forever.
  //
  // The transport captures whatever stream it is given at construction, so a
  // separate handle on the same descriptor sidesteps the swap entirely. Pinning
  // process.stdout.write instead would make qmd's own reassignment throw and
  // break search — this leaves qmd free to do as it likes.
  const stdout = createWriteStream("", { fd: 1 });
  await server.connect(new StdioServerTransport(process.stdin, stdout));
}
