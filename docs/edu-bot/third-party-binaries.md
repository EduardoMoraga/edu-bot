# Third-party binaries in Edu Bot installers

These are the third-party binaries the desktop packages copy into the app.
Licence texts for them are shipped under `resources/licenses/` where the package already carries a copy.

Android platform-tools and Chrome for Testing are not in the installers. Google's terms for those downloads do not grant redistribution. `package:prepare` does not run `build:android-tools` or `build:browser`, and `scripts/after-pack.mjs` rejects a real package that still contains `android-platform-tools` or `browser-engine`.

| Binary | Version | Licence | Where it is packaged |
| --- | --- | --- | --- |
| Electron, including its `chrome-sandbox` helper | 43.7.9 (`package.json` allows `^43.5.0`) | MIT | The application runtime. This is Electron's sandbox helper, not Chrome for Testing. |
| cloudflared | 2026.10.3 | Apache-2.0 | `resources/cloudflared/` |
| cua-driver and cua-cursor-theme, Linux | 0.41.3 | MIT | `resources/cua-linux-x64/cua-driver` and `resources/cua-linux-x64/cua-cursor-theme`. Notices, Inter's SIL OFL 1.1, and the MPL-2.0 source list are in `resources/cua-linux-x64/licenses/` (`LICENSE.md`, `Inter-OFL-1.1.txt`, `THIRD_PARTY_LICENSES.html`, `THIRD_PARTY_NOTICES.md`, `SBOM.cdx.json`). |
| cua-driver, macOS | 0.45.4 | MIT | `resources/cua-driver`, `resources/cua-sdk/native/libcua_driver_sdk.dylib`, and `resources/cua-sdk/native/cua_driver_node_runtime.node`. |
| cua-driver, Windows | 0.45.4 | MIT | `resources/cua-driver.exe`, `resources/cua-driver-background.exe`, `resources/cua-sdk/native/cua_driver_sdk.dll`, and `resources/cua-sdk/native/cua_driver_node_runtime.node`. |
| Cua Driver notices, macOS and Windows | 0.45.4 | MIT, SIL OFL 1.1, MPL-2.0 | `resources/licenses/cua-driver-LICENSE.md`, `resources/licenses/cua-driver-Inter-OFL-1.1.txt`, and `resources/licenses/cua-driver-THIRD_PARTY_NOTICES.md`. |
| elevate.exe | electron-builder 26.15.3 | MIT | `resources/elevate.exe` on Windows. electron-builder copies this NSIS helper into the package. |
| DuckDB via `@duckdb/node-api` | 1.5.6-r.1 | MIT | `resources/duckdb/node_modules/@duckdb/` |
| DuckDB extensions `sqlite_scanner` and `postgres_scanner` | library v1.5.6 | MIT | `resources/duckdb/extensions/` |
| `@resvg/resvg-js` | 2.6.2 | MPL-2.0 | `resources/duckdb/node_modules/@resvg/` |
| `@1password/sdk` | 0.5.0 | MIT | `resources/duckdb/node_modules/@1password/` |

The speech helper (`electron/resources/speech-helper.swift`, bundle name Edu Bot Speech) is first-party. It is not in this table.

## Not bundled

- **Android platform-tools (`adb`).** The phone screen tells the user to install them from Google. Edu Bot does not download `platform-tools-latest` at package time or at runtime.
- **Chrome for Testing.** On macOS Apple silicon and on Linux, first use downloads Chrome for Testing into the user data directory when Google Chrome is missing or managed by policy. macOS Intel and Windows have no pin in `server/browser/chrome/install.ts`, so those builds ask the user to install Google Chrome.
- **agent-browser.** On macOS and Linux it is not copied into the installer. First use downloads the official Vercel asset (Apache-2.0, 0.37.0) and checks the pinned SHA-256. On Windows the executable is `third_party/browser/agent-browser-win32-x64-0.36.0-omb.1.exe` (13,806,080 bytes, SHA-256 `33bee834f6a6072ec8688b0914726e0262874d758f69f27e8baf7eaac6b5ed15`). Those bytes are the reviewed OpenMausBot build `0.36.0-omb.1` of agent-browser 0.36.0 plus the Windows cold-start fix from [vercel-labs/agent-browser#1781](https://github.com/vercel-labs/agent-browser/pull/1781). Vercel 0.37.0 does not include that fix. The Windows package ships this file under `agent-browser/`, and install reads it from the package or from a checkout of this repository, then checks the same hash. `.gitattributes` marks `third_party/browser/*.exe` binary so a Windows checkout does not rewrite those bytes. Provenance stays in `third_party/browser/README.md`. The Apache-2.0 text is `third_party/browser/agent-browser-LICENSE.txt`.

The AppArmor profile `edubot-browser` is still shipped as a text file and is installed only when a package actually contains `browser-engine`. First-use Chrome lives in the user data directory, so that profile does not cover it.
