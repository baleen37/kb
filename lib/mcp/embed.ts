#!/usr/bin/env bun
/**
 * Embeds a vault's index, in a process of its own.
 *
 *   bun lib/mcp/embed.ts <vault root>
 *
 * This exists because qmd redirects `process.stdout.write` to stderr while
 * llama initializes (its llm.ts, withNativeStdoutRedirectedToStderr) to keep
 * native library noise out of stdout. The MCP server speaks JSON-RPC over that
 * same stdout, so embedding in-process silently diverts responses to stderr and
 * the client waits forever. Running it here keeps the hijack off the server.
 */

import { openStore } from "./store.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: embed.ts <vault root>");
  process.exit(2);
}

const { store } = await openStore(root);
try {
  await store.update();
  if ((await store.getStatus()).needsEmbedding > 0) await store.embed();
} finally {
  await store.close();
}
