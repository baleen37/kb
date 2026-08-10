import { test, expect } from "bun:test";
import { buildInstructions, createMcpServer } from "./server.ts";
import { makeVault } from "./fixture.ts";
import { prepareStore } from "./store.ts";

test("instructions never quote figures from the index", () => {
  // They are built before recovery indexes anything, so every count would read
  // zero: a full vault would look empty and an embedding warning would stay
  // silent on the cold start where it matters. `status` reports live figures.
  const text = buildInstructions();
  expect(text).not.toMatch(/\d+ markdown documents/);
  expect(text).not.toMatch(/\d+ documents need embedding/);
  expect(text).toContain("searchable vault");
});

test("instructions point at status for embedding readiness", () => {
  const text = buildInstructions();
  expect(text).toContain("`status`");
  expect(text).toMatch(/vec/);
  expect(text).toMatch(/lex/);
});

test("a real server carries honest instructions on a cold start", async () => {
  // The wiring test the unit tests above cannot be: build a server the way the
  // entry point does, on a vault that has never been indexed, and confirm the
  // instructions do not describe it as empty.
  const v = makeVault({ docs: { "a.md": "# A\n\nalpha", "b.md": "# B\n\nbeta" } });
  try {
    const p = await prepareStore(v.root);
    const server = createMcpServer(p); // before p.ready — exactly as main does

    const instructions = (
      server.server as unknown as { _instructions?: string }
    )._instructions;

    expect(instructions).toBeDefined();
    expect(instructions).not.toMatch(/\b0 (markdown documents|documents)/);

    await p.close();
  } finally {
    v.cleanup();
  }
}, 120_000);
