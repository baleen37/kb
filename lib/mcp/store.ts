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
