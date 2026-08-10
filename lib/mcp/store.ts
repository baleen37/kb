/**
 * Turns a vault's .kb.yaml into a qmd store.
 *
 * Isolation is the whole point. We pass dbPath and an inline collection config,
 * so qmd never consults its global config (~/.config/qmd/index.yml). A vault
 * cannot reach another vault's index because there is no path by which to do so.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createStore, type QMDStore } from "@tobilu/qmd";
import { loadVault, type VaultConfig } from "../vault.ts";

/** qmd's default pattern is not ours to inherit — pin it. */
const PATTERN = "**/*.md";

export type StoreOptions = {
  dbPath: string;
  config: { collections: Record<string, { path: string; pattern: string }> };
};

export function storeOptionsFor(vault: VaultConfig): StoreOptions {
  return {
    dbPath: join(vault.root, ".qmd", "index.sqlite"),
    // vault.pages is already absolute — loadVault joined it against root.
    config: { collections: { [vault.collection]: { path: vault.pages, pattern: PATTERN } } },
  };
}

export async function openStore(from?: string): Promise<{ store: QMDStore; vault: VaultConfig }> {
  const vault = loadVault(from);
  const opts = storeOptionsFor(vault);
  // qmd opens the SQLite file directly and never creates its parent.
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  return { store: await createStore(opts), vault };
}

export type Recovery = { state: "pending" | "done" | "failed"; error?: string };

export type Prepared = {
  store: QMDStore;
  vault: VaultConfig;
  /** Resolves when recovery settles. Never rejects — check `recovery` instead. */
  ready: Promise<void>;
  recovery: Recovery;
  close: () => Promise<void>;
};

/**
 * Runs embed.ts against a vault. Returns the promise plus a way to stop it —
 * embedding a large vault takes minutes, and shutdown should not wait for it.
 */
function embedElsewhere(root: string): { done: Promise<void>; cancel: () => void } {
  // Tests that do not assert on vectors point this at a stub, because loading
  // the model costs ~50s per spawn on a CPU-only runner. It stays a spawn of a
  // real script either way, so the child-process boundary is still exercised.
  const script = process.env.KB_EMBED_SCRIPT ?? join(import.meta.dir, "embed.ts");
  const child = spawn(process.execPath, [script, root], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let cancelled = false;

  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      // Our own kill is a clean stop, not a failure.
      if (cancelled) return resolve();
      if (code === 0) return resolve();

      const how = signal ? `killed by ${signal}` : `exited ${code}`;
      reject(new Error(`embed ${how}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      child.kill();
    },
  };
}

/**
 * Open a vault's store and bring it to a searchable state.
 *
 * Indexing happens here — it is milliseconds. Embedding happens in a child
 * process, where it cannot pin this process's CPU and GPU for seconds while
 * tool calls wait. See lib/mcp/embed.ts.
 *
 * Recovery runs in the background either way; tool handlers await `ready`.
 * A failure does not kill the server — lex search still works without vectors,
 * and a partly working server beats a dead one. `close` cancels an embed in
 * flight rather than waiting it out.
 */
export async function prepareStore(from?: string): Promise<Prepared> {
  const { store, vault } = await openStore(from);
  const recovery: Recovery = { state: "pending" };

  let stopEmbedding: (() => void) | undefined;

  const ready = (async () => {
    try {
      await store.update();
      if ((await store.getStatus()).needsEmbedding > 0) {
        const embedding = embedElsewhere(vault.root);
        stopEmbedding = embedding.cancel;
        await embedding.done;
      }
      recovery.state = "done";
    } catch (error) {
      recovery.state = "failed";
      recovery.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return {
    store,
    vault,
    ready,
    recovery,
    close: async () => {
      // Stop any embedding first. Waiting for it would hold shutdown open for
      // as long as the vault takes to embed — minutes, on a large one.
      stopEmbedding?.();
      await ready;
      await store.close();
    },
  };
}
