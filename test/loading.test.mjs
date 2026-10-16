import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const entry = new URL('../dist/index.js', import.meta.url).href;
const isolatedEnv = () => {
  const env = { ...process.env, PATH: '' };
  for (const key of ['ATOMIC_RUNTIME_DIR', 'LIBATOMIC_ADDON', 'ATOMIC_BIN']) delete env[key];
  return env;
};

test('public imports and codecs work without Atomic; the first operation reports an installation error', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { call, proto, AtomicRuntimeError } = await import(${JSON.stringify(entry)});
    assert.ok(proto.StatusRequest.encode({}).finish() instanceof Uint8Array);
    await assert.rejects(call(null, new Uint8Array()), TypeError);
    await assert.rejects(call('/atomic.Unknown/Unknown', new Uint8Array()),
      e => e instanceof AtomicRuntimeError && e.code === 'ATOMIC_RUNTIME_NOT_FOUND');
  `], { env: isolatedEnv(), encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

test('failed discovery can be retried and successful runtime loading is cached', {
  skip: !process.env.ATOMIC_RUNTIME_DIR,
}, () => {
  const env = isolatedEnv();
  env.FIXTURE_RUNTIME_DIR = process.env.ATOMIC_RUNTIME_DIR;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { call } = await import(${JSON.stringify(entry)});
    const invoke = () => call('/atomic.Unknown/Unknown', new Uint8Array());
    await assert.rejects(invoke(), e => e.code === 'ATOMIC_RUNTIME_NOT_FOUND');
    process.env.ATOMIC_RUNTIME_DIR = process.env.FIXTURE_RUNTIME_DIR;
    await assert.rejects(invoke(), /Unimplemented|unimplemented|Unknown/);
    process.env.ATOMIC_RUNTIME_DIR = '/nonexistent/runtime';
    await assert.rejects(invoke(), /Unimplemented|unimplemented|Unknown/);
  `], { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
});

test('loads the real platform library beside Atomic on PATH without executing the CLI', {
  skip: !process.env.ATOMIC_RUNTIME_DIR,
}, (t) => {
  const installation = mkdtempSync(join(tmpdir(), 'nodeatomic-installed-runtime-'));
  t.after(() => rmSync(installation, { recursive: true, force: true }));
  const source = process.env.ATOMIC_RUNTIME_DIR;
  const manifestPath = join(source, 'libatomic-runtime.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  copyFileSync(manifestPath, join(installation, 'libatomic-runtime.json'));
  copyFileSync(join(source, manifest.library), join(installation, manifest.library), constants.COPYFILE_FICLONE);
  const executable = join(installation, process.platform === 'win32' ? 'atomic.exe' : 'atomic');
  // Deliberately not a runnable CLI. Native dispatch must never spawn it.
  writeFileSync(executable, 'this executable must not run');
  chmodSync(executable, 0o755);
  const env = { ...isolatedEnv(), PATH: installation };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { call } = await import(${JSON.stringify(entry)});
    await assert.rejects(call('/atomic.Unknown/Unknown', new Uint8Array()), /Unimplemented|unimplemented|Unknown/);
  `], { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
});
