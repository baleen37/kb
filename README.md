# kb

Agent-maintained knowledge vaults for Claude Code and Codex.

A **vault** is a git repository where agents maintain a synthesis of sources instead of
rediscovering the same facts at query time. It follows the
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
immutable sources under `raw/` and an agent-owned wiki under `wiki/`.

This plugin holds the portable half — the workflows and the linter. Each vault holds its
own content and whatever is specific to it.

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
collection: wiki
```

The server reads `.kb.yaml`, keeps its index in the vault's own `.qmd/`, and
indexes on first run. No `qmd init`, no collection registration — it passes the
collection to qmd directly, so the global config is never consulted and one
vault cannot see another's collections.

The qmd CLI still works inside a vault for ad-hoc searching, but it follows the
global config rules described in its own docs.

Point a working repo at its vault with an MCP server. In Claude Code, `.mcp.json` at the
repo root:

```json
{
  "mcpServers": {
    "kb": {
      "command": "${CLAUDE_PLUGIN_ROOT}/lib/mcp/start.sh",
      "cwd": "/path/to/vault"
    }
  }
}
```

Codex does not read a repo's `.mcp.json`, and its MCP config has no `cwd` field. Since
the server takes the vault from the working directory, wrap the command in a shell that
changes into it — in `~/.codex/config.toml`:

```toml
[mcp_servers.kb]
command = "sh"
args = ["-c", "cd /path/to/vault && exec /path/to/kb/lib/mcp/start.sh"]
```

Codex does not substitute `${CLAUDE_PLUGIN_ROOT}` in its own MCP config, so spell out
where the plugin lives. Codex config is global, so name the server per vault if you use
more than one.

The optional `pre-commit` hook needs the same path in `KB_PLUGIN_DIR`.

Then add one line to that repo's `CLAUDE.md` / `AGENTS.md` telling agents to search the
vault before investigating from scratch. The MCP server supplies the tool; the line
supplies the intent. Neither works alone.

A search covers the whole vault — the MCP `query` tool has no collection filter, since a
vault holds exactly one collection and the server scopes every search to it.

## Skills

| Skill | Use |
|---|---|
| `kb:query` | Answer from the vault, with citations |
| `kb:ingest` | Add a source, update the concepts it touches |
| `kb:lint` | Format check, and editorial review on request |

## Layout

```text
skills/            # ingest, query, lint — ingest carries the vault format rules
lib/mcp/           # the MCP server — start.sh launches it
lib/lint.ts        # format checker; resolves the vault from cwd
lib/vault.ts       # .kb.yaml resolution
hooks/pre-commit   # optional, per vault
markdownlint.yaml  # structural Markdown rules
```
