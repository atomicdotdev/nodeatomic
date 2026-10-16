---
intentId: NODE::continuouslee::1
sourceContentHash: blake3:5c95f98c0f1c04371a1b55bae0351ae0e002a3b3384c018571bfe174a93b4f98
entry_type: attestation
content_hash: INWFUVU7HZTKHJ53NYYVWPC26RTV673QRF52JGRP5MDLSL2KXBEQ
created_at: 2026-10-16T19:53:48.460732+00:00
updated_at: 2026-10-16T19:53:48.460732+00:00
---
{
  "@context": "https://atomic.dev/ns/ctx.jsonld",
  "@id": "urn:atomic:intent:01M533ZXYKMDGH2SPQZK3S99BK",
  "@type": "Intent",
  "attributedTo": "did:atomic:U4NNGFTE7KZZKRML6TQDBJJMOMKDCEHZO64IKHGACVRYGZOQSH5Q",
  "contentHash": "blake3:ffc8ae024f068aa63878ecce5f66cdb4a5c8e75a97f343a467a8e9f2d2d2237d",
  "createdAt": "",
  "hasAcceptanceCriterion": [
    {
      "@id": "urn:atomic:ac:01M533ZXYKMDGH2SPQZK3S99BK-ac-1",
      "@type": "AcceptanceCriterion",
      "acStatus": "met",
      "evidence": "ATOMIC_RUNTIME_DIR pointing to the new macOS ARM64 libatomic runtime: npm test rebuilds codegen/TypeScript and passes all 45 tests. Real native calls pass through explicit runtime discovery and automatic PATH discovery using a deliberately non-runnable CLI sentinel. Tests cover all three platform mappings, symlinks, configuration precedence, unsafe PATH exclusions, checksum/contract failures, lazy import and retry/cache behavior. npm pack --dry-run verifies 14 platform-independent files with loader declarations and generated descriptor fingerprint, and no native libraries. git diff --check passes. Linux and Windows mappings are unit-tested on macOS; actual Linux/Windows and VS Code/Electron execution remain unverified here. Catalyst packaging and external installers were not changed.",
      "text": "The build and runtime share a deterministic native loader for macOS ARM64, Linux x64 glibc, and Windows x64. Runtime selection supports explicit absolute paths and the active Atomic executable without executing subprocesses or scanning source checkouts/current directories. Distributed metadata, OS/CPU, Node-API support, binary/descriptor checksums and the generated protobuf contract are checked; errors fail closed. Public imports are lazy, development artifact installation remains explicit, and package contents omit native binaries. Unit tests, TypeScript build and available real macOS native integration checks pass with platform execution limitations recorded.",
      "verifiedBy": "Node unit/integration tests, TypeScript build and npm package inspection"
    }
  ],
  "hasConstraint": [
    {
      "@id": "urn:atomic:constraint:01m533zxykmdgh2spqzk3s99bk-constraint-1",
      "@type": "Constraint",
      "text": "Do not build/download native code or invoke Atomic during runtime discovery or repository operations. Do not silently fall back after an explicit or discovered runtime fails validation. Do not auto-load a working-directory native library or a package-bundled binary in the public runtime path. Require an exact generated descriptor fingerprint as a conservative contract compatibility gate; hashes do not establish signer trust. Keep discovery and build-only legacy addon fallback separate."
    }
  ],
  "hasScopeIn": [
    {
      "@id": "urn:atomic:scope:01m533zxykmdgh2spqzk3s99bk-scope-in-1",
      "@type": "ScopeItem",
      "text": "nodeatomic runtime resolution/loading, generated contract fingerprint, packaging/build copying, loader tests and documentation."
    }
  ],
  "hasScopeOut": [
    {
      "@id": "urn:atomic:scope:01m533zxykmdgh2spqzk3s99bk-scope-out-1",
      "@type": "ScopeItem",
      "text": "Atomic's release matrix or native producer, installers/self-update, Catalyst bundling or extension settings, Marketplace publication, new CPU targets, and a general protobuf backward-compatibility algorithm."
    }
  ],
  "hasTask": [
    {
      "@id": "urn:atomic:task:01M533ZXYKMDGH2SPQZK3S99BK-1",
      "@type": "Task",
      "satisfies": [
        "urn:atomic:ac:01M533ZXYKMDGH2SPQZK3S99BK-ac-1"
      ],
      "taskStatus": "done",
      "text": "Implement a shared platform-aware runtime loader, bind runtime calls to the generated descriptor fingerprint, preserve explicit producer/codegen tooling, add loader tests and document installed-runtime discovery and package boundaries.",
      "touchesFile": [
        "ts/native.ts",
        "ts/runtime/loader.mjs",
        "scripts/addon.mjs",
        "scripts/generate-proto.mjs",
        "scripts/copy-generated.mjs",
        "test/runtime.test.mjs",
        "test/loading.test.mjs",
        "README.md"
      ]
    }
  ],
  "humanKey": "NODE::continuouslee::1",
  "priority": "medium",
  "proof": {
    "@type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "proofPurpose": "assertionMethod",
    "proofValue": "zfE1RsyFEDgYCKtYPDjdpqBKCigucfuqRDvuqoN7NTAMJNCA7YRUTjiGDY6MaEsU8HLntAHd7B97HCHQwcM64M1v",
    "verificationMethod": "did:atomic:U4NNGFTE7KZZKRML6TQDBJJMOMKDCEHZO64IKHGACVRYGZOQSH5Q#key-1"
  },
  "status": "in_progress",
  "title": "Load the installed Atomic native runtime by host platform and architecture",
  "view": "dev",
  "why": "Atomic installations now distribute Node-enabled platform libraries with release metadata. nodeatomic should load that installed runtime by host OS/CPU, enabling a future universal Catalyst VSIX without bundling native binaries or requiring compilation on user machines."
}
