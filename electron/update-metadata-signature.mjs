import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { fetchGitHubReleaseAsset } from "./github-release-asset.mjs";
import { UPDATE_METADATA_PUBLIC_KEY_PEM } from "./update-metadata-public-key.mjs";

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const METADATA_MAX_BYTES = 256 * 1024;
const SIGNATURE_MAX_BYTES = 1024;

export class UpdateMetadataError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdateMetadataError";
    this.code = "ERR_UPDATER_INVALID_SIGNATURE";
  }
}

export function updateMetadataFilename(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "linux") return `latest-linux${arch === "x64" ? "" : `-${arch}`}.yml`;
  return "latest.yml";
}

export function releaseTagFor(info) {
  if (typeof info?.tag === "string" && info.tag) {
    if (!RELEASE_TAG.test(info.tag)) throw new UpdateMetadataError("refusing an update that is not a published release");
    return info.tag;
  }
  if (typeof info?.version === "string" && VERSION.test(info.version)) return `v${info.version}`;
  throw new UpdateMetadataError("refusing an update that is not a published release");
}

export function updateMetadataUrl(tag, filename) {
  if (!RELEASE_TAG.test(tag) || !/^[A-Za-z0-9._-]+\.yml$/.test(filename)) {
    throw new UpdateMetadataError("refusing an update that is not a published release");
  }
  return `https://github.com/EduardoMoraga/edu-bot/releases/download/${tag}/${filename}`;
}

/** PKCS#8 PEM, a one-line PEM with escaped newlines, or the base64 of that PEM. The value is never returned in an error. */
export function normalizeSigningKey(secret) {
  let text = String(secret ?? "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  text = text.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text.includes("BEGIN")) {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) text = decoded.trim();
  }
  if (!text.startsWith("-----BEGIN PRIVATE KEY-----") || !text.includes("-----END PRIVATE KEY-----")) {
    throw new Error("EDUBOT_UPDATE_SIGNING_KEY is not a PKCS#8 Ed25519 private key");
  }
  return text;
}

export function signUpdateMetadata(body, secret) {
  let key;
  try {
    key = createPrivateKey(normalizeSigningKey(secret));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EDUBOT_UPDATE_SIGNING_KEY")) throw error;
    throw new Error("EDUBOT_UPDATE_SIGNING_KEY is not a usable PKCS#8 Ed25519 private key");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("EDUBOT_UPDATE_SIGNING_KEY is not a usable PKCS#8 Ed25519 private key");
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return `${sign(null, payload, key).toString("base64")}\n`;
}

export function verifyUpdateMetadata(body, signatureText, publicKeyPem = UPDATE_METADATA_PUBLIC_KEY_PEM) {
  const pem = String(publicKeyPem ?? "").trim();
  if (!pem.includes("BEGIN PUBLIC KEY")) return { ok: false, reason: "missing public key" };
  const trimmed = String(signatureText ?? "").trim();
  if (!trimmed) return { ok: false, reason: "missing signature" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return { ok: false, reason: "invalid signature" };
  const signature = Buffer.from(trimmed, "base64");
  if (signature.length !== 64) return { ok: false, reason: "invalid signature" };
  try {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const ok = verify(null, payload, createPublicKey(pem), signature);
    return ok ? { ok: true } : { ok: false, reason: "invalid signature" };
  } catch {
    return { ok: false, reason: "invalid signature" };
  }
}

/** The subset of an electron-builder channel file the download is bound to. */
export function parseUpdateMetadata(text) {
  const version = /^version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?)['"]?\s*$/m.exec(text)?.[1] ?? null;
  const files = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const fileUrl = /^ {2}- url:\s*['"]?(\S+?)['"]?\s*$/.exec(line);
    if (fileUrl) {
      current = { url: fileUrl[1], sha512: "" };
      files.push(current);
      continue;
    }
    const nested = /^ {4}sha512:\s*['"]?(\S+?)['"]?\s*$/.exec(line);
    if (nested && current) current.sha512 = nested[1];
  }
  const path = /^path:\s*['"]?(\S+?)['"]?\s*$/m.exec(text)?.[1] ?? "";
  const sha512 = /^sha512:\s*['"]?(\S+?)['"]?\s*$/m.exec(text)?.[1] ?? "";
  return { version, files, path, sha512 };
}

/** True when every file the updater is about to download is named, with its sha512, in the signed text. */
export function metadataAgrees(text, info) {
  const doc = parseUpdateMetadata(text);
  if (!doc.version || doc.version !== info?.version) return false;
  const hashes = new Set(doc.files.map((file) => file.sha512).filter(Boolean));
  if (doc.sha512) hashes.add(doc.sha512);
  const claimedHashes = [];
  if (typeof info?.sha512 === "string") claimedHashes.push(info.sha512);
  if (Array.isArray(info?.files)) {
    for (const file of info.files) if (typeof file?.sha512 === "string") claimedHashes.push(file.sha512);
  }
  if (claimedHashes.length === 0 || !claimedHashes.every((hash) => hashes.has(hash))) return false;
  const names = new Set(doc.files.map((file) => file.url));
  if (doc.path) names.add(doc.path);
  const claimedNames = [];
  if (typeof info?.path === "string") claimedNames.push(info.path);
  if (Array.isArray(info?.files)) {
    for (const file of info.files) if (typeof file?.url === "string") claimedNames.push(file.url);
  }
  if (claimedNames.length === 0 || !claimedNames.every((name) => names.has(name))) return false;
  if ([...names].some((name) => name.includes("://") || name.startsWith("//") || name.split("/").includes(".."))) return false;
  return true;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new UpdateMetadataError("invalid signature");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UpdateMetadataError("invalid signature");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchAsset(fetchImpl, url, maxBytes, signal) {
  const response = await fetchGitHubReleaseAsset(url, fetchImpl, {
    headers: { accept: "application/octet-stream", "user-agent": "EduBot" },
    signal,
  });
  if (response.status === 404) {
    await response.body?.cancel?.().catch(() => {});
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  return readLimited(response, maxBytes);
}

/** Fetch the channel file for this platform from the published release and require a valid signature over those exact bytes. */
export async function assertSignedRelease(info, options = {}) {
  const tag = releaseTagFor(info);
  const filename = updateMetadataFilename(options.platform, options.arch);
  const url = updateMetadataUrl(tag, filename);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [body, signature] = await Promise.all([
      fetchAsset(fetchImpl, url, METADATA_MAX_BYTES, controller.signal),
      fetchAsset(fetchImpl, `${url}.sig`, SIGNATURE_MAX_BYTES, controller.signal),
    ]);
    if (!signature || signature.length === 0) throw new UpdateMetadataError("missing signature");
    if (!body) throw new UpdateMetadataError("missing signature");
    const verdict = verifyUpdateMetadata(body, signature.toString("utf8"), options.publicKey ?? UPDATE_METADATA_PUBLIC_KEY_PEM);
    if (!verdict.ok) throw new UpdateMetadataError(verdict.reason === "missing signature" ? "missing signature" : "invalid signature");
    if (!metadataAgrees(body.toString("utf8"), info)) throw new UpdateMetadataError("invalid signature");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("ETIMEDOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Installs on `downloadUpdate`: the file is fetched only after the published release's metadata verifies. */
export function gateUpdateDownload(autoUpdater, options = {}) {
  let pending = null;
  autoUpdater.on("update-available", (info) => {
    pending = info;
  });
  const downloadUpdate = autoUpdater.downloadUpdate.bind(autoUpdater);
  autoUpdater.downloadUpdate = async (...args) => {
    await assertSignedRelease(pending, options);
    return downloadUpdate(...args);
  };
}
