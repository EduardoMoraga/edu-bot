// Signs electron-builder channel files. The private key is EDUBOT_UPDATE_SIGNING_KEY and is never written here.
import { readFileSync, writeFileSync } from "node:fs";

import { UPDATE_METADATA_PUBLIC_KEY_PEM } from "../electron/update-metadata-public-key.mjs";
import { signUpdateMetadata, verifyUpdateMetadata } from "../electron/update-metadata-signature.mjs";

const requireKey = process.argv.includes("--require");
const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node scripts/sign-update-metadata.mjs [--require] <file.yml>...");
  process.exit(2);
}

const secret = process.env.EDUBOT_UPDATE_SIGNING_KEY ?? "";
if (!secret.trim()) {
  if (requireKey) {
    console.error("EDUBOT_UPDATE_SIGNING_KEY is not set; refusing to publish unsigned update metadata");
    process.exit(1);
  }
  console.log("EDUBOT_UPDATE_SIGNING_KEY is not set; update metadata was not signed");
  process.exit(0);
}

for (const file of files) {
  const body = readFileSync(file);
  const signature = signUpdateMetadata(body, secret);
  const verdict = verifyUpdateMetadata(body, signature, UPDATE_METADATA_PUBLIC_KEY_PEM);
  if (!verdict.ok) {
    console.error(`Refusing to publish ${file}: the signature does not verify with the public key embedded in electron/update-metadata-public-key.mjs. Paste the matching public key before publishing.`);
    process.exit(1);
  }
  writeFileSync(`${file}.sig`, signature);
  console.log(`signed ${file}`);
}
