---
author: continuouslee
created_by: continuouslee <lee@atomic.dev>
goals: []
id: NODE::continuouslee::1
priority: medium
project: NODE
seq: 1
status: needs-review
title: Load the installed Atomic native runtime by host platform and architecture
uid: 01M533ZXYKMDGH2SPQZK3S99BK
view: dev
entry_type: intent
content_hash: RNWPMJU2EHMESDHDOSTUHS2RSJGFHKTJPIEY46PC76UCTT6JRD2A
created_at: 2026-10-16T19:54:10.400014+00:00
updated_at: 2026-10-16T19:54:10.400014+00:00
---
:::why
Atomic installations now distribute Node-enabled platform libraries with release metadata. nodeatomic should load that installed runtime by host OS/CPU, enabling a future universal Catalyst VSIX without bundling native binaries or requiring compilation on user machines.
:::

:::acceptance-criterion{#01M533ZXYKMDGH2SPQZK3S99BK-ac-1 status=met verifiedBy="Node unit/integration tests, TypeScript build and npm package inspection" evidence="ATOMIC_RUNTIME_DIR pointing to the new macOS ARM64 libatomic runtime: npm test rebuilds codegen/TypeScript and passes all 45 tests. Real native calls pass through explicit runtime discovery and automatic PATH discovery using a deliberately non-runnable CLI sentinel. Tests cover all three platform mappings, symlinks, configuration precedence, unsafe PATH exclusions, checksum/contract failures, lazy import and retry/cache behavior. npm pack --dry-run verifies 14 platform-independent files with loader declarations and generated descriptor fingerprint, and no native libraries. git diff --check passes. Linux and Windows mappings are unit-tested on macOS; actual Linux/Windows and VS Code/Electron execution remain unverified here. Catalyst packaging and external installers were not changed."}
The build and runtime share a deterministic native loader for macOS ARM64, Linux x64 glibc, and Windows x64. Runtime selection supports explicit absolute paths and the active Atomic executable without executing subprocesses or scanning source checkouts/current directories. Distributed metadata, OS/CPU, Node-API support, binary/descriptor checksums and the generated protobuf contract are checked; errors fail closed. Public imports are lazy, development artifact installation remains explicit, and package contents omit native binaries. Unit tests, TypeScript build and available real macOS native integration checks pass with platform execution limitations recorded.
:::

:::task{#01M533ZXYKMDGH2SPQZK3S99BK-1 status=done criteria=01M533ZXYKMDGH2SPQZK3S99BK-ac-1}
Implement a shared platform-aware runtime loader, bind runtime calls to the generated descriptor fingerprint, preserve explicit producer/codegen tooling, add loader tests and document installed-runtime discovery and package boundaries.
::file-ref{path=ts/native.ts}
::file-ref{path=ts/runtime/loader.mjs}
::file-ref{path=scripts/addon.mjs}
::file-ref{path=scripts/generate-proto.mjs}
::file-ref{path=scripts/copy-generated.mjs}
::file-ref{path=test/runtime.test.mjs}
::file-ref{path=test/loading.test.mjs}
::file-ref{path=README.md}
:::

:::scope-in
nodeatomic runtime resolution/loading, generated contract fingerprint, packaging/build copying, loader tests and documentation.
:::

:::scope-out
Atomic's release matrix or native producer, installers/self-update, Catalyst bundling or extension settings, Marketplace publication, new CPU targets, and a general protobuf backward-compatibility algorithm.
:::

:::constraint
Do not build/download native code or invoke Atomic during runtime discovery or repository operations. Do not silently fall back after an explicit or discovered runtime fails validation. Do not auto-load a working-directory native library or a package-bundled binary in the public runtime path. Require an exact generated descriptor fingerprint as a conservative contract compatibility gate; hashes do not establish signer trust. Keep discovery and build-only legacy addon fallback separate.
:::
