import { test, expect } from "bun:test";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";
import { loadVault } from "../vault.ts";
import { storeOptionsFor, openStore } from "./store.ts";

test("storeOptionsFor puts the index inside the vault", () => {
  const v = makeVault();
  try {
    const opts = storeOptionsFor(loadVault(v.root));
    expect(opts.dbPath).toBe(join(v.root, ".qmd", "index.sqlite"));
  } finally {
    v.cleanup();
  }
});

test("storeOptionsFor names the collection from .kb.yaml and pins the pattern", () => {
  const v = makeVault({ pages: "notes", collection: "kb-notes" });
  try {
    const opts = storeOptionsFor(loadVault(v.root));
    expect(Object.keys(opts.config.collections)).toEqual(["kb-notes"]);
    expect(opts.config.collections["kb-notes"]).toEqual({
      path: join(v.root, "notes"),
      pattern: "**/*.md",
    });
  } finally {
    v.cleanup();
  }
});

test("storeOptionsFor never yields a configPath", () => {
  const v = makeVault();
  try {
    // A configPath would send qmd looking for global config. It must not exist.
    expect("configPath" in storeOptionsFor(loadVault(v.root))).toBe(false);
  } finally {
    v.cleanup();
  }
});

test("openStore fails loudly when there is no vault", async () => {
  await expect(openStore("/")).rejects.toThrow(/No vault found/);
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

test("a polluted global config does not leak into the vault", async () => {
  // Point qmd's global config at a directory full of documents that must never
  // show up. This is the failure the whole design exists to prevent.
  const stranger = mkdtempSync(join(tmpdir(), "kb-stranger-"));
  mkdirSync(join(stranger, "docs"), { recursive: true });
  writeFileSync(join(stranger, "docs", "secret.md"), "# Secret\n\nzzyzx marker");

  const home = mkdtempSync(join(tmpdir(), "kb-home-"));
  mkdirSync(join(home, ".config", "qmd"), { recursive: true });
  writeFileSync(
    join(home, ".config", "qmd", "index.yml"),
    `collections:\n  stranger:\n    path: ${join(stranger, "docs")}\n    pattern: "**/*.md"\n`,
  );

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");

  const v = makeVault({ docs: { "own.md": "# Own\n\nqwyjibo marker" } });
  try {
    const { store } = await openStore(v.root);
    await store.update();

    const names = (await store.listCollections()).map((c) => c.name);
    expect(names).toEqual(["wiki"]);
    expect(names).not.toContain("stranger");

    const hits = await store.searchLex("zzyzx");
    expect(hits).toHaveLength(0);

    await store.close();
  } finally {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    v.cleanup();
  }
});
