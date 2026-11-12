import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { AtomicRuntimeError, loadAddon, resolveRuntime } from '../ts/runtime/loader.mjs';

const descriptor = Buffer.from('fixture protobuf descriptor');
const bytes = Buffer.from('fixture library');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cases = [
  { platform: 'darwin', arch: 'arm64', target: 'aarch64-apple-darwin', library: 'libatomic.dylib' },
  { platform: 'linux', arch: 'x64', libc: 'glibc', target: 'x86_64-unknown-linux-gnu', library: 'libatomic.so' },
  { platform: 'win32', arch: 'x64', target: 'x86_64-pc-windows-msvc', library: 'libatomic.dll' },
];

function fixture(t, spec = cases[0]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nodeatomic-runtime-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = join(root, 'installation with spaces');
  const cwd = join(root, 'workspace');
  mkdirSync(install);
  mkdirSync(cwd);
  const path = join(install, spec.library);
  const manifestPath = join(install, 'libatomic-runtime.json');
  writeFileSync(path, bytes);
  const manifest = {
    schemaVersion: 1, version: '0.19.1', revision: 'a'.repeat(40),
    platform: spec.platform, arch: spec.arch, target: spec.target, library: spec.library,
    nodeApiVersion: 8, librarySha256: hash(bytes), descriptorSha256: hash(descriptor),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const executable = join(install, spec.platform === 'win32' ? 'atomic.exe' : 'atomic');
  writeFileSync(executable, 'not executed');
  chmodSync(executable, 0o755);
  const addon = { call: async () => Buffer.alloc(0), descriptor: () => descriptor };
  let loads = 0;
  const options = {
    env: { ATOMIC_RUNTIME_DIR: install }, cwd,
    host: { ...spec, nodeApiVersion: 8 },
    expectedDescriptorSha256: hash(descriptor),
    load: (file) => {
      assert.equal(readFileSync(file, 'utf8'), bytes.toString());
      loads += 1;
      return addon;
    },
  };
  return { root, install, cwd, path, manifest, manifestPath, executable, addon, options, loads: () => loads };
}

function rejectsCode(operation, code) {
  assert.throws(operation, (error) => error instanceof AtomicRuntimeError && error.code === code);
}

function writeRecord(state, body) {
  mkdirSync(join(state, 'atomic'), { recursive: true });
  writeFileSync(join(state, 'atomic', 'install.json'), JSON.stringify(body));
  return state;
}

test('a registered installation is discovered without PATH or environment configuration', (t) => {
  const f = fixture(t);
  const env = { XDG_STATE_HOME: writeRecord(join(f.root, 'state'), { schema_version: 1, source: 'official-installer', runtime_dir: f.install }) };
  assert.equal(resolveRuntime({ ...f.options, env }).path, f.path);
  assert.equal(loadAddon({ ...f.options, env }), f.addon);
  assert.equal(f.loads(), 1);
});

test('a record without runtime_dir is a CLI-only install, not a registration', (t) => {
  const f = fixture(t);
  const env = { XDG_STATE_HOME: writeRecord(join(f.root, 'state'), { schema_version: 1, source: 'official-installer' }), PATH: f.install };
  assert.equal(resolveRuntime({ ...f.options, env }).path, f.path);
});

test('a broken registration is a hard error and never falls through to PATH', (t) => {
  const f = fixture(t, cases.find((spec) => spec.platform === process.platform));
  const broken = join(f.root, 'registered-but-empty');
  mkdirSync(broken);
  const env = { XDG_STATE_HOME: writeRecord(join(f.root, 'state'), { schema_version: 1, runtime_dir: broken }), PATH: f.install };
  rejectsCode(() => loadAddon({ ...f.options, env }), 'ATOMIC_RUNTIME_MANIFEST');
  assert.equal(f.loads(), 0);
});

test('a registration cannot point at relative paths or an unreadable record', (t) => {
  const f = fixture(t);
  rejectsCode(() => loadAddon({ ...f.options, env: { XDG_STATE_HOME: writeRecord(join(f.root, 'a'), { runtime_dir: 'relative/dir' }) } }), 'ATOMIC_RUNTIME_CONFIGURATION');
  const state = join(f.root, 'b');
  mkdirSync(join(state, 'atomic'), { recursive: true });
  writeFileSync(join(state, 'atomic', 'install.json'), '{broken');
  rejectsCode(() => loadAddon({ ...f.options, env: { XDG_STATE_HOME: state } }), 'ATOMIC_RUNTIME_CONFIGURATION');
  assert.equal(f.loads(), 0);
});

test('explicit configuration still outranks a registration', (t) => {
  const f = fixture(t);
  const broken = join(f.root, 'stale-registration');
  mkdirSync(broken);
  const env = { ATOMIC_RUNTIME_DIR: f.install, XDG_STATE_HOME: writeRecord(join(f.root, 'state'), { runtime_dir: broken }) };
  assert.equal(loadAddon({ ...f.options, env }), f.addon);
});

for (const spec of cases) {
  test(`selects and verifies ${spec.target} with no CLI subprocess`, (t) => {
    const f = fixture(t, spec);
    assert.equal(resolveRuntime(f.options).path, f.path);
    assert.equal(loadAddon(f.options), f.addon);
    assert.equal(f.loads(), 1);
  });

  test(`finds ${spec.library} beside the first Atomic executable on PATH`, { skip: process.platform === 'win32' && spec.platform !== 'win32' }, (t) => {
    const f = fixture(t, spec);
    assert.equal(resolveRuntime({ ...f.options, env: { PATH: f.install } }).path, f.path);
    assert.equal(loadAddon({ ...f.options, env: { ATOMIC_BIN: f.executable } }), f.addon);
  });
}

test('supports Windows Path casing and quoted PATH entries', (t) => {
  const f = fixture(t, cases[2]);
  assert.equal(resolveRuntime({ ...f.options, env: { Path: `.;"${f.install}"` } }).path, f.path);
});

test('resolves Atomic executable symlinks to their versioned installation', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  symlinkSync(f.executable, join(bin, 'atomic'));
  assert.equal(resolveRuntime({ ...f.options, env: { PATH: bin } }).path, f.path);
});

test('does not scan cwd, relative PATH entries, or executable symlinks into cwd', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'atomic'), 'workspace command');
  chmodSync(join(f.cwd, 'atomic'), 0o755);
  writeFileSync(join(f.cwd, f.manifest.library), bytes);
  writeFileSync(join(f.cwd, 'libatomic-runtime.json'), JSON.stringify(f.manifest));
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  symlinkSync(join(f.cwd, 'atomic'), join(bin, 'atomic'));
  for (const PATH of ['', '.', ':.:relative', f.cwd, bin]) {
    rejectsCode(() => loadAddon({ ...f.options, env: { PATH } }), 'ATOMIC_RUNTIME_NOT_FOUND');
  }
  assert.equal(f.loads(), 0);
});

test('never falls through a missing/invalid active installation to another CLI', (t) => {
  const f = fixture(t, cases.find((spec) => spec.platform === process.platform));
  const first = join(f.root, 'first');
  mkdirSync(first);
  writeFileSync(join(first, basename(f.executable)), 'old CLI');
  chmodSync(join(first, basename(f.executable)), 0o755);
  const delimiter = f.options.host.platform === 'win32' ? ';' : ':';
  rejectsCode(() => loadAddon({ ...f.options, env: { PATH: `${first}${delimiter}${f.install}` } }), 'ATOMIC_RUNTIME_MANIFEST');
  rejectsCode(() => loadAddon({ ...f.options, env: { ATOMIC_RUNTIME_DIR: first, PATH: f.install } }), 'ATOMIC_RUNTIME_MANIFEST');
  rejectsCode(() => loadAddon({ ...f.options, env: { ATOMIC_BIN: join(first, 'missing'), PATH: f.install } }), 'ATOMIC_RUNTIME_NOT_FOUND');
  assert.equal(f.loads(), 0);
});

test('rejects relative and conflicting explicit configuration', (t) => {
  const f = fixture(t);
  for (const env of [
    { ATOMIC_RUNTIME_DIR: '.' }, { LIBATOMIC_ADDON: './libatomic.node' }, { ATOMIC_BIN: 'atomic' },
    { ATOMIC_RUNTIME_DIR: f.install, LIBATOMIC_ADDON: f.path },
    { LIBATOMIC_ADDON: join(f.install, 'addon.js') },
  ]) {
    rejectsCode(() => loadAddon({ ...f.options, env }), 'ATOMIC_RUNTIME_CONFIGURATION');
  }
  assert.equal(f.loads(), 0);
});

test('unsupported OS/CPU/libc and Node-API versions fail before loading', (t) => {
  const f = fixture(t);
  for (const host of [
    { platform: 'darwin', arch: 'x64', nodeApiVersion: 8 },
    { platform: 'linux', arch: 'arm64', libc: 'glibc', nodeApiVersion: 8 },
    { platform: 'linux', arch: 'x64', libc: 'musl', nodeApiVersion: 8 },
    { platform: 'win32', arch: 'arm64', nodeApiVersion: 8 },
  ]) {
    rejectsCode(() => loadAddon({ ...f.options, host }), 'ATOMIC_UNSUPPORTED_PLATFORM');
  }
  rejectsCode(() => loadAddon({ ...f.options, host: { ...f.options.host, nodeApiVersion: 7 } }), 'ATOMIC_NODE_API_UNSUPPORTED');
  assert.equal(f.loads(), 0);
});

test('rejects malformed, wrong-platform and path-traversing manifests before loading', (t) => {
  const f = fixture(t);
  for (const patch of [
    { schemaVersion: 2 }, { platform: 'linux' }, { arch: 'x64' }, { target: 'wrong-target' },
    { library: '../libatomic.dylib' }, { version: '' }, { revision: 'abc' },
    { nodeApiVersion: 9 }, { librarySha256: 'bad' }, { descriptorSha256: 'bad' },
  ]) {
    writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, ...patch }));
    rejectsCode(() => loadAddon(f.options), 'ATOMIC_RUNTIME_MANIFEST');
  }
  writeFileSync(f.manifestPath, '{broken');
  rejectsCode(() => loadAddon(f.options), 'ATOMIC_RUNTIME_MANIFEST');
  assert.equal(f.loads(), 0);
});

test('checks binary integrity and generated contract before dlopen', (t) => {
  const f = fixture(t);
  writeFileSync(f.path, 'tampered');
  rejectsCode(() => loadAddon(f.options), 'ATOMIC_RUNTIME_INTEGRITY');
  writeFileSync(f.path, bytes);
  rejectsCode(() => loadAddon({ ...f.options, expectedDescriptorSha256: hash('other contract') }), 'ATOMIC_RUNTIME_CONTRACT');
  rejectsCode(() => loadAddon({ ...f.options, expectedDescriptorSha256: 'invalid' }), 'ATOMIC_RUNTIME_CONTRACT');
  assert.equal(f.loads(), 0);
});

test('verifies loaded descriptor against both manifest and generated fingerprint', (t) => {
  const f = fixture(t);
  rejectsCode(() => loadAddon({ ...f.options, load: () => ({ ...f.addon, descriptor: () => Buffer.from('different') }) }), 'ATOMIC_RUNTIME_CONTRACT');
  rejectsCode(() => loadAddon({ ...f.options, load: () => ({ ...f.addon, descriptor: () => Buffer.alloc(0) }) }), 'ATOMIC_RUNTIME_CONTRACT');
  rejectsCode(() => loadAddon({ ...f.options, load: () => ({ call() {} }) }), 'ATOMIC_RUNTIME_EXPORTS');
  rejectsCode(() => loadAddon({ ...f.options, load: () => ({ ...f.addon, descriptor() { throw new Error('bad descriptor'); } }) }), 'ATOMIC_RUNTIME_CONTRACT');
  const cause = new Error('wrong CPU type');
  assert.throws(() => loadAddon({ ...f.options, load: () => { throw cause; } }),
    (error) => error.code === 'ATOMIC_RUNTIME_LOAD' && error.cause === cause && /node feature/.test(error.message));
});

test('explicit development artifacts work without metadata but still check the generated contract', (t) => {
  const f = fixture(t);
  rmSync(f.manifestPath);
  const options = { ...f.options, env: { LIBATOMIC_ADDON: f.path } };
  assert.equal(loadAddon(options), f.addon);
  rejectsCode(() => loadAddon({ ...options, expectedDescriptorSha256: hash('other') }), 'ATOMIC_RUNTIME_CONTRACT');
  // Automatic installation discovery never grants that development exception.
  rejectsCode(() => loadAddon(f.options), 'ATOMIC_RUNTIME_MANIFEST');
});

test('an explicit addon cannot bypass an adjacent manifest', (t) => {
  const f = fixture(t);
  const other = join(f.install, 'other.node');
  writeFileSync(other, bytes);
  rejectsCode(() => loadAddon({ ...f.options, env: { LIBATOMIC_ADDON: other } }), 'ATOMIC_RUNTIME_MANIFEST');
  writeFileSync(f.path, 'tampered');
  rejectsCode(() => loadAddon({ ...f.options, env: { LIBATOMIC_ADDON: f.path } }), 'ATOMIC_RUNTIME_INTEGRITY');
  assert.equal(f.loads(), 0);
});

test('missing libraries produce actionable runtime errors before loading', (t) => {
  const f = fixture(t);
  rmSync(f.path);
  rejectsCode(() => loadAddon(f.options), 'ATOMIC_RUNTIME_LOAD');
  rejectsCode(() => loadAddon({ ...f.options, env: { LIBATOMIC_ADDON: f.path } }), 'ATOMIC_RUNTIME_MANIFEST');
  assert.equal(f.loads(), 0);
});
