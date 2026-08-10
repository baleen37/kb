# kb

Agent-maintained knowledge vaults for Claude Code and Codex.

A **vault** is a git repository where agents maintain a synthesis of sources instead of
rediscovering the same facts at query time. It follows the
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
immutable sources under `raw/`, an agent-owned wiki under `wiki/`, and a schema humans own.

This plugin holds the portable half — the schema, the workflows, and the linter. Each
vault holds its own content and whatever is specific to it.

## Why separate vaults

Vaults are separate repositories with separate search indexes. A question about one
domain cannot pull an answer from another, because the index that would answer it is
not reachable from that working repo. Isolation is structural, not a matter of the
agent picking the right filter.

## Setup

Install the plugin, then in each vault:

```yaml
# .kb.yaml at the vault root
pages: wiki
sources: raw
collection: wiki
```

Register the search index once per vault, **in this order**:

```bash
qmd init                                   # create the vault-local .qmd/ index
qmd collection add ./wiki --name wiki
qmd update && qmd embed
```

`qmd init` first is what makes the isolation real. qmd's config is global by default
(`~/.config/qmd/index.yml`, index in `~/.cache/qmd/`), and a vault-local `.qmd/` takes
precedence only once it exists. Register a collection before running `qmd init` and it
lands in the global config, where this vault will also see every other vault's
collections. Nothing errors — `qmd collection list` from inside the vault is the only
way to notice, and it should show exactly the collections this vault declares.

Always pass a path and `--name`. Bare `qmd collection add` registers the current
directory with no confirmation.

Point a working repo at its vault with an MCP server. In Claude Code, `.mcp.json` at the
repo root:

```json
{
  "mcpServers": {
    "kb": { "command": "qmd", "args": ["mcp"], "cwd": "/path/to/vault" }
  }
}
```

Codex does not read a repo's `.mcp.json`, and its MCP config has no `cwd` field. Since
`qmd mcp` takes the vault from the working directory, wrap the command in a shell that
changes into it — in `~/.codex/config.toml`:

```toml
[mcp_servers.kb]
command = "sh"
args = ["-c", "cd /path/to/vault && exec qmd mcp"]
```

or `codex mcp add kb -- sh -c "cd /path/to/vault && exec qmd mcp"`. Codex config is
global, so name the server per vault if you use more than one.

Then add one line to that repo's `CLAUDE.md` / `AGENTS.md` telling agents to search the
vault before investigating from scratch. The MCP server supplies the tool; the line
supplies the intent. Neither works alone.

When filtering a search, note that the MCP `query` tool takes **`collections`** — plural,
an array. MCP drops unknown parameters silently, so a singular `collection` disappears
without an error and the filter never applies. The CLI is the opposite: `-c` with an
unknown name fails loudly.

## Skills

| Skill | Use |
|---|---|
| `kb:query` | Answer from the vault, with citations |
| `kb:ingest` | Add a source, update the concepts it touches |
| `kb:lint` | Format check, and editorial review on request |

## Layout

```text
SCHEMA.md          # rules every vault follows
skills/            # ingest, query, lint
lib/lint.ts        # format checker; resolves the vault from cwd
lib/vault.ts       # .kb.yaml resolution
hooks/pre-commit   # optional, per vault
markdownlint.yaml  # structural Markdown rules
```
