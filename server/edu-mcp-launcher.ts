// Starts `edu mcp` for a bot without the crew-worker guard its engine carries, so the bot's memory writes still reach Edu.
// Each engine merges an MCP server's env with its own in its own way, so the guard is removed here rather than trusted
// to an empty value in the server's env.
import { pathToFileURL } from "node:url";
import { EDU_CREW_GUARD } from "./edu-crew-guard.ts";

const [cli, ...args] = process.argv.slice(2);
if (!cli) {
  process.stderr.write("usage: edu-mcp-launcher <edu cli> [arguments]\n");
  process.exit(2);
}
delete process.env[EDU_CREW_GUARD];
process.argv = [process.argv[0]!, cli, ...args];
await import(pathToFileURL(cli).href);
