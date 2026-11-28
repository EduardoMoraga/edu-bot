#!/usr/bin/env node
// A scripted, read-only `tailscale` for tests. Its state lives beside the script, so a test runs its own copy:
//   calls.ndjson   every invocation's arguments, one JSON array per line
//   status.json    what `status --json` prints
//   whois.json     { "<address>": <what `whois --json <address>` prints> }; an unknown address exits 1
// Anything else exits 2.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
appendFileSync(join(here, "calls.ndjson"), `${JSON.stringify(args)}\n`);
const read = (name) => (existsSync(join(here, name)) ? readFileSync(join(here, name), "utf8") : "");

if (args.length === 2 && args[0] === "status" && args[1] === "--json") {
  process.stdout.write(read("status.json"));
} else if (args.length === 3 && args[0] === "whois" && args[1] === "--json") {
  let answers = {};
  try {
    answers = JSON.parse(read("whois.json") || "{}");
  } catch {
    answers = {};
  }
  const answer = answers[args[2]];
  if (answer === undefined) {
    process.stderr.write(`no match for IP:port ${args[2]}\n`);
    process.exit(1);
  }
  process.stdout.write(typeof answer === "string" ? answer : JSON.stringify(answer));
} else {
  process.exit(2);
}
