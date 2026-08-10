/**
 * Turns a vault's .kb.yaml into a qmd store.
 *
 * Isolation is the whole point. We pass dbPath and an inline collection config,
 * so qmd never consults its global config (~/.config/qmd/index.yml). A vault
 * cannot reach another vault's index because there is no path by which to do so.
 */

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
 * Open a vault's store and bring it to a searchable state.
 *
 * Recovery runs in the background: embedding takes seconds, and blocking the MCP
 * handshake that long risks a client timeout. Tool handlers await `ready`.
 *
 * A failure here does not kill the server. Lex search still works when only
 * embedding failed, and a partly working server beats a dead one.
 */
export async function prepareStore(from?: string): Promise<Prepared> {
  const { store, vault } = await openStore(from);
  const recovery: Recovery = { state: "pending" };

  const ready = (async () => {
    try {
      await store.update();
      if ((await store.getStatus()).needsEmbedding > 0) await store.embed();
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
