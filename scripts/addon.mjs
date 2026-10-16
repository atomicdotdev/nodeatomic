import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function loadAddon() {
  const path = fileURLToPath(new URL('../native/libatomic.node', import.meta.url));
  if (!existsSync(path)) {
    throw new Error('Missing native/libatomic.node. Run LIBATOMIC_ADDON=/path/to/prebuilt/addon npm run install:addon first. This package does not build Atomic.');
  }
  let addon;
  try {
    addon = require(path);
  } catch (error) {
    throw new Error(`Cannot load ${path}. Supply an addon built for this OS/architecture with libatomic's node feature. ${error.message}`, { cause: error });
  }
  if (typeof addon.call !== 'function' || typeof addon.descriptor !== 'function') {
    throw new Error('The supplied addon must export call() and descriptor().');
  }
  return addon;
}
