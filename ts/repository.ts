import { resolve } from 'node:path';
import { call, proto } from './native.js';
import type { atomic as Contract } from './generated/proto.cjs';

export type GetVaultOptions = Omit<Contract.GetVaultEntryRequest.$Properties, 'repository'>;
export type ListVaultOptions = Omit<Contract.ListVaultEntriesRequest.$Properties, 'repository'>;
export type VaultContextOptions = Omit<Contract.GetVaultContextRequest.$Properties, 'repository'>;
export type VerificationOptions = Pick<Contract.VerifyAttestationRequest.$Properties, 'identityName' | 'publicKey' | 'view'>;
export type AddOptions = Omit<Contract.AddFilesRequest.$Properties, 'repository' | 'paths'>;
export type RecordOptions = Omit<Contract.RecordRequest.$Properties, 'repository' | 'message'>;
export type LogOptions = Omit<Contract.LogRequest.$Properties, 'repository'>;
export type ChangeOptions = Omit<Contract.GetChangeRequest.$Properties, 'repository' | 'ref'>;
export type ChangeMetadata = Contract.ChangeMetadata;
export type ChangeAIUsage = Contract.ChangeAIUsage;
export type ChangeTokenUsage = Contract.ChangeTokenUsage;
export type ChangeGraphSummary = Contract.ChangeGraphSummary;
export type ChangeFileSummary = Contract.ChangeFileSummary;
export type ChangeBlastRadius = Contract.ChangeBlastRadius;
export type ChangeImpactFile = Contract.ChangeImpactFile;
export type ChangeImpactEdge = Contract.ChangeImpactEdge;
export type ChangeIntentContext = Contract.ChangeIntentContext;
export type ChangePlanBinding = Contract.ChangePlanBinding;
export type ChangeIntentIdentity = Contract.ChangeIntentIdentity;
export type ChangeIntentAssociation = Contract.ChangeIntentAssociation;
export type StatusOptions = Contract.StatusOptions.$Properties;
export type ListViewsOptions = Omit<Contract.ListViewsRequest.$Properties, 'repository'>;
export type CreateViewOptions = Omit<Contract.CreateViewRequest.$Properties, 'repository' | 'name'>;
export type SwitchViewOptions = Omit<Contract.SwitchViewRequest.$Properties, 'repository' | 'view'>;
export type DeleteViewOptions = Omit<Contract.DeleteViewRequest.$Properties, 'repository' | 'view'>;
/** A full binary hash, an unambiguous base32 prefix, or a view-log sequence. */
export type ChangeReference = { hash: Uint8Array } | { prefix: string } |
  { sequence: NonNullable<Contract.ChangeRef.$Properties['sequence']> };

function requireId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) throw new TypeError('a non-empty subject id is required');
}

function requireName(name: string): void {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('a non-empty view name is required');
}

/** A routing reference, not an open database. No close() is required.
 * Vault reads are currently repository-wide; explicit view selection fails
 * closed until the backend implements view-scoped vault revisions.
 */
export class AtomicRepository {
  constructor(
    readonly reference: Contract.RepositoryRef,
    readonly workspace: Contract.WorkspaceInfo | undefined,
  ) {}

  /** Track explicit working-copy paths; no implicit add-all or CLI fallback. */
  async add(paths: string[], options: AddOptions = {}): Promise<Contract.AddFilesResponse> {
    if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !p.trim())) {
      throw new TypeError('add requires at least one non-empty path');
    }
    return proto.AddFilesResponse.decode(await call('/atomic.RepositoryMutationService/AddFiles',
      proto.AddFilesRequest.encode({ ...options, paths, repository: this.reference }).finish()));
  }

  /** Publish a change. Pass expected for optimistic concurrency when available. */
  async record(message: string, options: RecordOptions = {}): Promise<Contract.RecordResponse> {
    if (typeof message !== 'string' || !message.trim()) throw new TypeError('record requires a non-empty message');
    return proto.RecordResponse.decode(await call('/atomic.RepositoryMutationService/Record',
      proto.RecordRequest.encode({ ...options, message, repository: this.reference }).finish()));
  }

  /** Working-copy status through the in-process query handler. */
  async status(options: StatusOptions = {}): Promise<Contract.StatusResponse> {
    return proto.StatusResponse.decode(await call('/atomic.RepositoryQueryService/Status',
      proto.StatusRequest.encode({ repository: this.reference, options }).finish()));
  }

  /** Paged change history; use the returned nextCursor for subsequent pages. */
  async log(options: LogOptions = {}): Promise<Contract.LogResponse> {
    return proto.LogResponse.decode(await call('/atomic.RepositoryQueryService/Log',
      proto.LogRequest.encode({ ...options, repository: this.reference }).finish()));
  }

  /** Get one change. includes.metadata returns a decoded, privacy-limited
   * metadata projection (including native graph/hunk summaries) alongside the canonical V3 bundle. uint64 counters and
   * micro-USD retain generated Long values; do not coerce them to JS numbers.
   */
  async change(ref: ChangeReference, options: ChangeOptions = {}): Promise<Contract.GetChangeResponse> {
    if (!ref || typeof ref !== 'object' || Object.keys(ref).length !== 1) {
      throw new TypeError('change requires exactly one hash, prefix, or sequence');
    }
    let reference: Contract.ChangeRef.$Properties;
    if ('hash' in ref && ref.hash instanceof Uint8Array && ref.hash.length === 32) {
      reference = { hash: { value: ref.hash } };
    } else if ('prefix' in ref && typeof ref.prefix === 'string' && ref.prefix.trim()) {
      reference = { prefix: ref.prefix };
    } else if ('sequence' in ref && (
      (typeof ref.sequence === 'number' && Number.isSafeInteger(ref.sequence) && ref.sequence >= 0) ||
      (typeof ref.sequence === 'object' && ref.sequence !== null &&
        Number.isInteger(ref.sequence.low) && Number.isInteger(ref.sequence.high) &&
        Number(ref.sequence.toString()) >= 0)
    )) {
      reference = { sequence: ref.sequence };
    } else {
      throw new TypeError('change requires a 32-byte hash, non-empty prefix, or non-negative safe sequence');
    }
    return proto.GetChangeResponse.decode(await call('/atomic.RepositoryQueryService/GetChange',
      proto.GetChangeRequest.encode({ ...options, ref: reference, repository: this.reference }).finish()));
  }

  /** Read the current working-copy view's recorded bytes. This uses the existing
   * read-only restore PREVIEW, never the restore mutation or the on-disk file.
   * Missing content is absent, not an empty file. The observed view is returned.
   */
  async recordedFile(path: string): Promise<{ content?: Uint8Array; view?: string }> {
    if (typeof path !== 'string' || !path.trim() || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('\\') ||
      path.split(/[\\/]/).some((part) => part === '..')) throw new TypeError('recordedFile requires a repository-relative path');
    const response = proto.PreviewMutationResponse.decode(await call('/atomic.RepositoryQueryService/PreviewRestore',
      proto.PreviewRestoreRequest.encode({ repository: this.reference, paths: [path], contentPath: path }).finish()));
    return { content: response.pristineContent ?? undefined, view: response.view ?? undefined };
  }

  readonly views = {
    list: async (options: ListViewsOptions = {}): Promise<Contract.ListViewsResponse> =>
      proto.ListViewsResponse.decode(await call('/atomic.ViewService/ListViews',
        proto.ListViewsRequest.encode({ ...options, repository: this.reference }).finish())),
    create: async (name: string, options: CreateViewOptions = {}): Promise<Contract.CreateViewResponse> => {
      requireName(name);
      const bases = [options.fromView, options.parent, options.empty].filter((v) => v != null);
      if (bases.length > 1) throw new TypeError('choose only one view base: fromView, parent, or empty');
      return proto.CreateViewResponse.decode(await call('/atomic.ViewService/CreateView',
        proto.CreateViewRequest.encode({ ...options, name, repository: this.reference }).finish()));
    },
    switch: async (name: string, options: SwitchViewOptions = {}): Promise<Contract.SwitchViewResponse> => {
      requireName(name);
      return proto.SwitchViewResponse.decode(await call('/atomic.ViewService/SwitchView',
        proto.SwitchViewRequest.encode({ ...options, view: name, repository: this.reference }).finish()));
    },
    delete: async (name: string, options: DeleteViewOptions = {}): Promise<Contract.DeleteViewResponse> => {
      requireName(name);
      return proto.DeleteViewResponse.decode(await call('/atomic.ViewService/DeleteView',
        proto.DeleteViewRequest.encode({ ...options, view: name, repository: this.reference }).finish()));
    },
  };

  readonly vault = {
    /** Equivalent stored-entry lookup to vault show / intent show / memory show. */
    get: async (options: GetVaultOptions): Promise<Contract.GetVaultEntryResponse> => {
      const bytes = await call('/atomic.VaultService/GetVaultEntry',
        proto.GetVaultEntryRequest.encode({ ...options, repository: this.reference }).finish());
      return proto.GetVaultEntryResponse.decode(bytes);
    },
    /** List stored entries; optional kind selects intent/memory/goal summaries. */
    list: async (options: ListVaultOptions = {}): Promise<Contract.ListVaultEntriesResponse> => {
      const bytes = await call('/atomic.VaultService/ListVaultEntries',
        proto.ListVaultEntriesRequest.encode({ ...options, repository: this.reference }).finish());
      return proto.ListVaultEntriesResponse.decode(bytes);
    },
    context: async (options: VaultContextOptions = {}): Promise<Contract.GetVaultContextResponse> => {
      const bytes = await call('/atomic.VaultService/GetVaultContext',
        proto.GetVaultContextRequest.encode({ ...options, repository: this.reference }).finish());
      return proto.GetVaultContextResponse.decode(bytes);
    },
    getIntent: async (id: string): Promise<Contract.GetVaultEntryResponse> => {
      requireId(id);
      return this.vault.get({ id, kind: proto.VaultEntityKind.VAULT_ENTITY_KIND_INTENT, includeBundle: true });
    },
    listIntents: async (): Promise<Contract.ListVaultEntriesResponse> =>
      this.vault.list({ kind: proto.VaultEntityKind.VAULT_ENTITY_KIND_INTENT }),
    /** Returns the exact stored signed JSON-LD and backend verification facts.
     * valid means signature-valid AND source-fresh. Use signatureValid and
     * sourceFresh separately; neither implies signer trust or buffer freshness.
     */
    getSignedIntent: async (id: string, options: VerificationOptions = {}): Promise<Contract.VerifyAttestationResponse> => {
      requireId(id);
      return this.attestations.verify({ intentId: id }, options);
    },
  };

  readonly attestations = {
    /** No signing, private-key access, or mutation. Public keys are 32 bytes.
     * Omitted publicKey resolves the proof's signer from existing public identities.
     * Unknown key yields absent signatureValid, not a proven-invalid signature.
     */
    verify: async (
      subject: Contract.AttestationTarget.$Properties,
      options: VerificationOptions = {},
    ): Promise<Contract.VerifyAttestationResponse> => {
      const targets = [subject.intentId, subject.memoryId, subject.changeHash, subject.graphStats]
        .filter((value) => value != null);
      if (targets.length !== 1) throw new TypeError('exactly one attestation subject is required');
      if (subject.intentId != null) requireId(subject.intentId);
      if (subject.memoryId != null) requireId(subject.memoryId);
      if (options.publicKey != null && options.identityName != null) {
        throw new TypeError('use publicKey or identityName, not both');
      }
      if (options.publicKey != null && !(options.publicKey instanceof Uint8Array)) {
        throw new TypeError('publicKey must be a Uint8Array');
      }
      if (options.publicKey != null && options.publicKey.length !== 32) {
        throw new TypeError('Ed25519 publicKey must be 32 bytes');
      }
      const bytes = await call('/atomic.AttestationService/VerifyAttestation',
        proto.VerifyAttestationRequest.encode({ ...options, subject, repository: this.reference }).finish());
      return proto.VerifyAttestationResponse.decode(bytes);
    },
  };
}

/** Resolve a repository once; calls use its reference without running Atomic CLI. */
export async function openRepository(path: string = process.cwd()): Promise<AtomicRepository> {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('repository path must be a non-empty string');
  const response = proto.ResolveRepositoryResponse.decode(await call(
    '/atomic.DaemonService/ResolveRepository',
    proto.ResolveRepositoryRequest.encode({ path: resolve(path) }).finish(),
  ));
  if (!response.repository) throw new Error('libatomic did not return a repository reference');
  return new AtomicRepository(proto.RepositoryRef.create(response.repository),
    response.workspace ? proto.WorkspaceInfo.create(response.workspace) : undefined);
}
