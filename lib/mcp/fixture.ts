/**
 * Throwaway vaults for tests. Each one is a real directory with .kb.yaml,
 * so tests exercise the same loadVault path production uses.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Fixture = { root: string; cleanup: () => void };

export function makeVault(
  opts: { pages?: string; collection?: string; docs?: Record<string, string> } = {},
): Fixture {
  const pages = opts.pages ?? "wiki";
  const collection = opts.collection ?? "wiki";
  const root = mkdtempSync(join(tmpdir(), "kb-vault-"));

  writeFileSync(
    join(root, ".kb.yaml"),
    `pages: ${pages}\nsources: raw\ncollection: ${collection}\n`,
  );
  mkdirSync(join(root, pages), { recursive: true });

  for (const [name, body] of Object.entries(opts.docs ?? {})) {
    writeFileSync(join(root, pages, name), body);
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
