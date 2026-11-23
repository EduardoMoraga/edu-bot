# Cua Driver 0.45.4 third-party notices

Edu Bot redistributes Cua Driver 0.45.4 on macOS and Windows. Linux packages stay on 0.41.3 and carry that version's notices beside those binaries.

- Tag `cua-driver-rs-v0.45.4`, commit [`d96e1bc359b2cc638c7a406aad01a7276b1b416f`](https://github.com/trycua/cua/commit/d96e1bc359b2cc638c7a406aad01a7276b1b416f)
- macOS CLI archive `cua-driver-rs-0.45.4-darwin-universal-binary.tar.gz`, SHA-256 `7dff49530847419828770a1737788cd50642026c0d679a9a4ef383259db94ac5`
- Windows CLI archive `cua-driver-rs-0.45.4-windows-x86_64-binary.zip`, SHA-256 `949927b4cb0519c6fb1377878d67d79a8d6fae7bc56cbed17c7aa26448d82cb5`
- npm packages `@trycua/cua-driver` and the matching platform SDK, version 0.45.4

Packaged paths:

- macOS: `resources/cua-driver`, `resources/cua-sdk/native/libcua_driver_sdk.dylib`, `resources/cua-sdk/native/cua_driver_node_runtime.node`
- Windows: `resources/cua-driver.exe`, `resources/cua-driver-background.exe`, `resources/cua-sdk/native/cua_driver_sdk.dll`, `resources/cua-sdk/native/cua_driver_node_runtime.node`

## MIT

Cua's own terms are the accompanying `cua-driver-LICENSE.md` (MIT, Copyright (c) 2025 Cua AI, Inc.).

## SIL OFL 1.1

The cursor theme embeds Inter. Its terms are the accompanying `cua-driver-Inter-OFL-1.1.txt`, the `Inter-OFL.txt` shipped in `libs/cua-driver/rust/crates/cursor-overlay/assets` at the commit above.

## MPL-2.0 source availability

`Cargo.lock` at the commit above pins these Mozilla Public License 2.0 crates. Their Source Code Form is the versioned crates.io download. The license text is at <https://www.mozilla.org/MPL/2.0/>.

- [option-ext@0.2.0](https://crates.io/api/v1/crates/option-ext/0.2.0/download) — SHA-256 `04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d`
- [uniffi@0.31.0](https://crates.io/api/v1/crates/uniffi/0.31.0/download) — SHA-256 `b8c6dec3fc6645f71a16a3fa9ff57991028153bd194ca97f4b55e610c73ce66a`
- [uniffi_bindgen@0.31.0](https://crates.io/api/v1/crates/uniffi_bindgen/0.31.0/download) — SHA-256 `4ed0150801958d4825da56a41c71f000a457ac3a4613fa9647df78ac4b6b6881`
- [uniffi_core@0.31.0](https://crates.io/api/v1/crates/uniffi_core/0.31.0/download) — SHA-256 `b0ef62e69762fbb9386dcb6c87cd3dd05d525fa8a3a579a290892e60ddbda47e`
- [uniffi_internal_macros@0.31.0](https://crates.io/api/v1/crates/uniffi_internal_macros/0.31.0/download) — SHA-256 `98f51ebca0d9a4b2aa6c644d5ede45c56f73906b96403c08a1985e75ccb64a01`
- [uniffi_macros@0.31.0](https://crates.io/api/v1/crates/uniffi_macros/0.31.0/download) — SHA-256 `db9d12529f1223d014fd501e5f29ca0884d15d6ed5ddddd9f506e55350327dc3`
- [uniffi_meta@0.31.0](https://crates.io/api/v1/crates/uniffi_meta/0.31.0/download) — SHA-256 `9df6d413db2827c68588f8149d30d49b71d540d46539e435b23a7f7dbd4d4f86`
- [uniffi_pipeline@0.31.0](https://crates.io/api/v1/crates/uniffi_pipeline/0.31.0/download) — SHA-256 `a806dddc8208f22efd7e95a5cdf88ed43d0f3271e8f63b47e757a8bbdb43b63a`
- [uniffi_udl@0.31.0](https://crates.io/api/v1/crates/uniffi_udl/0.31.0/download) — SHA-256 `0d1a7339539bf6f6fa3e9b534dece13f778bda2d54b1a6d4e40b4d6090ac26e7`

`cua_driver_node_runtime.node` is a compatibility build derived from the N-API runtime in `uniffi-bindgen-react-native` 0.31.0-3, copyright its contributors, Mozilla Public License 2.0. The corresponding source is that pinned package plus the transformations in `scripts/build-node-runtime.mjs` at the tag above. Those transformations add `scripts/node-runtime-trampoline-cache.rs`, which is `runtimes/napi/src/callback/cache.rs` from `uniffi-bindgen-react-native` commit `5d24b38` (`jhugman/uniffi-bindgen-react-native#440`, released in 0.31.0-4), unmodified apart from an added `SPDX-License-Identifier: MPL-2.0` line and under the same license.

These components stay under their own licenses. Cua's MIT license does not replace them.
