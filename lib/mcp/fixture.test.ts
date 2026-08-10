import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";
import { loadVault } from "../vault.ts";

test("makeVault creates a vault loadVault can read", () => {
  const v = makeVault({ docs: { "a.md": "# A\n\nalpha content" } });
  try {
    expect(existsSync(join(v.root, ".kb.yaml"))).toBe(true);
    expect(readFileSync(join(v.root, "wiki", "a.md"), "utf8")).toContain("alpha");

    const cfg = loadVault(v.root);
    expect(cfg.root).toBe(v.root);
    expect(cfg.collection).toBe("wiki");
    // loadVault already absolutizes pages — it must not be joined again
    expect(cfg.pages).toBe(join(v.root, "wiki"));
  } finally {
    v.cleanup();
  }
});

test("makeVault honors custom pages and collection", () => {
  const v = makeVault({ pages: "notes", collection: "kb-notes", docs: { "b.md": "# B" } });
  try {
    const cfg = loadVault(v.root);
    expect(cfg.collection).toBe("kb-notes");
    expect(cfg.pages).toBe(join(v.root, "notes"));
  } finally {
    v.cleanup();
  }
});

test("cleanup removes the vault", () => {
  const v = makeVault();
  const root = v.root;
  v.cleanup();
  expect(existsSync(root)).toBe(false);
});
