/**
 * Resolves a vault's location and configuration.
 *
 * A vault is a directory with `.kb.yaml` at its root. We search upward from cwd —
 * git hooks always run at the repo root, and people run commands from anywhere
 * inside the vault.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type VaultConfig = {
  /** Absolute path to the vault root */
  root: string;
  /** Wiki page directory (default: wiki) */
  pages: string;
  /** qmd collection name. Local to this vault; vaults have separate indexes */
  collection: string;
};

const DEFAULTS = { pages: "wiki", collection: "wiki" };

export class VaultNotFound extends Error {
  constructor(from: string) {
    super(
      `No vault found (searched upward from ${from}).\n` +
        "A vault root needs .kb.yaml. For example:\n\n" +
        "  pages: wiki\n  collection: wiki",
    );
    this.name = "VaultNotFound";
  }
}

export function findVaultRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".kb.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * `.kb.yaml` holds flat `key: value` pairs only. If the schema outgrows these few
 * lines, question whether the need is real before pulling in a YAML parser.
 */
function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-z_]+):\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function loadVault(from?: string): VaultConfig {
  const root = findVaultRoot(from);
  if (!root) throw new VaultNotFound(resolve(from ?? process.cwd()));

  const cfg = { ...DEFAULTS, ...parse(readFileSync(join(root, ".kb.yaml"), "utf8")) };
  return {
    root,
    pages: join(root, cfg.pages),
    collection: cfg.collection,
  };
}
