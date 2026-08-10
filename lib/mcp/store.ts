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

/** Runs embed.ts against a vault and resolves when it exits. */
function embedElsewhere(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dir, "embed.ts"), root],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`embed exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
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
 * and a partly working server beats a dead one.
 */
export async function prepareStore(from?: string): Promise<Prepared> {
  const { store, vault } = await openStore(from);
  const recovery: Recovery = { state: "pending" };

  const ready = (async () => {
    try {
      await store.update();
      if ((await store.getStatus()).needsEmbedding > 0) await embedElsewhere(vault.root);
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
      await ready;
      await store.close();
    },
  };
}
