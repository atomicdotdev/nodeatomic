import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nodeatomic-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  for (const name of ['install-addon.mjs', 'addon.mjs']) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  return root;
}
function install(root, source, args = []) {
  const env = { ...process.env, PATH: '', ATOMIC_SOURCE: '/nonexistent' };
  delete env.LIBATOMIC_ADDON;
  if (source !== undefined) env.LIBATOMIC_ADDON = source;
  return spawnSync(process.execPath, [join(root, 'scripts/install-addon.mjs'), ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 10_000,
  });
}

test('addon installation requires an explicit binary, never a source checkout', async (t) => {
  const root = await fixture(t);
  const result = install(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Supply a prebuilt addon/);
});

test('copies an explicit artifact without a toolchain and reuses it safely', async (t) => {
  const root = await fixture(t);
  const source = join(root, 'artifact.dylib');
  // Unit-test binary copying only; the integration suite loads a real addon.
  const bytes = Buffer.from('artifact bytes');
  await writeFile(source, bytes);
  const result = install(root, source);
  assert.equal(result.status, 0, result.stderr);
  const installed = join(root, 'native/libatomic.node');
  assert.deepEqual(await readFile(installed), bytes);
  const reused = install(root, installed);
  assert.equal(reused.status, 0, reused.stderr);
  assert.deepEqual(await readFile(installed), bytes);
});

test('accepts a path argument and does not replace the installed artifact on missing input', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'artifact.node'), 'original');
  assert.equal(install(root, undefined, ['artifact.node']).status, 0);
  const failed = install(root, join(root, 'missing'));
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Cannot install addon/);
  assert.equal(await readFile(join(root, 'native/libatomic.node'), 'utf8'), 'original');
});

test('missing addon fails clearly instead of trying to compile Atomic', async (t) => {
  const root = await fixture(t);
  const module = pathToFileURL(join(root, 'scripts/addon.mjs')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { loadAddon } from ${JSON.stringify(module)};
    loadAddon();
  `], { cwd: root, env: { ...process.env, PATH: '', ATOMIC_SOURCE: '/nonexistent' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing native\/libatomic.node/);
  assert.match(result.stderr, /does not build Atomic/);
});
