# Releasing Edu Bot

Edu Bot publishes draft installers from `EduardoMoraga/edu-bot` only. The workflow is `.github/workflows/release.yml`. It does not push images, npm packages, or files to any other host.

## Cut a draft

1. `package.json` and `server/data-format-released.json` must already name the same version. The workflow runs `node scripts/record-data-format.mjs` and refuses a drift.
2. Push a tag `vX.Y.Z` that matches `package.json`. The workflow builds the installers, smokes each one on its OS, and opens a **draft** release with `SHA256SUMS`. It does not mark the release latest.
3. Read the draft notes. Publish the draft yourself when the files are the ones you want. Publishing the draft is what creates the non-draft release.

A manual run (`workflow_dispatch`) builds and smokes the same way. `dry_run` defaults to true and does not create a release. A manual run publishes a draft only when `dry_run` is false **and** the ref is already a `v*` tag, so the workflow does not create a tag.

## What is built

- macOS: dmg and zip, arm64 and x64.
- Windows: NSIS x64. arm64 is not a target in `electron-builder.yml`.
- Linux: AppImage and deb, x64. An rpm is produced so `scripts/verify-linux-package.mjs` can check it, and it is not uploaded.

Each OS job launches the packaged app once before upload. Linux also launches the AppImage and the installed deb (`pnpm smoke:linux-package`).

## Signing

Signing runs only when the secret is present. Otherwise the build is unsigned and the draft notes say so.

- macOS signing: `MAC_CERT_P12_BASE64` and `MAC_CERT_PASSWORD`.
- macOS notarization: those, plus `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER_ID`.
- Windows signing: `WIN_CSC_LINK` or `CSC_LINK` (and `CSC_KEY_PASSWORD` when the certificate needs it).
- Linux packages are unsigned.

`dmg.sign` stays false in `electron-builder.yml`. The macOS job turns it on only when the Developer ID secrets are set. Do not set `win.publisherName` until the installer is signed; electron-updater rejects updates when that name is present and the build is unsigned.

## Updater migration invariant

Desktop auto-update is off (`electron/desktop-updates.mjs`, `DESKTOP_AUTO_UPDATE`). The packaged `app-update.yml` still names `owner: EduardoMoraga` and `repo: edu-bot`. Do not point it at another repository. A later move of this repository changes the URL baked into already-shipped installs, and that is an owner decision. There is no legacy download mirror.
