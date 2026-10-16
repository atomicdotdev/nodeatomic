import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { call, openRepository, proto } from '../dist/index.js';

const config = await mkdtemp(join(tmpdir(), 'nodeatomic-identities-'));
process.env.ATOMIC_CONFIG_DIR = config;
process.env.ATOMIC_SERVICE = 'reactor';
process.env.ATOMIC_DAEMON_SOCKET = '/nonexistent/nodeatomic-vault.sock';
after(() => rm(config, { recursive: true, force: true }));
const env = { ...process.env, ATOMIC_SERVICE: 'local', ATOMIC_RPC: '0' };
const atomic = process.env.ATOMIC_BIN ?? 'atomic';
const cli = (root, ...args) => execFileSync(atomic, args, { cwd: root, env, encoding: 'utf8' });
const digest = async (root) => createHash('sha256')
  .update(await readFile(join(root, '.atomic/atomic.redb'))).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nodeatomic-vault-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  cli(root, 'init', '--vault', '.');
  cli(root, 'intent', 'new', 'Editor integration fixture');
  return { root, repo: await openRepository(root) };
}

test('reads stored vault entries, intents and context without mutating the database', async (t) => {
  const { root, repo } = await fixture(t);
  const before = await digest(root);
  const listing = await repo.vault.listIntents();
  assert.equal(listing.entries.length, 1);
  const id = listing.entries[0].id;
  const result = await repo.vault.getIntent(id);
  assert.equal(result.entry.title, 'Editor integration fixture');
  assert.equal(result.entryBundle.schema, 'atomic.vault.entry.bundle.v1');
  const bundle = JSON.parse(Buffer.from(result.entryBundle.payload).toString('utf8'));
  assert.equal(JSON.parse(bundle.entry.frontmatter_json).title, result.entry.title);
  const all = await repo.vault.list();
  assert.ok(all.entries.length >= 1);
  const context = await repo.vault.context({ maxEntries: 1 });
  assert.ok(context.entries.length <= 1);
  assert.equal(await digest(root), before);
  assert.equal(result.snapshot, null); // No false claim of view isolation.
  await assert.rejects(repo.vault.get({ id, kind: proto.VaultEntityKind.VAULT_ENTITY_KIND_INTENT,
    view: { name: 'other' } }), /view-scoped vault reads are not available/);
  await assert.rejects(repo.vault.list({ cursor: { seq: 1 } }), /continuation cursors/);
  await assert.rejects(call('/atomic.VaultService/CreateVaultEntity', new Uint8Array()), /not supported/);
  for (const method of ['GetVaultEntry', 'ListVaultEntries', 'GetVaultContext']) {
    await assert.rejects(call(`/atomic.VaultService/${method}`, new Uint8Array()), /repository reference is required/);
  }
});

test('returns a stored signed intent using only public identity data', async (t) => {
  const { root, repo } = await fixture(t);
  cli(root, 'identity', 'new', 'fixture-signer', '--set-default');
  const id = (await repo.vault.listIntents()).entries[0].id;
  cli(root, 'intent', 'attest', id, '--identity', 'fixture-signer');
  const path = `attestations/${id.replace(/[^A-Za-z0-9_-]/g, '_')}/attested.md`;
  const stored = await repo.vault.get({ path });
  const signed = JSON.parse(stored.entry.body);
  // Remove fixture secrets before the library call. Public identities remain.
  for (const entry of await readdir(join(config, 'identities'), { withFileTypes: true })) {
    if (entry.isDirectory()) await rm(join(config, 'identities', entry.name, 'secret.key'), { force: true });
  }
  const before = await digest(root);
  const response = await repo.vault.getSignedIntent(id);
  assert.equal(response.valid, true);
  assert.equal(response.signatureValid, true);
  assert.equal(response.sourceFresh, true);
  assert.deepEqual(JSON.parse(response.signedDocument), signed);
  assert.match(response.signerDid, /^did:atomic:/);
  assert.equal(Buffer.from(response.signedRevision.value).length, 32);
  assert.equal(await digest(root), before);
  const unknown = await repo.vault.getSignedIntent(id, { identityName: 'missing-identity' });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.signatureValid == null);
  assert.equal(unknown.sourceFresh, true);
  assert.equal(unknown.signedDocument, response.signedDocument);
  await assert.rejects(repo.vault.getSignedIntent(id, { publicKey: new Uint8Array(1) }), /32 bytes/);
});

test('reports missing attestations and refuses malformed subjects without CLI fallback', async (t) => {
  const { repo } = await fixture(t);
  const id = (await repo.vault.listIntents()).entries[0].id;
  await assert.rejects(repo.vault.getSignedIntent(id), /no stored attestation/);
  await assert.rejects(repo.vault.getSignedIntent(''), TypeError);
  await assert.rejects(repo.attestations.verify({ intentId: id, memoryId: 'memory' }), /exactly one/);
  await assert.rejects(call('/atomic.AttestationService/VerifyAttestation', new Uint8Array()), /repository reference is required/);
});
