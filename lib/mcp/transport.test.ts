import { test, expect } from "bun:test";
import { createWriteStream } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * The server writes JSON-RPC to its own handle on fd 1 rather than to
 * process.stdout, because qmd swaps process.stdout.write for one that writes to
 * stderr whenever it initializes llama. When replies went through that swap the
 * client saw silence and hung.
 *
 * These tests pin the property that prevents it.
 */

test("the transport keeps the stream it was given, not process.stdout", () => {
  const stream = createWriteStream("", { fd: 1 });
  const transport = new StdioServerTransport(process.stdin, stream);

  // Reaching into _stdout is the point: it is what send() writes to, and the
  // whole fix is that it is captured at construction rather than looked up.
  expect((transport as unknown as { _stdout: unknown })._stdout).toBe(stream);
  expect((transport as unknown as { _stdout: unknown })._stdout).not.toBe(process.stdout);

  stream.end();
});

test("swapping process.stdout.write does not touch the captured stream", () => {
  const stream = createWriteStream("", { fd: 1 });
  const transport = new StdioServerTransport(process.stdin, stream);
  const captured = (transport as unknown as { _stdout: NodeJS.WritableStream })._stdout;
  const streamWrite = stream.write;

  // Exactly what qmd's withNativeStdoutRedirectedToStderr does.
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string) => process.stderr.write(chunk)) as typeof original;
  try {
    expect(captured).toBe(stream);
    expect(stream.write).toBe(streamWrite);
  } finally {
    process.stdout.write = original;
    stream.end();
  }
});
