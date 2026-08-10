# mcp-tool-surface: the server offers three tools and scopes every search to its own vault

**What this covers**: the MCP server's live JSON-RPC surface as a host actually
drives it — `lib/mcp/start.sh` over stdio, not `bun server.ts` and not the test
harness. Exercises the two simplification commits squashed into `de95479`:

- `multi_get` removed, so `tools/list` must publish exactly `get`/`query`/`status`.
- `collections` removed from `query`'s input schema, with scoping moved into
  `handleQuery`. A vault holds one collection, so a filter could only ever
  return everything or nothing.

If someone re-adds a tool without a caller, re-exposes a collection filter, or
breaks the stdout handle that keeps qmd's `process.stdout` swap away from our
JSON-RPC stream, this card should catch it.

Unit tests cover these too. This card exists because they mock or bypass the
three things most likely to break in the assembled server: the launcher script,
the real embedder loading a model, and JSON-RPC framing over a live pipe.

## Pre-state

- Repo at the commit under test, clean tree.
- `bun` on PATH.
- A vault the test creates itself in a scratch dir — never point this at a real
  vault, since the server writes an index into `<vault>/.qmd/`.

```sh
cd /Users/jito.hello/dev/wooto/kb
git status --short          # must be empty
bun --version
```

Uses the **real** `embed.ts`, not `KB_EMBED_SCRIPT=embed.stub.ts`. The stub is a
unit-test seam; substituting it here would leave the shipped embedding path
unproven. Cost: model load, tens of seconds on first run.

## Steps

1. **Build a throwaway vault** with a known searchable term.

   ```sh
   D=$(mktemp -d)/vault && mkdir -p "$D/wiki"
   printf 'pages: wiki\ncollection: kb-scenario\n' > "$D/.kb.yaml"
   printf -- '---\nupdated: 2026-08-10\ntags: [ranking]\n---\n\n# BM25\n\nBM25 ranks documents by term frequency.\n' > "$D/wiki/bm25.md"
   ```

   `collection:` is deliberately **not** the `wiki` default — a scoping bug that
   hardcodes `"wiki"` would still pass against the default name.

2. **Launch via the real launcher**, from inside the vault, feeding a JSON-RPC
   session on stdin and capturing stdout.

   ```sh
   cd "$D" && printf '%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"scenario","version":"1"}}}' \
     '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
     '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{}}}' \
     '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"query","arguments":{"searches":[{"type":"lex","query":"BM25"}],"rerank":false}}}' \
     '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"query","arguments":{"searches":[{"type":"lex","query":"BM25"}],"rerank":false,"collections":["kb-scenario"]}}}' \
     '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"multi_get","arguments":{"pattern":"*.md"}}}' \
     | /Users/jito.hello/dev/wooto/kb/lib/mcp/start.sh > /tmp/kb-scenario-out.jsonl 2>/tmp/kb-scenario-err.log
   ```

3. **Read the tool list** from the `id:2` reply.

4. **Read `status`** (`id:3`) for the collection name and document count.

5. **Run a plain `lex` query** (`id:4`) with no filter.

6. **Send `query` with a `collections` argument** (`id:5`) — a removed parameter.

7. **Call the removed `multi_get` tool** (`id:6`).

8. **Cross-check against the authoritative record**: the SQLite index the server
   built on disk, since the JSON reply is the thing under test and cannot vouch
   for itself.

   ```sh
   ls "$D/.qmd/index.sqlite"
   ```

## Expected

| step | expect | falsification |
|---|---|---|
| 2 | Every line of stdout parses as JSON. | Any non-JSON line means qmd's `process.stdout` swap reached our transport — the bug `server.ts` guards with its own fd-1 handle. Fail. |
| 3 | `tools/list` names sort to exactly `["get","query","status"]`. | `multi_get` present → the removal regressed. Any 4th tool → surface grew without a caller. Fail. |
| 3 | `query`'s `inputSchema.properties` has no `collections` and no `collection`. | Either key present → the filter is back. Fail. |
| 4 | `status` reports collection `kb-scenario`, `totalDocuments: 1`. | A different collection name means `.kb.yaml` was ignored. `0` documents means indexing silently did nothing. Fail. |
| 5 | `query` returns ≥1 result whose path is `bm25.md`. | `0` results → search is broken, or scoping named a collection that does not exist. Fail. |
| 6 | Same result count as step 5. MCP drops the unknown `collections` key, so it is inert. | Fewer results (esp. `0`) → an unknown parameter still reaches qmd and filters. Fail. Never an error either; MCP drops silently by design. |
| 7 | JSON-RPC error, or `isError`, naming an unknown tool. | A successful document dump → `multi_get` is still registered. Fail. |
| 8 | `.qmd/index.sqlite` exists inside the vault. | Missing → the server indexed somewhere else, breaking vault isolation. Fail. |

Silence is not success: an empty `/tmp/kb-scenario-out.jsonl` is a failure, not a
pass, and every assertion below is checked explicitly rather than by absence of
error.

## Cleanup

```sh
rm -rf "$(dirname "$D")" /tmp/kb-scenario-out.jsonl /tmp/kb-scenario-err.log
```

Idempotent. Touches only the scratch dir the card created; no real vault, no
`~/.config/qmd`, no `~/.cache/qmd`.

## Sharp edges

- **The server never exits on its own.** It serves stdio forever. Piping a fixed
  set of lines gives it EOF on stdin, which is what ends the run — do not expect
  a self-terminating process, and keep a `timeout` around it in CI.
- **First run loads an embedding model.** Tens of seconds. `status` may report
  `needsEmbedding > 0` and `hasVectorIndex: false` while recovery is still
  running; that is not a failure. This card asserts on `lex` only, which works as
  soon as indexing does. Asserting on `vec`/`hyde` here would be flaky by design.
- **`GGML_METAL_NO_RESIDENCY=1` must be set before the process starts.**
  `start.sh` does it; invoking `bun server.ts` directly can abort at exit on
  macOS after embedding and poison the exit code.
- **Do not assert on the exit code.** Metal teardown can abort *after* correct
  JSON has been written. Assert on the JSON, not on `$?`.
- **stderr carries native model noise.** Read `/tmp/kb-scenario-err.log` for
  diagnostics, never for assertions.
