---
memoryId: 01m534cejkpwcd9kx7sk66ct2d
sourceContentHash: blake3:01b8df9ad9781c8c15a544d00cb2e6a7b44b347609ec215f8111a3221eb43543
entry_type: attestation
content_hash: 73SOBSTKLDR2HV2U5GIC3IZJIB7LXQHDYIIILXNWAOKTF6BKROCA
created_at: 2026-10-16T19:53:21.363939+00:00
updated_at: 2026-10-16T19:53:21.363939+00:00
---
{
  "@context": "https://atomic.dev/ns/ctx.jsonld",
  "@id": "urn:atomic:memory:01m534cejkpwcd9kx7sk66ct2d",
  "@type": "Memory",
  "attributedTo": "did:atomic:U4NNGFTE7KZZKRML6TQDBJJMOMKDCEHZO64IKHGACVRYGZOQSH5Q",
  "contentHash": "blake3:d48aeee62ad7157f89f39aa7cf8d6a1359a1940073b8b3beac1d1d31d204d383",
  "createdAt": "2026-10-16T19:52:50Z",
  "derivedFrom": [
    "urn:atomic:ac:01M533ZXYKMDGH2SPQZK3S99BK-ac-1",
    "urn:atomic:intent:01M533ZXYKMDGH2SPQZK3S99BK"
  ],
  "memoryKind": "decision",
  "proof": {
    "@type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "proofPurpose": "assertionMethod",
    "proofValue": "z5725USC2MoX58sH4eK3guijgVpxNMUwLRhuhkbqjzoAUr7XevYdBMLGfE7qaa5EKY5eTAaEKv4SVc33RqWd8cHPh",
    "verificationMethod": "did:atomic:U4NNGFTE7KZZKRML6TQDBJJMOMKDCEHZO64IKHGACVRYGZOQSH5Q#key-1"
  },
  "status": "active",
  "text": "nodeatomic gates an installed libatomic against the SHA-256 of the full protobuf descriptor used to generate its codecs, rather than assuming matching OS/CPU or a semver label proves wire compatibility. The installed manifest is checked before dlopen and the actual descriptor is checked afterward. This intentionally rejects additive descriptor changes until the consumer is regenerated; a semantic backward-compatibility algorithm is deferred. Imports remain lazy, and build-only explicitly installed developer artifacts are not an implicit public runtime fallback."
}
