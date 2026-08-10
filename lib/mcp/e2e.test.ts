import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { makeVault } from "./fixture.ts";

const SERVER = join(import.meta.dir, "start.sh");

// A cold start (no embedding model in cache) can take longer than the MCP
// client's default 60s request timeout to answer, because loading the model
// is slow. A warm run connects immediately. Give connect/callTool plenty of
// room, under the 180s bun test timeout below.
const REQUEST_TIMEOUT = 170_000;

test("the server exposes exactly the four qmd tools", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nwombat husbandry notes" } });
  try {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StdioClientTransport({ command: SERVER, cwd: v.root }), {
      timeout: REQUEST_TIMEOUT,
    });

    const { tools } = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT });
    expect(tools.map((t) => t.name).sort()).toEqual(["get", "multi_get", "query", "status"]);

    await client.close();
  } finally {
    v.cleanup();
  }
}, 180_000);

test("a query round-trips through the protocol", async () => {
  const v = makeVault({ docs: { "a.md": "# Alpha\n\nwombat husbandry notes" } });
  try {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StdioClientTransport({ command: SERVER, cwd: v.root }), {
      timeout: REQUEST_TIMEOUT,
    });

    const res = await client.callTool(
      { name: "query", arguments: { searches: [{ type: "lex", query: "wombat" }] } },
      undefined,
      { timeout: REQUEST_TIMEOUT },
    );
    expect(JSON.stringify(res.content)).toContain("a.md");

    await client.close();
  } finally {
    v.cleanup();
  }
}, 180_000);
