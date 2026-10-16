import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAddon as loadRuntime } from '../ts/runtime/loader.mjs';

export function loadAddon() {
  const env = { ...process.env };
  // Build-only compatibility with the explicitly invoked install:addon tool.
  // Public runtime calls never search this package-local native directory.
  const developmentAddon = fileURLToPath(new URL('../native/libatomic.node', import.meta.url));
  if (!env.ATOMIC_RUNTIME_DIR && !env.LIBATOMIC_ADDON && !env.ATOMIC_BIN && existsSync(developmentAddon)) {
    env.LIBATOMIC_ADDON = developmentAddon;
  }
  return loadRuntime({ env });
}
