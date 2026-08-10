# kb vault schema

Operating rules for agents maintaining a kb vault. This document is the portable half
of the [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) —
it holds what is true of every vault. What is specific to one vault (its sources, its
language, its domain) lives in that vault's own `AGENTS.md`.

## Core idea

A vault is a persistent, compounding artifact. Each source should make the shared
knowledge more useful by updating the concepts it affects, connecting related pages,
and making contradictions or uncertainty visible. The agent maintains the synthesis;
it does not merely rediscover the same facts at query time.

Humans curate and provide sources, choose what to investigate, and guide emphasis.
Agents read the sources, maintain the wiki, preserve evidence, and keep the structure
consistent. This division of work is a workflow boundary, not permission to invent
facts or silently change the schema.

## Layers

| Layer | Path | Who writes |
|---|---|---|
| Raw sources | `raw/` | Humans and agents may add new immutable snapshots; agents may not modify or delete existing files |
| Wiki | `wiki/` | Owned entirely by agents |
| Schema | vault `AGENTS.md` | Humans own it. Agents propose changes but do not edit it unasked |
| Operating memory | `MEMORY.md` | Owned entirely by agents. Updated while working |

Directory names come from `.kb.yaml` (`pages`, `sources`); the defaults are `wiki` and `raw`.

Existing files under `raw/` are immutable. Agents may create new files there when
preserving source material or dated snapshots, but must never modify or delete existing
files. The source is the truth of record.

The vault's `AGENTS.md` holds premises that rarely change. `MEMORY.md` holds what the
agent learns while operating — mistakes worth not repeating, things to check, internal
policy that shifted.

## Operating philosophy

A page answers two questions:

1. **How is this actually implemented?** — the real behavior, including where it
   differs from what the name or the ticket suggests
2. **What do I check?** — the index, table, key, job, or file to look at

It is not a code mirror, an investigation log, or an incident archive. Anything the
reader can get by grepping in five minutes does not belong here. What belongs here is
understanding that takes reading several files to assemble.

**Two layers, no third.** `raw/` is what happened at a point in time. `wiki/` is how
things stand now. Do not add an intermediate layer of incident, ticket, or
investigation pages — git history and `raw/` already hold the record.

**Write what will not need re-verifying.** The wiki does not race the code for the
current state — the code always wins that race, and a page that claims to track it
just goes stale without telling anyone. Prefer the sentence that survives the next
deploy: not "the filter is on", but "the gold-level filter was rejected because
`upd%` was 100 — to restore it, refute that".

The test before you write a line: **when this goes wrong, who tells us?** A filename
or symbol is cheap to disprove — one grep. A reason for a decision cannot rot. A
bare assertion about present state has no such signal, so it stays wrong silently.
Write the first two; turn the third into one of them.

Keep the contract small and enforceable:

- `raw/` is append-only source material.
- Every factual claim in `wiki/` needs an inline evidence link.
- Unknowns, assumptions, and source conflicts must be explicit. Never fill gaps by invention.
- Mechanical lint checks format and links. Editorial review checks contradictions,
  stale claims, and missing connections.

Prefer the smallest system that works. Do not add page types, universal templates,
embeddings, services, or directory taxonomies without a demonstrated need. Ingest one
source at a time and update only the pages affected by that source.

## Pages

The default structure under `wiki/` is **flat**. Find pages by links and search. Do not
sort pages into folders by topic or page type.

**A page is a concept.** A field, a mechanism, a policy, a boundary — something a
teammate would name when asking a question. Not a source, a ticket, an incident, or
an investigation.

This is what bounds the page count. Concepts saturate with the domain; incidents do
not. When a new source arrives, the default action is to **update the concept pages it
touches**, not to add a page. Add a page only when the source reveals a concept that
has none.

One symptom that this rule is being broken: several pages that only make sense read
together, cross-linking each other, each holding a fragment of one concept. Merge them.

Filename rules:

- Pages use `slug.md`. No date prefix — a page describes the present, not a date.
- Slugs contain only lowercase Latin letters, digits, Hangul, and hyphens.

Title rules:

- Every page has exactly one H1 immediately after the frontmatter.
- The H1 is a readable title matching the filename. Do not label it with a type
  such as `source`, `entity`, or `concept`, and do not put a date in it.
- Preserve the original spelling of technical identifiers and wrap them in inline code.

Consider folders only when an operational problem recurs: agents repeatedly misplace
pages, filename collisions recur, topics have genuinely different owners or update
cadences, or retrieval quality degrades. Define the problem and success criteria
before introducing them.

## Page format

Every page starts with YAML frontmatter. There are only two fields.

```yaml
---
updated: YYYY-MM-DD
tags: [search, ranking]
---
```

Body rules:

- Cross-reference pages with standard Markdown links, including the `.md` extension
  - page → page: `[BM25](bm25.md)`
  - page → raw source: `[source](../raw/filename.md)`
- End factual statements with their evidence: `... is true ([code survey](../raw/2026-08-05-code-survey.md))`
- **Evidence goes in body links only.** Do not record sources in the frontmatter.
- Every source reference must be a reproducible **citation** that the intended reader
  can access without the agent's local machine. Do not use `/Users/...`, worktree paths,
  temporary tool output, or a mutable branch URL as the only evidence.
  - For public or repository sources, prefer a canonical URL pinned to a commit or release.
  - For internal, access-restricted, or live sources, preserve an immutable snapshot
    under `raw/`, record the original URL and retrieval date there, and cite the snapshot.
  - A local path may be mentioned as a code locator, but it is not a sufficient citation.
- When sources disagree, do not delete either one. **Keep both** and mark them with a
  `> ⚠️ Conflict:` block.
- Never mix speculation with fact. Do not write anything absent from the source.

Write for the reader, not for the record:

- **Name files, not line numbers.** Line numbers go stale on the next commit and the
  reader greps anyway. Point at a symbol when the file is large.
- **Do not paste source code.** State the conclusion as a sentence or a table. The
  exception is when the literal form *is* the fact — a constant list, a mapping table,
  a schema.
- **State a fact on one page.** Everywhere else, link to it. A number, a table, or a
  caveat repeated across pages will drift out of sync.
- **Point-in-time measurements stay in `raw/`.** Keep only the figure that changes a
  present-day judgment.
- **Do not inventory what you can count.** Totals and exhaustive lists go stale on any
  commit and give no signal when they do. Name the place to count instead. Keep a count
  only when the count *is* the fact, or when a change to it changes a judgment.
- **A number that survives must be falsifiable.** Keep the symbol or file it comes from
  in the same sentence, so the next reader can disprove it in one grep.
- **Explain why it is shaped this way, in the body.** When the current implementation
  makes no sense from the code alone, say what drove it in a sentence or two where the
  thing is described, with a `raw/` link. No separate history or changelog section.
- **No retrospective sections.** If a lesson generalizes, it is a rule for `MEMORY.md`,
  not page content.
- **Record what to check when you know it.** Index name, table, key, job name, file.
  Do not invent a verification path you have not confirmed.
- **Collect the unresolved, sparingly.** Open questions go in one place near the end.
  When something resolves, delete the line and promote the fact into the body. Do **not**
  park questions whose answer is a measurement the next deploy changes — nobody comes
  back to answer them, and they turn the page into the investigation log this is not.
- **Do not restate links.** A closing related-pages list is for pages the body never
  linked.

## Operating memory

`MEMORY.md` is the agent's own working memory. Agents own it and update it while
working, without being asked.

Before starting any task, read `MEMORY.md` first. When a relevant topic is listed,
read its detailed file under `memory/` before proceeding.

Write an entry when something is worth carrying into the next session: a mistake that
would otherwise repeat, something easy to miss, internal policy that shifted, a
recurring judgment call and how it was settled.

Do not put domain knowledge here — that belongs in `wiki/`. Do not keep a chronological
log of what was done; git already has it.

### Structure — index plus topic files

`MEMORY.md` is an **index only**, not a container for memory content.

```text
MEMORY.md          # index — one line per entry
memory/
├── topic.md       # detail, appended over time
└── ...
```

**`MEMORY.md` has a hard budget: 200 lines or 25KB, whichever comes first.** Content past
that threshold is silently dropped when the file loads — an entry below the cutoff does
not exist as far as the next session is concerned.

Therefore:

- **One link per entry.** A note, rule, or multi-paragraph entry belongs in a topic file.
- Point at topic files as `- [Title](memory/file.md)`.
- Delete an entry once it stops being true. A stale memory is worse than none.
- Merge entries that say the same thing.

Topic files under `memory/` are **not** loaded at session start. Read them on demand.

Check the budget after editing: `wc -l MEMORY.md` (under 200), `wc -c MEMORY.md` (under 25600).

## Isolation between vaults

Vaults are separate repositories with separate search indexes, so a question in one
cannot pull an answer from another. That guarantee rests on one setup step: **run
`qmd init` in the vault root before registering any collection.**

qmd's configuration is global by default (`~/.config/qmd/index.yml`, index under
`~/.cache/qmd/`). A vault-local `.qmd/` overrides it, but only once it exists. Register
a collection first and it goes into the global config, where the vault will also see
every other vault's collections — silently, with no error. Verify with
`qmd collection list` from inside the vault: it should list exactly what this vault
declares and nothing else.

Point a working repo at a vault by giving the MCP server that vault as its `cwd`. One
server per vault: the server can only reach the index it was started in, so a wrong
collection name cannot leak another vault's contents.

## Source lifecycle

- `live` is a current query against a ticket system, chat, docs, jobs, tables, or
  services. It is a collection method, not durable evidence.
- `raw/` contains immutable source material and dated snapshots. If a live result will
  become a durable wiki claim, preserve a snapshot under `raw/` first.
- `wiki/` contains the agent-maintained synthesis. It must link back to the supporting
  raw source or canonical URL.

For a live-only answer, include the observation time. Never overwrite an existing raw
snapshot with a newer live result; add a new snapshot when historical reproducibility
matters.

Record the source URL and the retrieval date at the top of each `raw/` file.

## Commits

A vault is an ordinary git repository. Write commit messages as `ingest: title` /
`lint: summary` / `query: question`. Commit only when a human asks.
