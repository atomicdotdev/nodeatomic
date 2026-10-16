import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { test } from 'node:test';
import { call, proto, status } from '../dist/index.js';

const atomic = process.env.ATOMIC_BIN ?? 'atomic';
const env = { ...process.env, ATOMIC_SERVICE: 'local', ATOMIC_RPC: '0' };
function cli(root, ...args) {
  return execFileSync(atomic, args, { cwd: root, env, encoding: 'utf8' });
}
async function fixture(t, view = 'test') {
  const root = await mkdtemp(join(tmpdir(), 'nodeatomic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  cli(root, 'init', '--no-vault', '--view', view, '.');
  await writeFile(join(root, '.atomicignore'), 'ignored/\nnode_modules/\n');
  return root;
}
const entries = (files) => files.map(({ path, status }) => ({ path, status }))
  .sort((a, b) => a.path.localeCompare(b.path));

// These deliberately point RPC routing at a nonexistent endpoint. The addon
// must still work, since it calls handlers directly rather than a client.
process.env.ATOMIC_SERVICE = 'reactor';
process.env.ATOMIC_DAEMON_SOCKET = '/nonexistent/nodeatomic-test.sock';

test('matches atomic status for untracked and added files', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'untracked.txt'), 'hello\n');
  await writeFile(join(root, 'added.txt'), 'tracked\n');
  cli(root, 'add', 'added.txt');
  const expected = JSON.parse(cli(root, 'status', '--json'));
  const actual = await status(root);
  assert.equal(actual.view, expected.view);
  assert.equal(actual.needsReindex, expected.needs_reindex);
  assert.equal(actual.staleIndexCount, expected.stale_index_count);
  assert.deepEqual(entries(actual.files), entries(expected.entries));
  assert.equal(actual.addedCount, 1);
  assert.equal(actual.files.find((file) => file.path === 'untracked.txt')?.status, 'untracked');
  // A writable CLI open immediately after the native query also checks that
  // status didn't retain a database handle.
  cli(root, 'add', 'untracked.txt');
});

test('honors .atomicignore for nested dependencies and build artifacts', async (t) => {
  const root = await fixture(t);
  for (const directory of ['node_modules/package', 'ignored/nested']) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, 'artifact.txt'), 'ignored\n');
  }
  await writeFile(join(root, 'visible.txt'), 'visible\n');
  const result = await status(root);
  assert.equal(result.files.find((file) => file.path === 'visible.txt')?.status, 'untracked');
  assert.ok(!result.files.some((file) => file.path.startsWith('node_modules/') || file.path.startsWith('ignored/')));
});

test('reports modified and deleted recorded files', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'modified.txt'), 'before\n');
  await writeFile(join(root, 'deleted.txt'), 'before\n');
  cli(root, 'add', 'modified.txt', 'deleted.txt');
  cli(root, 'record', '-m', 'test baseline', '--author', 'Nodeatomic Test <test@example.com>', 'modified.txt', 'deleted.txt');
  await writeFile(join(root, 'modified.txt'), 'after\n');
  await rm(join(root, 'deleted.txt'));
  const result = await status(root);
  assert.equal(result.files.find((file) => file.path === 'modified.txt')?.status, 'modified');
  assert.equal(result.files.find((file) => file.path === 'deleted.txt')?.status, 'deleted');
  const expected = JSON.parse(cli(root, 'status', '--json'));
  assert.deepEqual(entries(result.files), entries(expected.entries));
});

test('uses the generated protobuf contract through the native byte boundary', async (t) => {
  const root = await fixture(t);
  const resolved = proto.ResolveRepositoryResponse.decode(await call(
    '/atomic.DaemonService/ResolveRepository',
    proto.ResolveRepositoryRequest.encode({ path: root }).finish(),
  ));
  assert.ok(resolved.repository.repositoryId.length > 0);
  const response = proto.StatusResponse.decode(await call(
    '/atomic.RepositoryQueryService/Status',
    proto.StatusRequest.encode({ repository: resolved.repository }).finish(),
  ));
  assert.equal(response.view, 'test');
  await assert.rejects(call('/atomic.Unknown/Method', new Uint8Array()), /not supported/i);
  await assert.rejects(call('/atomic.DaemonService/ResolveRepository', new Uint8Array([255])), /invalid protobuf/i);
  await assert.rejects(call('/atomic.RepositoryQueryService/Status', new Uint8Array()), /repository reference is required/i);
});

test('resolves nested paths and observes updates between calls', async (t) => {
  const root = await fixture(t);
  const nested = join(root, 'nested');
  await mkdir(nested);
  await writeFile(join(nested, 'hello.txt'), 'one\n');
  const first = await status(nested);
  await writeFile(join(nested, 'hello.txt'), 'two\n');
  const second = await status(join(nested, 'hello.txt'));
  const hash = (result) => result.files.find((file) => file.path === 'nested/hello.txt').currentHash;
  assert.match(hash(first), /^[0-9a-f]{64}$/);
  assert.notEqual(hash(first), hash(second));
});

test('queries do not modify the repository database', async (t) => {
  const root = await fixture(t);
  const db = join(root, '.atomic', 'atomic.redb');
  const digest = async () => createHash('sha256').update(await readFile(db)).digest('hex');
  const before = await digest();
  await status(root);
  assert.equal(await digest(), before);
});

test('supports concurrent calls and routes different repositories separately', async (t) => {
  const a = await fixture(t, 'alpha');
  const b = await fixture(t, 'beta');
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => status(i % 2 ? b : a)));
  assert.deepEqual(results.map((result) => result.view), ['alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta']);
});

test('supports Node worker threads', async (t) => {
  const root = await fixture(t);
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const query = () => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.moduleUrl).then(async ({ status }) => {
        parentPort.postMessage(await status(workerData.root));
      }).catch(error => { throw error; });
    `, { eval: true, workerData: { moduleUrl, root } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error('worker exited: ' + code)); });
  });
  const results = await Promise.all([query(), query(), status(root)]);
  assert.ok(results.every((result) => result.view === 'test'));
});

test('rejects invalid paths and paths outside repositories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nodeatomic-not-repo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(status(root), /not.*found|repository/i);
  await assert.rejects(status(join(root, 'missing')), /not.*found|No such file/i);
  await assert.rejects(status(''), TypeError);
  await assert.rejects(status(42), TypeError);
});
