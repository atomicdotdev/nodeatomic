import { copyFileSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Consume an explicit binary. Never build, download, or discover Atomic source.
const supplied = process.argv[2] ?? process.env.LIBATOMIC_ADDON;
if (!supplied) {
  console.error('Supply a prebuilt addon: LIBATOMIC_ADDON=/path/to/libatomic.node npm run install:addon');
  process.exit(1);
}
const source = resolve(supplied);
const directory = fileURLToPath(new URL('../native/', import.meta.url));
const destination = resolve(directory, 'libatomic.node');
const temporary = resolve(directory, `.libatomic-${randomUUID()}.node`);
try {
  if (!statSync(source).isFile()) throw new Error('addon must be a regular file');
  mkdirSync(directory, { recursive: true });
  let installed;
  try { installed = realpathSync(destination); } catch { /* Not installed yet. */ }
  if (realpathSync(source) !== installed) {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  }
  console.log(`Installed prebuilt addon: ${destination}`);
} catch (error) {
  console.error(`Cannot install addon from ${source}: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true });
}
