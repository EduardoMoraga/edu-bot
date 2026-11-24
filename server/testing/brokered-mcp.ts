import type { IncomingHttpHeaders } from "node:http";
import { expect } from "vitest";

const BROKERED = /^http:\/\/127\.0\.0\.1:\d+\/b\/omb_t0_[a-f0-9]{48}\/mcp-[a-z0-9_-]+$/u;

/** A URL MCP server as a turn's engine holds it: the credential broker's address and no headers. Its address. */
export function brokeredAddress(mounted: unknown): string {
  const { url, headers } = (mounted ?? {}) as { url?: string; headers?: Record<string, string> };
  expect(url, "the engine reaches this server through the credential broker").toMatch(BROKERED);
  expect(headers, "the engine holds none of this server's headers").toEqual({});
  return url!;
}

/** Asks the address a turn's engine holds as an MCP client would. */
export function askThroughBroker(mounted: unknown): Promise<Response> {
  return fetch(brokeredAddress(mounted), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });
}

/** The headers `upstream` gets when the address a turn's engine holds is asked: the ones the broker adds. */
export async function sentThroughBroker(mounted: unknown, upstream: { seenHeaders: IncomingHttpHeaders[] }): Promise<IncomingHttpHeaders> {
  const before = upstream.seenHeaders.length;
  await (await askThroughBroker(mounted)).arrayBuffer();
  const seen = upstream.seenHeaders[before];
  expect(seen, "the broker forwards to this server").toBeDefined();
  return seen!;
}
