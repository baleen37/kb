# kb

A Claude Code / Codex plugin that gives agents a searchable knowledge vault. This repo is
the portable half — schema, skills, linter, MCP server. It holds no vault content.

The rules vaults follow live in `skills/ingest/SKILL.md`, not in a separate schema
document. They ship to vaults as part of the skill, so an agent maintaining one reads a
single file. Change them there when changing what vaults must do.

## Layout

```text
lib/vault.ts       # .kb.yaml resolution — searches upward from cwd
lib/lint.ts        # vault format checker
lib/mcp/           # the MCP server; start.sh launches it
skills/            # ingest, query, lint
hooks/pre-commit   # optional, installed per vault
```

## Never hardcode where the plugin lives

`hooks/pre-commit` runs under `git commit`, not under an agent, so `${CLAUDE_PLUGIN_ROOT}`
is not in its environment — hosts only substitute that in commands they launch themselves.
The marketplace install is versioned and moves on every release, so there is no path worth
guessing either.

`KB_PLUGIN_DIR` supplies it, and the hook skips rather than blocking a commit when it is
unset. Nothing host-specific, nothing to discover.

The tempting alternative is to have the plugin record its own root at `SessionStart` — into
`${CLAUDE_PLUGIN_DATA}`, which both hosts keep stable across updates — and have the hook
read that file back. It does work, on Codex too, but it buys automatic setup at the price
of a linter that depends on a session having run first, spread across three coupled files,
silently doing nothing when it has not. One variable the caller sets beats a path the hook
infers.

## Working here

TypeScript run directly by bun. No build step, no transpile — `.ts` imports keep their
`.ts` extension because bun resolves them as written.

```sh
bun run test                  # sets GGML_METAL_NO_RESIDENCY=1 — use this, not bare `bun test`
bun lib/lint.ts               # resolves the vault from cwd, so run it inside one
```

On macOS, libggml-metal aborts in a static destructor once embedding has run
(ggml-org/llama.cpp#22593), which poisons the exit code of an otherwise green run.
`GGML_METAL_NO_RESIDENCY=1` suppresses it, and libc reads it at module load, so it has to
be in the environment before the process starts. `lib/mcp/start.sh` exports it for the
same reason.

Store and server tests build a real vault, index it, and embed. They take tens of
seconds and carry explicit `120_000` timeouts. Do not shrink those to make a run feel
faster.

## Do not add a collection filter back

`query` has no `collections` parameter. A vault holds exactly one collection —
`storeOptionsFor` builds the map with a single key — so the filter had two reachable
outcomes: the vault's own name, identical to omitting it, or any other string, which
silently returned zero results. It could only break a search.

Its presence also created the plural/singular trap this repo used to warn about: MCP
drops unknown parameters silently, so a caller writing `collection` lost the filter with
no error. Removing the parameter removes the trap. `handleQuery` names the vault's
collection itself, and a test in `tools.test.ts` asserts what qmd was asked for — keep
that one; asserting the schema lacks the field would not catch an unscoped search.

## The stdout trap

**qmd owns `process.stdout`.** qmd swaps `process.stdout.write` for one writing to
stderr on every llama model load, to keep native noise out of JSON streams. We speak
JSON-RPC over that same stdout. `server.ts` hands the transport its own
`createWriteStream("", { fd: 1 })` so the swap cannot reach us. Do not route server
output through `process.stdout`, and do not try to pin the property — qmd's assignment
then throws and search returns nothing.

Anything that loads a model belongs off this process or behind that separate handle.
Embedding runs in `lib/mcp/embed.ts` as a child, for responsiveness; indexing stays
in-process at ~20ms, and only the parent indexes — two processes on one SQLite file
would collide, and qmd sets no `busy_timeout`.

## Isolation is the point

Vaults must not see each other's indexes. `store.ts` passes `dbPath` and an inline
collection config, so qmd never reads its global config at `~/.config/qmd/index.yml`.
Keep it that way: no `qmd init`, no collection registration, nothing that reaches a
shared config. The isolation is structural, not a filter the agent has to remember.

## Failure posture

A failed recovery does not kill the server. Lex search works without vectors, and a
partly working server beats a dead one — `prepareStore` records the failure in
`recovery` and lets handlers proceed. Shutdown cancels an embed in flight rather than
waiting minutes for it.

## Conventions

Comments explain why, not what — most of them record something that cost time to find,
or a fix that looked right and was not. When you learn one of those, leave it where the
next reader will hit the same wall.

Commit messages: conventional prefix, then prose explaining what was wrong and how the
fix addresses it. Say what the old behavior was, why it was broken, and what a test now
catches. Tests that could not have caught the bug are worth naming as such.

The version in `package.json` and `.claude-plugin/plugin.json` is set by
semantic-release. Do not bump it by hand.
