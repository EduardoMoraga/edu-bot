// electron-builder lists every Linux target in latest-linux.yml. The release
// workflow does not upload the rpm, so the feed must not name it either.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Drop every `.rpm` file entry. Retarget the legacy `path` when it was that rpm. */
export function stripRpmFeed(text) {
  const kept = [];
  let skipIndent = -1;
  for (const line of text.split("\n")) {
    if (skipIndent >= 0) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim() !== "" && indent > skipIndent) continue;
      skipIndent = -1;
    }
    const url = line.match(/^(\s*)-\s+url:\s+(\S+)\s*$/);
    if (url?.[2].endsWith(".rpm")) {
      skipIndent = url[1].length;
      continue;
    }
    kept.push(line);
  }
  let next = kept.join("\n");
  const path = next.match(/^path:\s+(\S+)\s*$/m);
  if (path?.[1].endsWith(".rpm")) {
    const fallback = [...next.matchAll(/^\s*-\s+url:\s+(\S+)\s*$/gm)].map((match) => match[1]).find((url) => !url.endsWith(".rpm"));
    if (!fallback) throw new Error("latest-linux.yml has no non-rpm file to publish");
    const sha = next.match(new RegExp(`- url: ${fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\s+sha512:\\s+(\\S+)`));
    next = next.replace(/^path:\s+\S+\s*$/m, `path: ${fallback}`);
    if (sha?.[1]) next = next.replace(/^sha512:\s+\S+\s*$/m, `sha512: ${sha[1]}`);
  }
  if (next.includes(".rpm")) throw new Error("latest-linux.yml still lists an rpm");
  return next;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node scripts/strip-linux-rpm-feed.mjs <latest-linux.yml>");
  writeFileSync(file, stripRpmFeed(readFileSync(file, "utf8")));
}
