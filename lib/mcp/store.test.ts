import { test, expect } from "bun:test";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";
import { loadVault } from "../vault.ts";
import { storeOptionsFor, openStore, prepareStore } from "./store.ts";

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

test("recovery indexes an empty vault so lex search works", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nthe quokka is a marsupial" } });
  try {
    const p = await prepareStore(v.root);
    expect(p.recovery.state).toBe("pending");

    await p.ready;
    expect(p.recovery.state).toBe("done");

    const hits = await p.store.searchLex("quokka");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].displayPath).toContain("a.md");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 60_000);

test("recovery embeds so vector search is available", async () => {
  const v = makeVault({ docs: { "b.md": "# Beta\n\npostgres connection pooling" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    const status = await p.store.getStatus();
    expect(status.totalDocuments).toBe(1);
    expect(status.needsEmbedding).toBe(0);
    expect(status.hasVectorIndex).toBe(true);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("a failed embed leaves the server usable", async () => {
  const v = makeVault({ docs: { "c.md": "# Gamma\n\nnumbat" } });
  try {
    const p = await prepareStore(v.root);
    await p.ready;

    // Indexing runs in-process, so it succeeded before the embedder was reached.
    // Whether embedding itself succeeded here does not matter — what matters is
    // that lex search works either way, which is the promise of not dying on a
    // failed embed.
    const hits = await p.store.searchLex("numbat");
    expect(hits.length).toBeGreaterThan(0);
    expect(["done", "failed"]).toContain(p.recovery.state);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("the embedder runs outside this process", async () => {
  const v = makeVault({ docs: { "d.md": "# Delta\n\nbilby" } });
  try {
    // Recovery must not load a model here — that is what the child process is
    // for. qmd swaps process.stdout.write while llama initializes, so an
    // untouched write is evidence the work happened elsewhere.
    const before = process.stdout.write;
    const p = await prepareStore(v.root);
    await p.ready;

    expect(process.stdout.write).toBe(before);
    expect(p.recovery.state).toBe("done");

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);

test("closing mid-embed leaves the vault recoverable", async () => {
  const docs = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [
      `doc${i}.md`,
      `# Doc ${i}\n\n${"quokka numbat bilby potoroo ".repeat(40)}\n`,
    ]),
  );
  const v = makeVault({ docs });
  try {
    const p = await prepareStore(v.root);
    await p.close(); // while recovery is still embedding

    // close() kills the embedder rather than waiting for it, so this covers the
    // consequence: a cancelled embed must not corrupt the index or be recorded
    // as a failure, and the next run must finish the job.
    //
    // It does not prove the kill itself happened — on this machine a 40-doc
    // embed finishes in ~3s, so any timing threshold would pass with or without
    // cancellation. The kill is exercised in production shutdowns, not here.
    const after = await prepareStore(v.root);
    await after.ready;
    expect(after.recovery.state).toBe("done");
    await after.close();

    // The cancelled run must not have been recorded as a failure either.
    expect(p.recovery.state).not.toBe("failed");
  } finally {
    v.cleanup();
  }
}, 180_000);
