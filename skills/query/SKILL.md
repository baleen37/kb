---
name: query
description: Use when answering a question that the team's knowledge vault may already cover — domain behavior, policy, why a system is shaped the way it is, or what to check. Trigger before investigating from scratch in a repo that declares a kb vault, and whenever the user asks "how does X work", "why is X like this", "what is X" about a domain the vault owns. Searches the vault and answers with citations, or says the vault has no evidence.
---

# Query a kb vault

Answer from the vault's synthesis instead of rediscovering the same facts by reading
code. The vault exists because that rediscovery is expensive and its results evaporate.

## Find the vault

The working repo declares its vault. Look, in order:

1. A `kb` MCP server in `.mcp.json` — its `cwd` is the vault
2. A `kb` MCP server in `~/.codex/config.toml` — Codex has no `cwd` field, so the vault
   is the directory its command changes into
3. A vault line in the repo's `CLAUDE.md` / `AGENTS.md`
4. `.kb.yaml` in the current tree (you are already inside a vault)

If no vault is declared, say so and answer from the code as usual. Do not guess a vault
path — reading the wrong vault is worse than reading none, because its answers look
authoritative and are about a different system.

## Search

With the MCP server, call its `query` tool. It searches the whole vault and takes no
collection filter — the server scopes every search to the vault it was started in.

Otherwise run the CLI from the vault root:

```bash
qmd query "question" -c <collection> -n 10   # hybrid, best quality, slow (LLM expansion + rerank)
qmd search "keyword" -c <collection>         # BM25 only, immediate
qmd get qmd://<collection>/page.md           # read the page before answering
```

`qmd query` takes tens of seconds. Use `qmd search` or `--no-rerank` when you just need
to locate a page. On a small vault, `vsearch -c` may return nothing
([tobi/qmd#803](https://github.com/tobi/qmd/issues/803)) — suspect the bug before
concluding the vault is empty.

## Read, then answer

1. Read each relevant page in full — snippets hide the caveats.
2. Follow only links that could change the answer. Check the linked page and, when
   needed, the linked raw source.
3. Before answering, check evidence sufficiency:
   - every factual claim has an evidence link
   - current-state claims include an `as of` date or a dated raw snapshot
   - conflicting sources remain visible and are marked as conflicts
   - no unresolved link or missing source could materially change the answer
4. Answer **with citations**.

When the evidence is insufficient, say **"the vault has no evidence"**, **"the current
snapshot is missing"**, or **"the sources conflict"**. Do not fill the gap by invention.
An answer the vault cannot support is worse than no answer, because the next reader
cannot tell which is which.

## When the vault is wrong

You are the only person who will notice. A page contradicting the code is the vault's
main failure mode and it has no other alarm — fix it now or it stays wrong.

Tell the user what is stale, then offer to correct it via `kb:ingest`. Do not silently
patch a page mid-answer.

## When the answer is worth keeping

If the answer took real work — a comparison table, a newly found connection, a
correction — **ask the human whether to keep it as a page**. Do not let it evaporate
into the transcript. That evaporation is the problem the vault was built to solve.
