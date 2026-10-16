import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRepository, proto } from '../dist/index.js';

const atomic = process.env.ATOMIC_BIN ?? 'atomic';
const fixtureEnv = { ...process.env, ATOMIC_SERVICE: 'local', ATOMIC_RPC: '0' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nodeatomic-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // The CLI is used only to provision the fixture; all operations under test
  // go through the native protobuf boundary.
  execFileSync(atomic, ['init', '--no-vault', '--view', 'test', '.'], {
    cwd: root, env: fixtureEnv, encoding: 'utf8',
  });
  return { root, repo: await openRepository(root) };
}

process.env.ATOMIC_SERVICE = 'reactor';
process.env.ATOMIC_DAEMON_SOCKET = '/nonexistent/nodeatomic-bridge.sock';

test('native add, status, record, log and change operate on the same repository', async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, 'hello.txt'), 'hello\n');
  const preview = await repo.add(['hello.txt'], { dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.ok(preview.wouldAdd.includes('hello.txt'));
  assert.equal((await repo.status()).files.find((f) => f.path === 'hello.txt')?.status,
    proto.FileStatus.FILE_STATUS_UNTRACKED);
  const added = await repo.add(['hello.txt']);
  assert.equal(added.tracked, 1);
  assert.equal((await repo.status()).files.find((f) => f.path === 'hello.txt')?.status,
    proto.FileStatus.FILE_STATUS_ADDED);
  const recorded = await repo.record('native bridge', { paths: ['hello.txt'] });
  const hash = recorded.change?.hash?.value;
  assert.equal(hash?.length, 32);
  const history = await repo.log({ view: recorded.view, budget: { maxItems: 10 } });
  const entry = history.entries.find((item) => item.message === 'native bridge');
  assert.ok(entry);
  assert.deepEqual(Buffer.from(entry.hash.value), Buffer.from(hash));
  const byHash = await repo.change({ hash }, { includes: { metadata: true } });
  assert.equal(byHash.change?.message, 'native bridge');
  assert.ok(byHash.changeBundle?.payload?.length > 0);
  const bySequence = await repo.change({ sequence: entry.sequence },
    { view: { name: recorded.view } });
  assert.equal(bySequence.change?.message, 'native bridge');
  await assert.rejects(repo.change({ hash: new Uint8Array(4) }), TypeError);
  await assert.rejects(repo.record(''), TypeError);
  await assert.rejects(repo.add([]), TypeError);
});

test('native view list/create/switch/delete return protobuf responses', async (t) => {
  const { repo } = await fixture(t);
  const before = await repo.views.list();
  const original = before.views.find((view) => view.current)?.name;
  assert.ok(original);
  const created = await repo.views.create('node-feature', { empty: true });
  assert.equal(created.view?.name, 'node-feature');
  await repo.views.switch('node-feature');
  assert.ok((await repo.views.list()).views.some((view) => view.name === 'node-feature' && view.current));
  await repo.views.switch(original);
  await repo.views.delete('node-feature');
  assert.ok(!(await repo.views.list()).views.some((view) => view.name === 'node-feature'));
  await assert.rejects(repo.views.create(''), TypeError);
  await assert.rejects(repo.views.create('bad', { fromView: 'test', parent: 'test' }), TypeError);
});

test('GetChange metadata is decoded natively with exact counters, identities, paths and recorded zero', async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, 'ai.txt'), 'recorded AI work\n');
  await repo.add(['ai.txt']);
  const status = await repo.status();
  const recorded = await repo.record('AI metadata fixture', { paths: ['ai.txt'],
    expected: status.snapshot ? { viewSnapshot: status.snapshot } : { merkleRoot: status.viewMerkle },
    aiAuthorship: { provider: 'openai', model: 'fixture-model', tool: 'opencode',
      inputTokens: '9007199254740993', outputTokens: 7, requestId: 'fixture-request', sessionId: 'fixture-session' } });
  const hash = recorded.change.hash.value;
  const detail = await repo.change({ hash }, { includes: { metadata: true } });
  assert.equal(detail.changeBundle.schema, 'atomic.change.v3');
  assert.equal(detail.metadata.schemaVersion, 1);
  assert.deepEqual(Buffer.from(detail.metadata.changeHash.value), Buffer.from(hash));
  assert.deepEqual(detail.metadata.affectedPaths, ['ai.txt']);
  const usage = detail.metadata.usage[0];
  assert.equal(detail.metadata.usage.length, 1);
  assert.equal(usage.model, 'fixture-model');
  assert.match(usage.tool, /opencode/i);
  assert.equal(String(usage.tokens.inputTokens), '9007199254740993');
  assert.equal(String(usage.tokens.outputTokens), '7');
  assert.equal(String(usage.tokens.totalTokens), '9007199254741000');
  assert.equal(String(usage.costMicroUsd), '0');
  assert.equal(usage.requestId, 'fixture-request');
  assert.equal(usage.sessionId, 'fixture-session');
  assert.equal(detail.intentContext.schemaVersion, 1);
  assert.deepEqual(Buffer.from(detail.intentContext.changeHash.value), Buffer.from(hash));
  assert.equal(detail.intentContext.status, 'missing');
  assert.ok(detail.intentContext.planId == null);
  assert.equal(detail.intentContext.validationStatus, 'not_checked');
  assert.equal('prompt' in usage, false);
  assert.equal('reasoningText' in usage, false);
  const without = await repo.change({ hash });
  assert.ok(without.metadata == null);
  assert.ok(without.intentContext == null);
});

test('native graph/hunk summaries match atomic change for additions, edits and deletion', async (t) => {
  const { root, repo } = await fixture(t);
  const recordAndCompare = async (message) => {
    const status = await repo.status();
    const recorded = await repo.record(message, {
      expected: status.snapshot ? { viewSnapshot: status.snapshot } : { merkleRoot: status.viewMerkle },
    });
    const detail = await repo.change({ hash: recorded.change.hash.value }, { includes: { metadata: true } });
    const graph = detail.metadata?.graphSummary;
    assert.ok(graph, 'installed libatomic must expose graphSummary');
    const native = execFileSync(atomic, ['change'], { cwd: root,
      env: { ...fixtureEnv, NO_COLOR: '1', CLICOLOR: '0' }, encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(native.includes(`Graph: +${graph.verticesAdded} vertices, ~${graph.edgesChanged} edges, ${graph.contentBytes} bytes`), native);
    assert.ok(native.includes(`Files changed: ${graph.filesChanged}`), native);
    for (const row of graph.files) assert.ok(native.includes(`${row.symbol} ${row.path} ${row.info}`), native);
    return graph;
  };
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/hello.ts'), "console.log('hello');\n");
  await repo.add(['src/hello.ts']);
  const added = await recordAndCompare('native graph add');
  assert.ok(BigInt(String(added.verticesAdded)) > 0n);
  assert.ok(added.files.some((row) => row.path === 'src/hello.ts' && row.info.includes('vertices')));
  await writeFile(join(root, 'src/hello.ts'), "console.log('hello Alice');\nconsole.log('done');\n");
  const edited = await recordAndCompare('native graph edit');
  assert.ok(edited.files.some((row) => row.path === 'src/hello.ts'));
  await unlink(join(root, 'src/hello.ts'));
  const deleted = await recordAndCompare('native graph delete');
  assert.ok(BigInt(String(deleted.edgesChanged)) > 0n);
  assert.ok(deleted.files.some((row) => row.path === 'src/hello.ts' && row.symbol === '-'));
});

test('generated graph summary codec preserves uint64 precision and absence versus zero', () => {
  const summary = { verticesAdded: '18446744073709551615', edgesChanged: '9007199254740993', contentBytes: '0', filesChanged: '0', files: [] };
  const decoded = proto.ChangeGraphSummary.decode(proto.ChangeGraphSummary.encode(summary).finish());
  assert.equal(String(decoded.verticesAdded), summary.verticesAdded);
  assert.equal(String(decoded.edgesChanged), summary.edgesChanged);
  const empty = proto.ChangeMetadata.decode(proto.ChangeMetadata.encode({ graphSummary: { files: [] } }).finish());
  assert.ok(empty.graphSummary); assert.equal(String(empty.graphSummary.contentBytes), '0');
  assert.ok(proto.ChangeMetadata.decode(new Uint8Array()).graphSummary == null);
});

test('opt-in native blast radius is bound to one change and discloses missing structural coverage', async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, 'package.json'), '{"name":"impact-fixture"}\n');
  await repo.add(['package.json']);
  const status = await repo.status();
  const recorded = await repo.record('blast fixture', { paths: ['package.json'],
    expected: status.snapshot ? { viewSnapshot: status.snapshot } : { merkleRoot: status.viewMerkle } });
  const hash = recorded.change.hash.value;
  const detail = await repo.change({ hash }, { includes: { metadata: true, blastRadius: true } });
  const impact = detail.blastRadius;
  assert.ok(impact);
  assert.deepEqual(Buffer.from(impact.changeHash.value), Buffer.from(hash));
  assert.ok(impact.files.some((file) => file.path === 'package.json' && file.hop === 1));
  assert.equal(new Set(impact.files.map((file) => file.path)).size, impact.files.length);
  assert.equal(impact.mode, 'partial', 'Unsupported structural analysis is not a private change');
  assert.ok(impact.warnings.some((warning) => warning.includes('no structural parser')));
  assert.match(impact.context, /current repository KG.*not a historical/);
  assert.deepEqual(impact.edges, []);
  assert.ok((await repo.change({ hash })).blastRadius == null, 'analysis is opt-in');
});

test('recordedFile reads the view baseline rather than working bytes and never restores files', async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, 'baseline.txt'), 'recorded\n');
  await repo.add(['baseline.txt']);
  const status = await repo.status();
  const recorded = await repo.record('baseline file', { paths: ['baseline.txt'], expected: status.snapshot ? { viewSnapshot: status.snapshot } : { merkleRoot: status.viewMerkle } });
  const added = (await repo.change({ hash: recorded.change.hash.value }, { includeFileContents: true })).fileContents.find((file) => file.path === 'baseline.txt');
  assert.equal(added.beforeExists, false); assert.equal(added.afterExists, true); assert.equal(added.isDirectory, false);
  assert.equal(Buffer.from(added.after).toString('utf8'), 'recorded\n');
  await writeFile(join(root, 'baseline.txt'), 'working\n');
  const before = await repo.recordedFile('baseline.txt');
  assert.equal(Buffer.from(before.content).toString('utf8'), 'recorded\n');
  assert.equal(before.view, status.view);
  await unlink(join(root, 'baseline.txt'));
  assert.equal(Buffer.from((await repo.recordedFile('baseline.txt')).content).toString('utf8'), 'recorded\n');
  assert.equal((await repo.recordedFile('not-recorded.txt')).content, undefined);
  for (const path of ['../escape', '/absolute', 'C:\\escape', '..\\escape', '']) await assert.rejects(repo.recordedFile(path), TypeError);
  const deletedStatus = await repo.status();
  const deletion = await repo.record('delete baseline', { paths: ['baseline.txt'], expected: deletedStatus.snapshot ? { viewSnapshot: deletedStatus.snapshot } : { merkleRoot: deletedStatus.viewMerkle } });
  const removed = (await repo.change({ hash: deletion.change.hash.value }, { includeFileContents: true })).fileContents.find((file) => file.path === 'baseline.txt');
  assert.equal(removed.beforeExists, true); assert.equal(removed.afterExists, false);
  assert.equal(Buffer.from(removed.before).toString('utf8'), 'recorded\n'); assert.ok(removed.after == null);
});

test('generated typed plan context preserves recorded IDs, provenance sources and separate associations', () => {
  const value = { schemaVersion: 1, changeHash: { value: new Uint8Array(32).fill(1) }, planId: 'PLAN::author::1', status: 'recorded',
    plans: [{ planId: 'PLAN::author::1', source: 'session_turn', sessionId: 'session', turnNumber: 0,
      provenanceHash: { value: new Uint8Array(32).fill(2) }, intent: { id: 'PLAN::author::1', uid: 'UID', title: 'Work', path: '.vault/intents/UID/intent.md' } }],
    associatedIntents: [{ path: '.vault/intents/OTHER/intent.md', commitmentNodeIds: ['edit'], patchNodeIds: ['patch'], provenanceHashes: [] }],
    warnings: [], validationStatus: 'not_checked', context: 'Recorded declarations; current vault metadata.' };
  const decoded = proto.ChangeIntentContext.decode(proto.ChangeIntentContext.encode(value).finish());
  assert.equal(decoded.planId, value.planId); assert.equal(decoded.plans[0].source, 'session_turn'); assert.equal(decoded.plans[0].turnNumber, 0);
  assert.equal(decoded.associatedIntents[0].path, value.associatedIntents[0].path);
  assert.equal(decoded.validationStatus, 'not_checked');
});
