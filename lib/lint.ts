#!/usr/bin/env bun
/**
 * Vault format linter.
 *
 *   bun lib/lint.ts            # lints the vault containing cwd
 *
 * Checks only what is mechanically wrong — page names, frontmatter, broken links,
 * Markdown structure. Contradictions, stale claims, and missing concepts are
 * judgment calls left to humans and agents.
 *
 * Exit code: 1 on error, 2 when no vault was found, 0 otherwise.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { loadVault, VaultNotFound } from "./vault.ts";

let vault;
try {
  vault = loadVault();
} catch (error) {
  // A stack trace helps nobody here. Show what to create instead.
  if (error instanceof VaultNotFound) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

const ROOT = vault.root;
const WIKI = vault.pages;
const MARKDOWNLINT_CONFIG = join(import.meta.dir, "..", "markdownlint.yaml");
const SLUG = "[a-z0-9가-힣]+(?:-[a-z0-9가-힣]+)*";
const PAGE_NAME = new RegExp(`^${SLUG}\\.md$`, "u");

type Finding = { level: "error" | "warn"; file: string; line?: number; msg: string };
const findings: Finding[] = [];

const add = (level: Finding["level"], file: string, msg: string, line?: number) =>
  findings.push({ level, file: relative(ROOT, file), line, msg });

/** Markdown links, excluding those inside code blocks and inline code */
function links(text: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) return void (fence = !fence);
    if (fence) return;
    for (const m of raw.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      out.push({ target: m[1], line: i + 1 });
    }
  });
  return out;
}

function checkLinks(file: string, text: string) {
  for (const { target, line } of links(text)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const bare = target.split("#")[0];
    if (!bare) continue;
    if (!bare.endsWith(".md")) {
      add("error", file, `internal link without .md → ${target}`, line);
    } else if (!existsSync(resolve(dirname(file), bare))) {
      add("error", file, `broken link → ${target}`, line);
    }
  }
}

function checkPageName(file: string) {
  const name = relative(WIKI, file);

  // A date prefix is the fingerprint of an incident or investigation page.
  // Pages are concepts and describe the present.
  if (/^\d{4}-\d{2}-\d{2}-/.test(name)) {
    add("error", file, `date-prefixed filename → ${name} (a page is a concept; merge it into one)`);
    return;
  }

  if (!PAGE_NAME.test(name)) add("error", file, `malformed filename → ${name} (expected slug.md)`);
}

/**
 * Last commit date per page. Pages with uncommitted changes are excluded —
 * a page being edited is expected to differ from its last commit.
 */
function lastCommitDates(): Map<string, string> {
  const dates = new Map<string, string>();
  const pagesDir = relative(ROOT, WIKI);

  // Without quotepath=false, git octal-escapes non-ASCII paths and they never match.
  const run = (args: string[]) => {
    const proc = Bun.spawnSync(["git", "-c", "core.quotepath=false", ...args], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0 ? new TextDecoder().decode(proc.stdout) : "";
  };

  const dirty = new Set(
    run(["status", "--porcelain", "--", pagesDir])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, "")),
  );

  let date = "";
  for (const line of run(["log", "--date=short", "--format=%cd", "--name-only", "--", pagesDir]).split(/\r?\n/)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) date = line;
    else if (line.endsWith(".md") && !dates.has(line) && !dirty.has(line)) dates.set(line, date);
  }

  return dates;
}

function markdownFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git") files.push(...markdownFiles(file));
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
      files.push(file);
    }
  }

  return files;
}

function checkMarkdownFormat() {
  if (!existsSync(MARKDOWNLINT_CONFIG)) {
    add("error", MARKDOWNLINT_CONFIG, "missing Markdown format config");
    return;
  }

  const files = markdownFiles(ROOT);
  try {
    const proc = Bun.spawnSync(
      ["markdownlint", "--config", MARKDOWNLINT_CONFIG, "--", ...files],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const decoder = new TextDecoder();
    const output = `${decoder.decode(proc.stdout)}${decoder.decode(proc.stderr)}`;
    if (proc.exitCode !== 0) {
      for (const line of output.split(/\r?\n/).filter(Boolean))
        add("error", ROOT, `Markdown format: ${line}`);
    }
  } catch (error) {
    add("error", ROOT, `Markdown format check failed to run: ${String(error)}`);
  }
}

// ── Pages ─────────────────────────────────────────────────────────────────
const pages = existsSync(WIKI)
  ? readdirSync(WIKI, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(WIKI, f))
  : [];

if (!existsSync(WIKI)) add("error", WIKI, `${relative(ROOT, WIKI)}/ not found`);

const commitDates = lastCommitDates();

for (const page of pages) {
  const text = readFileSync(page, "utf8");
  checkPageName(page);
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!fm) {
    add("error", page, "missing frontmatter");
  } else {
    const updated = fm[1].match(/^updated:\s*(\S+)/m);
    if (!updated) add("error", page, "frontmatter missing updated");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(updated[1]))
      add("error", page, `malformed updated '${updated[1]}' (expected YYYY-MM-DD)`);
    else {
      // Content moved but the date did not. The freshness signal is silently wrong.
      const committed = commitDates.get(relative(ROOT, page));
      if (committed && updated[1] < committed)
        add("warn", page, `updated ${updated[1]} < last commit ${committed} (not bumped)`);
    }

    if (!/^tags:/m.test(fm[1])) add("warn", page, "frontmatter missing tags");
  }

  checkLinks(page, text);
}

checkMarkdownFormat();

// ── Output ────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

for (const f of [...errors, ...warns]) {
  console.log(`${f.level === "error" ? "ERROR" : "warn "} ${f.line ? `${f.file}:${f.line}` : f.file}`);
  console.log(`      ${f.msg}`);
}

console.log(findings.length === 0 ? `✓ ok (${pages.length} pages)` : `\nerror ${errors.length} · warn ${warns.length}`);
process.exit(errors.length > 0 ? 1 : 0);
