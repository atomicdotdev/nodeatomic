import { createRequire } from 'node:module';
import protocol from './generated/proto.cjs';

/** Codecs/types generated from the installed addon, not a separate schema. */
export const proto = protocol.atomic;

const require = createRequire(import.meta.url);
const native = require('../native/libatomic.node') as {
  call(method: string, request: Buffer): Promise<Buffer>;
};

/** Invoke a supported local service method without sockets or subprocesses. */
export async function call(method: string, request: Uint8Array): Promise<Uint8Array> {
  if (typeof method !== 'string' || !(request instanceof Uint8Array)) {
    throw new TypeError('call requires a method string and protobuf request bytes');
  }
  return native.call(method, Buffer.from(request));
}
