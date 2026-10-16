---
createdAt: 2026-10-16T19:52:50Z
derivedFrom: ["urn:atomic:ac:01M533ZXYKMDGH2SPQZK3S99BK-ac-1","urn:atomic:intent:01M533ZXYKMDGH2SPQZK3S99BK"]
memoryKind: decision
status: active
uid: 01m534cejkpwcd9kx7sk66ct2d
entry_type: memory
content_hash: NU3V2XNMNJATD6VDOWHVQSPJYYCDOXCVUI6VLXE3LYOADTOUZY4A
created_at: 2026-10-16T19:52:50.042640+00:00
updated_at: 2026-10-16T19:52:50.042640+00:00
---
nodeatomic gates an installed libatomic against the SHA-256 of the full protobuf descriptor used to generate its codecs, rather than assuming matching OS/CPU or a semver label proves wire compatibility. The installed manifest is checked before dlopen and the actual descriptor is checked afterward. This intentionally rejects additive descriptor changes until the consumer is regenerated; a semantic backward-compatibility algorithm is deferred. Imports remain lazy, and build-only explicitly installed developer artifacts are not an implicit public runtime fallback.
