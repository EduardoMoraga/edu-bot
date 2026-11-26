import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EventEmitter } from "node:events";

import { releaseAssetRedirect } from "./github-release-asset.mjs";
import { updateErrorMessage } from "./update-errors.mjs";
import { UPDATE_METADATA_PUBLIC_KEY_PEM } from "./update-metadata-public-key.mjs";
import {
  assertSignedRelease,
  gateUpdateDownload,
  metadataAgrees,
  signUpdateMetadata,
  verifyUpdateMetadata,
} from "./update-metadata-signature.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

const YML = [
  "version: 1.2.3",
  "files:",
  "  - url: EduBot-1.2.3-setup.exe",
  "    sha512: abcdef==",
  "    size: 10",
  "path: EduBot-1.2.3-setup.exe",
  "sha512: abcdef==",
  "releaseDate: '2026-11-26T00:00:00.000Z'",
  "",
].join("\n");

const INFO = {
  version: "1.2.3",
  tag: "v1.2.3",
  path: "EduBot-1.2.3-setup.exe",
  sha512: "abcdef==",
  files: [{ url: "EduBot-1.2.3-setup.exe", sha512: "abcdef==" }],
};

const signature = signUpdateMetadata(YML, privatePem);

test("a release redirect stays on GitHub's asset hosts", () => {
  const from = "https://github.com/EduardoMoraga/edu-bot/releases/download/v1.2.3/latest.yml";
  assert.equal(releaseAssetRedirect(from, "https://evil.example/latest.yml"), null);
  assert.equal(releaseAssetRedirect(from, "https://release-assets.githubusercontent.com.evil.example/x"), null);
  assert.equal(releaseAssetRedirect(from, "https://user:pass@release-assets.githubusercontent.com/x"), null);
  assert.equal(releaseAssetRedirect("https://raw.githubusercontent.com/EduardoMoraga/edu-bot/main/latest.yml", "https://release-assets.githubusercontent.com/x"), null);
  assert.equal(
    releaseAssetRedirect(from, "https://release-assets.githubusercontent.com/a?sig=1"),
    "https://release-assets.githubusercontent.com/a?sig=1",
  );
});

test("a valid signature matches the bytes and the embedded file is not a private key", () => {
  assert.equal(verifyUpdateMetadata(YML, signature, publicPem).ok, true);
  assert.equal(metadataAgrees(YML, INFO), true);
  assert.doesNotMatch(UPDATE_METADATA_PUBLIC_KEY_PEM, /PRIVATE/);
  const embedded = createPublicKey(UPDATE_METADATA_PUBLIC_KEY_PEM);
  assert.equal(embedded.asymmetricKeyType, "ed25519");
  assert.equal(verifyUpdateMetadata(YML, signature, UPDATE_METADATA_PUBLIC_KEY_PEM).ok, false);
});

test("a tampered metadata file fails verification", () => {
  const tampered = YML.replace("1.2.3", "9.9.9");
  const verdict = verifyUpdateMetadata(tampered, signature, publicPem);
  assert.deepEqual(verdict, { ok: false, reason: "invalid signature" });
  const flipped = `${signature.slice(0, -2)}A\n`;
  assert.equal(verifyUpdateMetadata(YML, flipped, publicPem).ok, false);
});

test("a missing signature is rejected", () => {
  for (const missing of ["", "   ", null, undefined]) {
    assert.deepEqual(verifyUpdateMetadata(YML, missing, publicPem), { ok: false, reason: "missing signature" });
  }
  assert.equal(verifyUpdateMetadata(YML, signature, "").reason, "missing public key");
});

function feed(files) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    const name = String(url).split("/").pop()?.split("?")[0];
    const body = files[name];
    if (body == null) return new Response("", { status: 404 });
    return new Response(body);
  };
  return { fetch, urls };
}

test("a published release with a valid signature may be downloaded", async () => {
  const { fetch, urls } = feed({ "latest.yml": YML, "latest.yml.sig": signature });
  await assertSignedRelease(INFO, { fetch, platform: "win32", publicKey: publicPem });
  assert.deepEqual(urls, [
    "https://github.com/EduardoMoraga/edu-bot/releases/download/v1.2.3/latest.yml",
    "https://github.com/EduardoMoraga/edu-bot/releases/download/v1.2.3/latest.yml.sig",
  ]);
  assert.equal(urls.some((url) => url.includes("/main/")), false);
});

test("a tampered or substituted release is not downloaded", async () => {
  const tampered = feed({ "latest.yml": YML.replace("abcdef==", "zzzzzz=="), "latest.yml.sig": signature });
  await assert.rejects(
    assertSignedRelease(INFO, { fetch: tampered.fetch, platform: "win32", publicKey: publicPem }),
    /invalid signature/,
  );
  const swapped = feed({ "latest.yml": YML, "latest.yml.sig": signature });
  const other = { ...INFO, sha512: "not-the-signed-hash", files: [{ url: INFO.path, sha512: "not-the-signed-hash" }] };
  await assert.rejects(assertSignedRelease(other, { fetch: swapped.fetch, platform: "win32", publicKey: publicPem }), /invalid signature/);
  await assert.rejects(assertSignedRelease({ version: "1.2.3", tag: "main" }, { fetch: swapped.fetch, platform: "win32", publicKey: publicPem }), /published release/);
});

test("a missing signature file blocks the download", async () => {
  const { fetch } = feed({ "latest.yml": YML });
  await assert.rejects(assertSignedRelease(INFO, { fetch, platform: "win32", publicKey: publicPem }), /missing signature/);
  const linux = feed({ "latest.yml": YML, "latest.yml.sig": signature });
  await assert.rejects(assertSignedRelease(INFO, { fetch: linux.fetch, platform: "linux", arch: "x64", publicKey: publicPem }), /missing signature/);
  assert.equal(linux.urls[0], "https://github.com/EduardoMoraga/edu-bot/releases/download/v1.2.3/latest-linux.yml");
  const updater = new EventEmitter();
  let downloaded = false;
  updater.downloadUpdate = async () => {
    downloaded = true;
  };
  gateUpdateDownload(updater, { fetch, platform: "win32", publicKey: publicPem });
  updater.emit("update-available", INFO);
  await assert.rejects(updater.downloadUpdate(), /missing signature/);
  assert.equal(downloaded, false);
  assert.match(updateErrorMessage(Object.assign(new Error("missing signature"), { code: "ERR_UPDATER_INVALID_SIGNATURE" })), /failed verification/);
});

test("a valid signature lets the gated download proceed, and only then", async () => {
  const { fetch } = feed({ "latest.yml": YML, "latest.yml.sig": signature });
  const updater = new EventEmitter();
  let downloaded = false;
  updater.downloadUpdate = async () => {
    downloaded = true;
    return ["installer"];
  };
  gateUpdateDownload(updater, { fetch, platform: "win32", publicKey: publicPem });
  await assert.rejects(updater.downloadUpdate(), /published release/);
  assert.equal(downloaded, false);
  updater.emit("update-available", INFO);
  assert.deepEqual(await updater.downloadUpdate(), ["installer"]);
  assert.equal(downloaded, true);
});

test("the release script refuses to sign without the secret or without a matching embedded key", () => {
  const dir = mkdtempSync(join(tmpdir(), "edubot-sign-"));
  const file = join(dir, "latest.yml");
  writeFileSync(file, YML);
  const script = fileURLToPath(new URL("../scripts/sign-update-metadata.mjs", import.meta.url));
  const run = (args, env) => spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env, ...env }, encoding: "utf8" });
  try {
    const skipped = run([file], { EDUBOT_UPDATE_SIGNING_KEY: "" });
    assert.equal(skipped.status, 0);
    assert.match(skipped.stdout, /was not signed/);
    assert.throws(() => readFileSync(`${file}.sig`));

    const required = run(["--require", file], { EDUBOT_UPDATE_SIGNING_KEY: "" });
    assert.equal(required.status, 1);
    assert.match(required.stderr, /refusing to publish unsigned/);

    const secretLine = privatePem.split("\n").find((line) => line.length > 40 && !line.startsWith("-----"));
    assert.equal(typeof secretLine, "string");
    const mismatched = run(["--require", file], { EDUBOT_UPDATE_SIGNING_KEY: privatePem.replaceAll("\n", "\\n") });
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /public key embedded/);
    assert.equal(mismatched.stderr.includes(secretLine), false);
    assert.equal(mismatched.stdout.includes(secretLine), false);
    assert.throws(() => readFileSync(`${file}.sig`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
