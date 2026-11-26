# Update signing and the stable model list

Installed apps do not follow `main`. The model list comes from the `stable` branch (or a pinned release). Windows and Linux install an update only from a published GitHub release whose `latest.yml` (or `latest-linux.yml`) carries a valid Ed25519 signature.

The private key is not in this repository. Do not generate it inside the checkout, and do not commit it. `.gitignore` ignores `edubot-update-signing.pem` as a backstop.

## Generate the key

On a machine you trust, outside this repository:

```sh
mkdir -m 700 "$HOME/edubot-update-key"
cd "$HOME/edubot-update-key"
node --input-type=module -e '
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync("edubot-update-signing.pem", privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync("edubot-update-public.pem", publicKey.export({ type: "spki", format: "pem" }));
'
```

OpenSSL 1.1.1 or newer produces the same pair:

```sh
openssl genpkey -algorithm ED25519 -out edubot-update-signing.pem
chmod 600 edubot-update-signing.pem
openssl pkey -in edubot-update-signing.pem -pubout -out edubot-update-public.pem
```

`edubot-update-signing.pem` is the private key. `edubot-update-public.pem` is the public key. Keep the private key somewhere that is not this git tree. After the secret below is saved, you can delete the local private file.

## GitHub secret

Repository → Settings → Secrets and variables → Actions → New repository secret.

- Name: `EDUBOT_UPDATE_SIGNING_KEY`
- Value: the full private PEM, including the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines.

The release workflow reads that secret only in the assemble job, signs `latest.yml`, `latest-linux.yml`, and `latest-mac.yml`, and writes a `.sig` of raw base64 next to each file. It then checks the signature with the public key embedded in the app. If the secret is missing, or the keys do not match, the job exits before it creates a draft. A dry run with the secret unset still builds; it does not sign and does not publish.

## Embed the public key

Paste the public PEM into `electron/update-metadata-public-key.mjs`, replacing the empty string:

```js
export const UPDATE_METADATA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA...
-----END PUBLIC KEY-----`;
```

Commit that file. Do not commit the private PEM. Do not publish a release of a build whose public key is still empty: that build would reject every later update, including a signed one. The assemble job refuses to publish while the embedded key is empty or does not match the secret, so a draft is not created until both halves are in place.

Ship one release that contains the public key. Installs from before this check still update to it (they do not look for a signature). From that version on, an update without a valid `.sig`, or with a changed `latest.yml`, is refused. The signature covers the metadata bytes. The metadata's SHA-512 is what the downloaded installer is checked against.

## The stable model list

`server/model-manifest/manifest.ts` fetches the model list from the `stable` ref:

`https://raw.githubusercontent.com/EduardoMoraga/edu-bot/stable/server/model-manifest/model-manifest.json`

Create the `stable` branch (or a tag named `stable`) at the commit whose model list should reach installed apps, and move it only when that list should change. A merge to `main` does not. `OMB_MODEL_MANIFEST_REF=main` is refused: the app keeps the copy bundled in that build and does not request `main`.

Other values of `OMB_MODEL_MANIFEST_REF`:

| Value | What is fetched |
| --- | --- |
| unset, or `stable` | The file on the `stable` branch or tag |
| `vX.Y.Z` | The file at that tag |
| a 40-character commit | The file at that commit |
| `release:vX.Y.Z` | The `model-manifest.json` asset on that published release |

Each release uploads `model-manifest.json` from the tagged commit, so `release:vX.Y.Z` is that pin. A missing file, a refused ref, or a bad download leaves the bundled list in place. `OMB_DISABLE_MODEL_MANIFEST_FETCH=1` skips the fetch.

## What you do once

1. Generate the key pair outside the repository.
2. Add `EDUBOT_UPDATE_SIGNING_KEY` in the repository secrets.
3. Paste the public key into `electron/update-metadata-public-key.mjs` and commit it.
4. Create the `stable` branch at the commit whose model list should ship, and move it when that list should change.
