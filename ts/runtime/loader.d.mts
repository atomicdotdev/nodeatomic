export interface NativeAddon {
  call(method: string, request: Buffer): Promise<Buffer>;
  descriptor(): Buffer;
}
export interface RuntimeHost {
  platform: string;
  arch: string;
  nodeApiVersion: number;
  libc?: string;
}
export interface RuntimeManifest {
  schemaVersion: 1;
  version: string;
  revision: string;
  target: string;
  platform: string;
  arch: string;
  nodeApiVersion: number;
  library: string;
  librarySha256: string;
  descriptorSha256: string;
}
export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  host?: RuntimeHost;
  cwd?: string;
  expectedDescriptorSha256?: string;
  load?: (path: string) => NativeAddon;
}
export class AtomicRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown);
}
export function resolveRuntime(options?: RuntimeOptions): { path: string; manifest?: RuntimeManifest };
export function loadAddon(options?: RuntimeOptions): NativeAddon;
