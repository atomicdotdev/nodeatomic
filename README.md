# nodeatomic

A TypeScript/JavaScript package that dynamically loads **Atomic's installed
Node-enabled libatomic**, selected by the Node/Electron host's OS and CPU.
All Rust code—including the Node-API exports—lives in the separate Atomic
project. This project has no Cargo manifest, Rust sources, or Rust lockfile.

No atomicd, RPC connection, or service process is required.

## Load an installed Atomic runtime

Requires Node 18+ with Node-API 8+. Supported native release targets are:

| Host OS / CPU | Installed library | Rust target |
| --- | --- | --- |
| macOS ARM64 | `libatomic.dylib` | `aarch64-apple-darwin` |
| Linux x64 glibc | `libatomic.so` | `x86_64-unknown-linux-gnu` |
| Windows x64 | `libatomic.dll` | `x86_64-pc-windows-msvc` |

Intel Macs, Linux ARM64, Alpine/musl and Windows ARM64 are not supported by the
current native release matrix. Selection uses `process.platform` and
`process.arch` of the **extension host**, not the user's desktop. Remote SSH,
WSL and containers need Atomic installed in the remote environment.

Install the complete matching Atomic release archive in a versioned directory,
keeping the executable, library and `libatomic-runtime.json` together. The loader
uses this order:

1. **`ATOMIC_RUNTIME_DIR`**: an explicit absolute installation-directory path;
   requires release metadata.
2. **`LIBATOMIC_ADDON`**: an explicit absolute library path, primarily for
   development/CI. Do not set it together with `ATOMIC_RUNTIME_DIR`.
3. **`ATOMIC_BIN`**: an explicit absolute Atomic executable path; load the runtime
   beside its resolved executable, following symlinks.
4. Otherwise, find the **first Atomic executable on PATH** (`atomic.exe` on
   Windows), resolve its symlinks, and load the adjacent runtime.

For example:

```sh
ATOMIC_RUNTIME_DIR=/absolute/path/to/atomic/v0.19.1 node my-app.mjs
```

Discovery reads files only: it never executes the CLI, invokes Cargo, downloads
anything, discovers an Atomic source checkout, or picks an arbitrary "latest"
version. Empty/relative PATH entries, the current working directory and executable
paths inside it are excluded from automatic discovery. PATH is an installation
trust boundary: launch with a trusted PATH, not workspace-controlled executable
directories. Explicit overrides deliberately identify a trusted artifact and can
point into a developer checkout.

An invalid explicit/active installation is a hard error; the loader never silently
tries a different installation or a package-bundled binary. Missing installations
report how to install Atomic or configure `ATOMIC_RUNTIME_DIR`. Errors expose a
stable `code` through the exported `AtomicRuntimeError` class.

### Validation and compatibility

Before loading a distributed runtime, nodeatomic checks its manifest schema,
release identity fields, OS/CPU/target, Node-API requirement, library filename,
binary SHA-256, and descriptor fingerprint. It loads the platform suffix directly
with `process.dlopen` and verifies `call()` / `descriptor()` exports and the actual
descriptor checksum. The full descriptor **must exactly match** the descriptor
used to generate this nodeatomic build. Even an additive schema change currently
requires regenerating/updating the consumer; OS/CPU matching alone is not enough.
The JSON metadata and checksums are not signatures or independent signer trust.

Explicit development artifacts may lack a manifest, but still must load on this
host, expose the Node API, and match the generated descriptor at runtime. If an
adjacent manifest exists, the override cannot bypass its checks.

Importing nodeatomic or using its protobuf codecs does not load native code. The
first Atomic operation loads and validates the library; successful loads are
cached for the process. Restart the extension host after an Atomic runtime update.
Install new versions side by side; never overwrite a library that an editor may
have mapped. A failed discovery attempt is not cached, so explicit configuration
can be corrected before retrying.

The distributable npm package contains JavaScript/types/codecs, **not native
binaries**. Catalyst's existing build script still bundles its own native addon;
removing that bundle and wiring installation guidance into the extension remain
separate work. External Atomic installers/self-update must also preserve the
runtime files; older CLI-only installations are not sufficient.

## Build with a prebuilt producer artifact

**This package never invokes Cargo, discovers an Atomic
checkout, or builds native code.** Its inputs are a compiled addon and its own
JavaScript dependencies. The projects need not be siblings.

```sh
cd ~/Projects/nodeatomic
npm ci
LIBATOMIC_ADDON=/path/to/prebuilt/libatomic.node npm run install:addon
npm run build
LIBATOMIC_ADDON=/absolute/path/to/prebuilt/libatomic.node npm run status -- /path/to/repository
```

Alternatively, pass the artifact path as an argument:

```sh
npm run install:addon -- /path/to/prebuilt/libatomic.node
```

`install:addon` is a build/development convenience: it copies the supplied file to
`native/libatomic.node`; it never compiles or downloads anything. The artifact must
match the host OS/architecture
and be built with libatomic's `node` feature. On macOS it can be the unrenamed
`liblibatomic.dylib`; on Linux `liblibatomic.so`; on Windows `libatomic.dll`.
Changing its extension to `.node` doesn't change the binary's contents.

`npm run build` uses the shared loader, generates protobuf codecs/types and a full
descriptor fingerprint, then compiles TypeScript. The build-only helper can use
`native/libatomic.node` if it was explicitly copied by `install:addon` and no
runtime/CLI override is configured. Public runtime calls do not use this fallback.
Set `ATOMIC_RUNTIME_DIR` or `LIBATOMIC_ADDON` during build to select a specific
producer explicitly. The addon must include the basic
mutation/query/view protobuf contract and the corresponding LocalService dispatch;
an older addon cannot serve these methods. A missing addon fails with installation
instructions rather than attempting a source build. An incompatible addon fails
while loading. `LIBATOMIC_ADDON` now selects an explicit artifact for runtime and
code generation too; it does not implicitly install or rebuild anything.
Restart processes using the addon before replacing it.

## Build the producer separately (local development only)

If you don't already have a binary, build it explicitly in the **Atomic project**:

```sh
cd ~/Projects/atomic
cargo build --locked -p libatomic --features node
export LIBATOMIC_ADDON=~/Projects/atomic/target/debug/liblibatomic.dylib
```

Then consume it in this project. Example for macOS:

```sh
cd ~/Projects/nodeatomic
npm run install:addon
npm run build
```

Only the producer step requires Rust or Atomic's source. No Rust files live here.
An optimized producer build uses Cargo's `--release`. Atomic owns native platform
distribution; release hardening (including panic behavior) and actual
Node/Electron host testing remain production release gates.

## CI boundary

Atomic CI owns compiling/testing the addon. Consumer CI supplies a specific
already-built artifact or complete runtime directory, runs `npm ci`, and builds
with `LIBATOMIC_ADDON` or `ATOMIC_RUNTIME_DIR` set. An explicit `install:addon`
step is optional for local code generation only.
No Rust toolchain or Atomic source checkout is needed for the consumer build.
Artifact publishing/downloading is not implemented here; CI must supply a pinned
producer. Runtime manifest/hash checks validate that supplied installation, not
the authenticity of a download. For tests:

```sh
npm run test:runtime # resolver/build-tool unit tests; no native library required
ATOMIC_RUNTIME_DIR=/absolute/path/to/atomic-install npm test
```

The full suite also needs the Atomic CLI on PATH (or an absolute `ATOMIC_BIN`)
to create temporary fixtures. Repository operations under test remain in-process.

## API

```ts
import { status } from 'nodeatomic';

const result = await status('/absolute/path/to/repository');
console.log(result.view);
for (const file of result.files) console.log(file.status, file.path);
```

In this checkout, import `./dist/index.js` directly. `status()` defaults to cwd;
relative paths are resolved in the calling Node context. An existing nested file
or directory is accepted. The implementation never changes process cwd.

The convenience result has view/Merkle information, reindex flags, per-file
statuses, and modified/deleted/untracked/added/conflicted/stale-index counts.
Hashes are lowercase hex, not the CLI's shortened/base32 presentation. Absent
optional values are `undefined` and omitted by `JSON.stringify`.

### Repository operations (in-process)

```ts
import { openRepository } from 'nodeatomic';

const repo = await openRepository('/absolute/path/to/repository');
await repo.add(['src/main.ts']);
const status = await repo.status(); // raw protobuf StatusResponse
const recorded = await repo.record('Implement feature', { paths: ['src/main.ts'] });
const history = await repo.log({ view: status.view, budget: { maxItems: 20 } });
const detail = await repo.change({ hash: recorded.change!.hash!.value },
  { includes: { metadata: true } });
const views = await repo.views.list();
await repo.views.create('feature', { empty: true });
await repo.views.switch('feature');
// Switch away before deleting; the current view cannot be deleted.
await repo.views.switch(status.view);
await repo.views.delete('feature');
```

`repo.add` requires explicit paths (there is no add-all flag in this RPC).
`repo.change(ref, { includes: { metadata: true } })` returns `metadata` with
schema version 1, the source change hash, recorded AI model/tool/request/session
fields, all six token counters, exact `costMicroUsd`, and recorded affected paths.
This projection is produced from atomic-core's decoded change; JavaScript does
not parse the opaque V3 bundle. Prompts, reasoning text/signatures and arbitrary
provider metadata are not included. An older addon may return no projection;
absence is not zero usage. Counters and micro-USD are generated uint64/Long values:
use strings or BigInt for arithmetic, never lossy Number conversion. Repeated
request identities may cover several changes; consumers must deduplicate and
surface conflicts rather than blindly summing per-change totals. A record's
index is only local to its change, and session IDs alone are not usage identities.

`metadata.graphSummary` carries the native `atomic change` graph report:
`verticesAdded`, `edgesChanged`, `contentBytes`, `filesChanged`, and `files`
rows with `symbol`, `path`, `info`. These are computed with the same Rust helpers
as the CLI, including per-path hunk aggregation and native ordering. Counters are
uint64/Long values; content bytes are the uncompressed change content, not the
serialized bundle size. Root ops may have a `(root)` row but do not count as
files. Render row strings as text, not HTML. A missing summary means an older
producer; a present zero summary means no graph operations. No bundle parsing,
graph traversal, CLI subprocess or client-side hunk reconstruction is needed.

For a single-change blast radius, opt in with
`repo.change({ hash }, { includes: { blastRadius: true } })`. `blastRadius`
contains the source hash, distinct `{ path, hop }` files (direct edits at hop 1,
incoming callers/importers at hop 2), actual `CALLS`/`INCLUDES` file edges, mode,
warnings and context. Rust compares recorded before/after sources and queries
the current repository KG without writing/enriching or reading working-copy
source. This is **not a historical or view-isolated dependency snapshot**.
`partial` is not a private change or proof of no downstream impact. Unsupported
parsers, unavailable content/KG, ambiguous entities and limits remain explicit.
There is no co-change fallback, probabilistic score or frontend binary decoder.

`await repo.recordedFile('src/main.ts')` returns `{ content, view }` for the
current working-copy view's recorded graph content, not on-disk or unsaved bytes.
This exposes the existing read-only `PreviewRestore`/`pristine_content` read; it
does **not** call restore, untrack or any mutation. A missing `content` is not an
empty file; a present zero-length buffer is an empty recorded file. Consumers
must check the observed `view` before labeling the baseline. Invalid/escaping
paths are rejected. An older producer may omit the observed view.

`GetChange` file contents also carry optional `beforeExists`/`afterExists` and
`isDirectory`. An explicitly false existence flag is a known absent diff side;
an omitted flag plus absent payload means unavailable/older producer, not an
empty revision. Present payloads (including zero-length ones) remain usable
from older producers. Editor consumers should not fabricate empty panes on
reconstruction failures or decode binary bytes as lossy text.

`GetChange` with `includes.metadata=true` also returns `intentContext` (schema 1,
bound to `changeHash`). `planId` is one known recorded governing reference;
`plans` retains each actual value and its `provenance_graph`/`session_turn`
source, session ID, stored provenance hash and matched zero-based turn. A turn
must match both the selected change hash and covering provenance identity.
Atomic resolves current UID/human-key aliases and returns current title/source
path metadata. `status` is `recorded`, `missing`, `ambiguous` or `partial`—it is
not a conformance result. Ambiguous governors are retained, not arbitrarily picked.

`associatedIntents` separately describes intent documents actually edited by the
change, including `committed_via` commitment/patch node evidence when present.
Those edits and intent-creation session links **never synthesize a planId**.
Legacy changes may legitimately have a null plan ID and an associated intent.
`validationStatus` is currently `not_checked`; no SHACL, signature or global
one-to-one proof is performed. Missing metadata is not a validation failure.
The query is read-only and does not backfill or rewrite old provenance.

`repo.record` requires a message and accepts the protobuf `expected` fence for
optimistic concurrency. View switching refuses dirty working copies unless
`bypassDirtyCheck` is explicitly requested. `repo.change` accepts a 32-byte hash,
a unique prefix, or a view-log sequence (`{ sequence: entry.sequence }`); use
`{ view: { name } }` for sequence lookup in a particular view. Options and
responses follow the generated protobuf contract: hashes are bytes, counters
may be `Long` values, and missing optional fields may be null. No command
spawns the CLI or connects to a daemon.

### Use the canonical messages directly

```ts
import { call, proto } from 'nodeatomic';

const resolved = proto.ResolveRepositoryResponse.decode(await call(
  '/atomic.DaemonService/ResolveRepository',
  proto.ResolveRepositoryRequest.encode({ path: '/work/project' }).finish(),
));
const response = proto.StatusResponse.decode(await call(
  '/atomic.RepositoryQueryService/Status',
  proto.StatusRequest.encode({ repository: resolved.repository }).finish(),
));
console.log(response.view);
```

The local dispatcher supports **ResolveRepository, Status, AddFiles, Record, Log,
GetChange, ListViews, CreateView, SwitchView, DeleteView, GetVaultEntry,
ListVaultEntries, GetVaultContext, and VerifyAttestation**. Vault mutations,
attestation creation, and other methods fail explicitly. Message codecs and TypeScript declarations are
generated from the descriptor embedded in the actual loaded libatomic addon.
There is no copied `.proto` tree, hand-written native status schema, or system
protoc requirement. Generated files live under `ts/generated/` and are copied
into `dist/`; they are build products, not another source of truth.

The gRPC-style method paths identify in-process function calls, not network RPCs.
The protobuf definitions do not require an RPC transport.

## Read-only vault API

```ts
import { openRepository } from 'nodeatomic';

const repo = await openRepository('/path/to/repository');
const intents = await repo.vault.listIntents();
const intent = await repo.vault.getIntent('CATA::continuouslee::2');
const allEntries = await repo.vault.list();
const context = await repo.vault.context({ query: ['native bindings'], maxEntries: 10 });
const signed = await repo.vault.getSignedIntent('CATA::continuouslee::2');

// Present facts separately. Neither one establishes signer trust.
console.log(signed.signatureValid, signed.sourceFresh, signed.signerDid);
// Exact stored signed JSON-LD; not a lift of an editable buffer.
console.log(signed.signedDocument);
```

`vault.get({ path: 'memory/example.md' })` reads a vault-relative path.
`vault.get`, `vault.list`, and `vault.context` accept generated request properties
without a repository reference; the resolved client supplies its own reference.
They return generated protobuf responses rather than CLI-formatted text. Missing
optional fields in these raw responses may be `null`.

`attestations.verify({ intentId: id }, { publicKey })` also supports an explicit
32-byte Ed25519 public key. Without it, the backend resolves the proof's signer
from an **existing public identity**, not the default private signing key.
`identityName` is an optional public-identity lookup hint and cannot be combined
with `publicKey`. No secret key is loaded or identity store initialized.

- `signatureValid === true`: the stored signed document's signature verifies.
- `signatureValid === false`: verification was performed and failed.
- `signatureValid == null`: verification couldn't be performed, e.g. unknown key.
- `sourceFresh`: separately compares the signed source anchor with the stored vault
  source; **not** with unsaved editor text or changed-but-unsynced disk files.
- `valid`: compatibility field, true only when both facts above are true.
- `signedRevision`: hash of the exact stored signed-document bytes.

A stale source can still have a valid historical signature. Unknown signer trust
must remain unknown. Malformed signed documents fail closed; no CLI, legacy
sidecar, signing, or filesystem fallback is used by this verification operation.
`getIntent()` requests the existing backend's raw-entry bundle for inspection;
its bundle is not itself a verification result.

**View-scoped vault reads are not yet implemented by the storage layer.** These
operations are repository-wide and return no ViewSnapshot. Any explicit `view`
request is rejected rather than silently ignored. Continuation cursors are also
rejected until implemented. This API enables vault access without the CLI; it does
not yet satisfy Catalyst's full view-isolation/snapshot acceptance criterion.

## Responsibility boundary

```text
nodeatomic (TypeScript + generated protobuf codecs)
  -> native/libatomic.node (compiled by the Atomic project)
  -> libatomic::LocalService
  -> existing libatomic handlers
  -> redb
```

Atomic owns both `libatomic/src/node.rs` (Node-API exports) and
`libatomic/src/local.rs` (local dispatch). Neither implementation resides here.
Its `node` feature is optional for ordinary Rust consumers.

The service shares routing state and gates across calls and Node worker threads,
but it does not retain open databases. libatomic executes database work on its
Tokio blocking pool and drops repository handles per call. No close method is
needed for a resolved `AtomicRepository` reference.

Invalid paths, non-repositories, malformed protobuf, unknown methods, and
contention timeouts reject the promise. `ATOMIC_SERVICE` and
`ATOMIC_DAEMON_SOCKET` do not select a backend here: calls are always local.

## Existing service behavior

The Status handler uses normal default options: untracked files are included,
but ignored untracked files are excluded according to `.atomicignore` and global
ignore rules. Already-tracked files remain subject to status checks. Filtering
happens in Atomic before ignored file contents are read or hashed, not in this
TypeScript wrapper. This package does not add reindexing or CLI presentation flags.

The earlier handler incorrectly used `StatusOptions::all()` and scanned ignored
dependencies/build artifacts; that behavior is fixed and covered by regression
tests. This correction is not a general Git-like performance claim.

redb's cross-process locks still apply. A writer in another process can delay
queries; libatomic uses its bounded wait controlled by `ATOMIC_DB_LOCK_WAIT_MS`
(currently defaults to 30 seconds). Existing upgrade/repair behavior can write
when recovery is necessary. Healthy queries are tested not to modify the DB.
This work does not evaluate redb v5 or change database topology.

## Tests

```sh
# After installing the addon:
npm test
ATOMIC_BIN=/path/to/atomic npm test
# Native service tests, in the Atomic project:
cd ~/Projects/atomic
cargo test --locked -p libatomic --test local_service_test
```

The integration tests require an installed Atomic CLI binary (`ATOMIC_BIN` or
`atomic` on PATH) only for temporary fixture setup, comparison, and verifying
that queries release handles. They do not compile it or require its source.
They configure an unusable daemon endpoint to ensure no service is needed; the
query itself never executes the CLI. Build-boundary tests run with an empty PATH
to prove that artifact installation/missing-addon errors don't need a toolchain.

The npm package is private. Crate publication, npm publication, prebuilt platform
packages, other methods, and stable error codes are not implemented here.
