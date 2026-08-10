---
name: ingest
description: Use when adding a source to a kb vault — a ticket, chat thread, code survey, doc, or live query result that should become durable team knowledge. Trigger on "ingest this", "add this to the wiki", "record this in the vault", or after an investigation whose findings would otherwise evaporate. Preserves the source under raw/, then updates the concept pages it touches.
---

# Ingest a source into a kb vault

Read the vault's own `AGENTS.md` for what is specific to it, and `MEMORY.md` for mistakes
not to repeat.

## The one rule that decides everything

**Do not write a page for the source itself.** No summary page, no ticket page, no
incident page. Decide which *concepts* the source touches and update those pages.

A source that resists this usually touches several concepts — split it across them.
One source touching 5–15 pages is normal. Creating one page named after the source is
the failure this vault is built to prevent: concepts saturate with the domain, sources
never do.

Add a page only when the source reveals a concept that has none.

## Steps

1. **Read the source.** All of it.

2. **Preserve it under `raw/`** if it is not already there. Record the original URL and
   the retrieval date at the top. Existing files are immutable — never edit or delete
   one. Live results (a query against a ticket system, a job API, a table) must be
   snapshotted here before any wiki claim can rest on them.

3. **Discuss the key content with the human before writing wiki pages.** This is not
   optional politeness — it is where scope errors get caught cheaply.

4. **Find the affected pages.** Search the vault for the concepts involved, and follow
   links from what you find. A concept you cannot find may still have a page under a
   name you did not guess.

5. **Update those pages**, linking `../raw/filename.md` as evidence. Set `updated` to
   today on every page you touch — a page whose content moved but whose date did not is
   a silent lie about freshness, and it is the most common mistake in this workflow.

6. **Check whether the source makes an existing claim stale.** Correct it in place
   rather than adding a contradicting sentence elsewhere. Two pages disagreeing is worse
   than either being wrong alone, because now the reader must adjudicate.

7. **Verify with lint** — run `kb:lint`, or `bun ${CLAUDE_PLUGIN_ROOT}/lib/lint.ts` from
   inside the vault.

## Vault format

Two layers, no third. `raw/` is what happened at a point in time and is append-only.
`wiki/` is how things stand now, and agents own it entirely. Do not add an intermediate
layer of incident, ticket, or investigation pages — git history and `raw/` hold that
record already. Directory names come from `.kb.yaml`; the defaults are `wiki` and `raw`.

`wiki/` is **flat**. Pages are found by links and search, not by folders.

**A page is a concept** — a field, a mechanism, a policy, a boundary. Something a
teammate would name when asking a question. It answers two things: how this is actually
implemented, and what to check. It is not a code mirror or an investigation log.

Filenames are `slug.md`, lowercase Latin letters, digits, Hangul, and hyphens. No date
prefix. One H1 right after the frontmatter, matching the filename.

Frontmatter has exactly two fields:

```yaml
---
updated: YYYY-MM-DD
tags: [search, ranking]
---
```

Body rules:

- Cross-reference with Markdown links including `.md` — `[BM25](bm25.md)`,
  `[source](../raw/filename.md)`.
- End factual statements with their evidence link. Evidence goes in the body, never in
  frontmatter.
- A citation must be reachable without your local machine. No `/Users/...`, no temporary
  tool output. Prefer a URL pinned to a commit; otherwise snapshot under `raw/` and cite
  the snapshot.
- When sources disagree, keep both and mark them with a `> ⚠️ Conflict:` block.
- Never write anything absent from the source. Make unknowns and assumptions explicit.
- State a fact on one page. Everywhere else, link to it.
- Name files and symbols, not line numbers. Do not paste source code unless the literal
  form *is* the fact — a constant list, a mapping table, a schema.

## What survives, what rots

Before each sentence: **when this goes wrong, who tells us?**

- A filename or symbol → one grep disproves it. Write it.
- A reason for a decision → cannot rot. Write it.
- A bare claim about present state → no alarm, stays wrong silently. Turn it into one
  of the above.

So prefer the sentence that survives the next deploy: not "the filter is on", but "the
gold-level filter was rejected because `upd%` was 100 — to restore it, refute that".

Point-in-time measurements stay in `raw/`. Keep only the figure that changes a
present-day judgment, with the symbol it came from in the same sentence. Do not
inventory what the reader can count — name the place to count instead.

Sources from discussion threads (chat, tickets) rot faster than sources from code
surveys. Threads are full of point-in-time measurements and in-progress status, and
those pass through into pages unless you filter them deliberately.

## Pace

The default is **one source at a time**, with the human intervening along the way.
Batch processing requires an explicit request.

When a mistake here would otherwise repeat, add it to the vault's `MEMORY.md` — a
one-line link in the index, the detail in a topic file under `memory/`. `MEMORY.md` is
an index only, one line per entry, under 200 lines; detail lives in `memory/`. Domain
knowledge belongs in `wiki/`, not there.
