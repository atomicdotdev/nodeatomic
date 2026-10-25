import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAddon } from './addon.mjs';

const require = createRequire(import.meta.url);
const protobuf = require('protobufjs');
require('protobufjs/ext/descriptor');
const pbjs = require('protobufjs-cli/pbjs');
const pbts = require('protobufjs-cli/pbts');
const native = loadAddon();
const descriptor = native.descriptor();
const root = protobuf.Root.fromDescriptor(descriptor).resolveAll();
// Generate only the supported methods' messages and their referenced types.
// The full descriptor remains owned by libatomic, not by this package.
const needed = new Set();
function visit(type) {
  if (needed.has(type)) return;
  needed.add(type);
  if (type instanceof protobuf.Type) {
    for (const field of type.fieldsArray) {
      if (field.resolvedType) visit(field.resolvedType);
    }
  }
}
for (const name of [
  'ResolveRepositoryRequest', 'ResolveRepositoryResponse', 'StatusRequest', 'StatusResponse',
  'AddFilesRequest', 'AddFilesResponse', 'RecordRequest', 'RecordResponse',
  'LogRequest', 'LogResponse', 'GetChangeRequest', 'GetChangeResponse',
  'PreviewRestoreRequest', 'PreviewMutationResponse',
  'ListViewsRequest', 'ListViewsResponse', 'CreateViewRequest', 'CreateViewResponse',
  'SwitchViewRequest', 'SwitchViewResponse', 'DeleteViewRequest', 'DeleteViewResponse',
  'GetVaultEntryRequest', 'GetVaultEntryResponse', 'ListVaultEntriesRequest', 'ListVaultEntriesResponse',
  'GetVaultContextRequest', 'GetVaultContextResponse', 'VerifyAttestationRequest', 'VerifyAttestationResponse',
  'QueryGraphRequest', 'QueryGraphResponse',
  'GetProjectIdentityRequest', 'GetProjectIdentityResponse',
  'GetWorkflowSnapshotRequest', 'GetWorkflowSnapshotResponse',
  'KGNode', 'KGEdge', 'CodeCaller',
  'NeighborsQuery', 'CallersQuery', 'GraphSliceQuery',
  'MaintainKnowledgeGraphRequest', 'MaintainKnowledgeGraphResponse',
]) {
  let type;
  try {
    type = root.lookupType(`atomic.${name}`);
  } catch {
    throw new Error(`Installed libatomic addon is missing atomic.${name}; install a producer build with basic LocalService dispatch support`);
  }
  visit(type);
}
const contract = { nested: {} };
for (const type of needed) {
  let namespace = contract;
  for (const name of type.parent.fullName.split('.').filter(Boolean)) {
    namespace.nested ??= {};
    namespace = namespace.nested[name] ??= { nested: {} };
  }
  namespace.nested[type.name] = type.toJSON();
}
const destination = fileURLToPath(new URL('../ts/generated/', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'nodeatomic-proto-'));
const run = (tool, args) => new Promise((resolve, reject) => {
  tool.main(args, (error, output) => error ? reject(error) : resolve(output));
});
try {
  mkdirSync(destination, { recursive: true });
  const schema = join(scratch, 'contract.json');
  writeFileSync(schema, JSON.stringify(contract));
  const source = await run(pbjs, ['--target', 'static-module', '--wrap', 'commonjs', '--no-service', schema]);
  const generated = join(destination, 'proto.cjs');
  writeFileSync(generated, source);
  writeFileSync(join(destination, 'proto.d.cts'), await run(pbts, [generated]));
  const hash = createHash('sha256').update(descriptor).digest('hex');
  writeFileSync(join(destination, 'runtime-contract.ts'), `// Generated from the producer's full embedded descriptor.\nexport const descriptorSha256 = '${hash}';\n`);
  console.log('Generated JS and TypeScript types from libatomic\'s embedded protobuf contract.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
