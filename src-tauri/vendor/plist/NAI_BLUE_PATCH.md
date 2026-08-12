# NAI Blue plist Patch

Source: `ebarnard/rust-plist` commit `58a19eb1c45cf7f92ec22947ff18fba2c416a9c0`.

Reason: Tauri 2.11.x depends on `plist 1.9.0`. The published crate pins
`quick-xml ^0.39.2`, which leaves `quick-xml 0.39.x` in `Cargo.lock` and
triggers `RUSTSEC-2026-0194`.

Local delta: only `Cargo.toml` changes, raising `quick-xml` to `0.41.0`.
The vendored crate was verified with `cargo check` before wiring it through
`src-tauri/Cargo.toml` using `[patch.crates-io]`.

Removal condition: delete this vendor patch once crates.io publishes a `plist`
release that depends on `quick-xml >=0.41.0` and Tauri resolves to it.
