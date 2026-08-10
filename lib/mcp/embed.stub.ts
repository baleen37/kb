#!/usr/bin/env bun
/**
 * Stands in for embed.ts when a test does not assert on vectors.
 *
 *   KB_EMBED_SCRIPT=lib/mcp/embed.stub.ts bun test
 *
 * Loading the embedding model costs ~50s per spawn on a CPU-only runner, and
 * most tests only need recovery to reach "done" — they never look at the vector
 * index. This keeps the same contract as embed.ts (takes a vault root, exits 0
 * on success, dies on a signal) so the spawn, the exit handling and the cancel
 * path are all still the real ones. Only the model is gone.
 *
 * Tests that do assert on vectors must not use this. See store.test.ts.
 */

const root = process.argv[2];
if (!root) {
  console.error("usage: embed.stub.ts <vault root>");
  process.exit(2);
}

// Sleep rather than exit at once: prepareStore's cancel path needs a child that
// is still alive to kill, and an instant exit would make that untestable.
await new Promise((resolve) => setTimeout(resolve, 50));
