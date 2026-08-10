#!/usr/bin/env bun
/**
 * vault 형식 린터.
 *
 *   bun lib/lint.ts            # cwd가 속한 vault를 검사
 *
 * 검사하는 것은 명백히 틀린 것뿐이다 — 페이지 이름, frontmatter, 깨진 링크,
 * Markdown 형식. 모순·낡은 주장·빠진 개념 같은 판단은 사람과 에이전트의 몫이다.
 *
 * 종료 코드: error 있으면 1, 아니면 0
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { loadVault } from "./vault.ts";

const vault = loadVault();
const ROOT = vault.root;
const WIKI = vault.pages;
const MARKDOWNLINT_CONFIG = join(import.meta.dir, "..", "markdownlint.yaml");
const SLUG = "[a-z0-9가-힣]+(?:-[a-z0-9가-힣]+)*";
const PAGE_NAME = new RegExp(`^${SLUG}\\.md$`, "u");

type Finding = { level: "error" | "warn"; file: string; line?: number; msg: string };
const findings: Finding[] = [];

const add = (level: Finding["level"], file: string, msg: string, line?: number) =>
  findings.push({ level, file: relative(ROOT, file), line, msg });

/** 코드블록과 인라인 코드를 뺀 마크다운 링크 */
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
      add("error", file, `.md 확장자 없는 내부 링크 → ${target}`, line);
    } else if (!existsSync(resolve(dirname(file), bare))) {
      add("error", file, `깨진 링크 → ${target}`, line);
    }
  }
}

function checkPageName(file: string) {
  const name = relative(WIKI, file);

  // 날짜 접두사는 사건·조사 페이지의 흔적이다. 페이지는 개념 단위이고 현재를 기술한다.
  if (/^\d{4}-\d{2}-\d{2}-/.test(name)) {
    add("error", file, `날짜 접두사 파일명 → ${name} (페이지는 개념 단위다. 개념 페이지로 합칠 것)`);
    return;
  }

  if (!PAGE_NAME.test(name)) add("error", file, `파일명 형식 오류 → ${name} (slug.md)`);
}

/**
 * 페이지별 마지막 커밋 날짜. 워킹트리가 HEAD와 다른 파일은 제외한다 —
 * 편집 중인 페이지는 커밋일과 어긋나는 게 정상이다.
 */
function lastCommitDates(): Map<string, string> {
  const dates = new Map<string, string>();
  const pagesDir = relative(ROOT, WIKI);

  // quotepath=false가 없으면 git이 한글 경로를 8진 이스케이프로 내보내 경로가 영영 안 맞는다.
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
    add("error", MARKDOWNLINT_CONFIG, "Markdown 형식 설정 없음");
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
        add("error", ROOT, `Markdown 형식: ${line}`);
    }
  } catch (error) {
    add("error", ROOT, `Markdown 형식 검사 실행 실패: ${String(error)}`);
  }
}

// ── 페이지 ────────────────────────────────────────────────────────────────
const pages = existsSync(WIKI)
  ? readdirSync(WIKI, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(WIKI, f))
  : [];

if (!existsSync(WIKI)) add("error", WIKI, `${relative(ROOT, WIKI)}/ 없음`);

const commitDates = lastCommitDates();

for (const page of pages) {
  const text = readFileSync(page, "utf8");
  checkPageName(page);
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!fm) {
    add("error", page, "frontmatter 없음");
  } else {
    const updated = fm[1].match(/^updated:\s*(\S+)/m);
    if (!updated) add("error", page, "frontmatter에 updated 없음");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(updated[1]))
      add("error", page, `updated '${updated[1]}' 형식 오류 (YYYY-MM-DD)`);
    else {
      // 내용은 고쳤는데 날짜를 안 고친 자리. 신선도 신호가 조용히 틀어진다.
      const committed = commitDates.get(relative(ROOT, page));
      if (committed && updated[1] < committed)
        add("warn", page, `updated ${updated[1]} < 마지막 커밋 ${committed} (갱신 누락)`);
    }

    if (!/^tags:/m.test(fm[1])) add("warn", page, "frontmatter에 tags 없음");
  }

  checkLinks(page, text);
}

checkMarkdownFormat();

// ── 출력 ──────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

for (const f of [...errors, ...warns]) {
  console.log(`${f.level === "error" ? "ERROR" : "warn "} ${f.line ? `${f.file}:${f.line}` : f.file}`);
  console.log(`      ${f.msg}`);
}

console.log(findings.length === 0 ? `✓ 통과 (${pages.length}장)` : `\nerror ${errors.length} · warn ${warns.length}`);
process.exit(errors.length > 0 ? 1 : 0);
