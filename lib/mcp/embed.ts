#!/usr/bin/env bun
/**
 * Embeds a vault's index, in a process of its own.
 *
 *   bun lib/mcp/embed.ts <vault root>
 *
 * Embedding pins CPU and GPU for seconds at a time. Off the server process, a
 * tool call arriving mid-embed is answered promptly instead of queueing behind
 * the model.
 *
 * It also used to be a correctness fix: qmd swaps `process.stdout.write` for one
 * writing to stderr while llama initializes, which corrupted the JSON-RPC stream.
 * The server now holds its own handle on fd 1 (see server.ts), so that no longer
 * depends on this — the reason to keep it is responsiveness.
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
