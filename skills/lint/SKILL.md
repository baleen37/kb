---
name: lint
description: Use when checking a kb vault's health — after an ingest, before a commit, or when the user asks to lint, review, or audit the wiki. Runs the format checker and, when asked for editorial review, reports contradictions, stale claims, orphan pages, and duplicated facts that machines cannot catch.
---

# Lint a kb vault

There are **two kinds of lint. Neither substitutes for the other.**

## Format check

```bash
bun ${CLAUDE_PLUGIN_ROOT}/lib/lint.ts    # run from inside the vault
```

Catches only the mechanically wrong. Run it after an ingest and before a commit.
Raw snapshots are checked but never rewritten.

| error (exit 1) | warn |
|---|---|
| Missing frontmatter; missing or malformed `updated` | Missing `tags` |
| Broken links; internal links without the `.md` extension | `updated` earlier than the file's last commit date |
| Filename not `slug.md`; date-prefixed filenames | |
| Markdown structural rules | |

The `updated` warning means content moved but the date did not — the freshness signal
is silently wrong. It is a warning rather than an error on purpose: blocking commits
mid-ingest teaches people to reach for `--no-verify`, which disables every check at once.
Pages with uncommitted changes are excluded, since a page being edited is expected to
differ from its last commit.

A `pre-commit` hook can run this automatically. Hooks are not cloned, so enable it once
per clone: `git config core.hooksPath hooks`. It checks the **working tree**, not the
staged snapshot, and warns when the two differ.

The hook reads `KB_PLUGIN_DIR` to find the plugin. When it is unset, or the linter is not
there, the hook skips rather than blocking the commit.

## Editorial review

When a human asks to lint, read and judge what machines cannot. **Report first, do not fix.**

- Contradictions between pages
- Claims made stale by a newer source
- Orphan pages with no inbound links
- Concepts mentioned across pages but lacking a page of their own
- Missing cross-references
- Fragments of one concept spread across pages that only make sense read together
- Line numbers, pasted source code, or point-in-time measurements that belong in `raw/`
- A fact stated on more than one page, where the copies can drift apart

Report findings and let the human decide. Applying a batch of "obvious" fixes across
many pages is how sentences get broken — a regex that strips line numbers also strips
the ones inside quoted text. When you do fix in bulk, grep afterward to confirm the
count you claim, rather than asserting it from the edit you intended.

## Refreshing search

After pages change, the index is stale until refreshed:

```bash
qmd update && qmd embed
```
