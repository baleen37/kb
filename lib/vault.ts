/**
 * vault 위치와 설정을 푼다.
 *
 * vault는 `.kb.yaml`을 루트에 둔 디렉터리다. cwd에서 위로 올라가며 찾는다 —
 * git 훅은 항상 레포 루트에서 돌고, 사람은 vault 안 어디서든 명령을 친다.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type VaultConfig = {
  /** vault 루트 절대경로 */
  root: string;
  /** 위키 페이지 디렉터리 (기본 wiki) */
  pages: string;
  /** 원본 스냅샷 디렉터리 (기본 raw) */
  sources: string;
  /** qmd collection 이름. vault 안에서만 유효한 로컬 이름이다 */
  collection: string;
};

const DEFAULTS = { pages: "wiki", sources: "raw", collection: "wiki" };

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
 * `.kb.yaml`은 평평한 `key: value`만 쓴다. 스키마가 이 네 줄을 넘어가면
 * YAML 파서를 들이는 대신 그 필요가 진짜인지 먼저 의심한다.
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
  if (!root) {
    throw new Error(
      "vault를 찾지 못했다. vault 루트에 .kb.yaml이 있어야 한다.\n" +
        "  새로 만들려면: kb init",
    );
  }

  const cfg = { ...DEFAULTS, ...parse(readFileSync(join(root, ".kb.yaml"), "utf8")) };
  return {
    root,
    pages: join(root, cfg.pages),
    sources: join(root, cfg.sources),
    collection: cfg.collection,
  };
}
