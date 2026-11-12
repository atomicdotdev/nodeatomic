import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

const targets = {
  'darwin/arm64': { target: 'aarch64-apple-darwin', library: 'libatomic.dylib' },
  'linux/x64': { target: 'x86_64-unknown-linux-gnu', library: 'libatomic.so' },
  'win32/x64': { target: 'x86_64-pc-windows-msvc', library: 'libatomic.dll' },
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[0-9a-f]{64}$/;

export class AtomicRuntimeError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AtomicRuntimeError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new AtomicRuntimeError(code, message, cause);
}

function currentHost() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeApiVersion: Number(process.versions.napi ?? 0),
    libc: process.platform === 'linux'
      ? (process.report?.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined,
  };
}

function platformSpec(host) {
  const spec = targets[`${host.platform}/${host.arch}`];
  if (!spec || (host.platform === 'linux' && host.libc !== 'glibc')) {
    fail('ATOMIC_UNSUPPORTED_PLATFORM', `No Atomic Node runtime is supported for ${host.platform}/${host.arch}${host.platform === 'linux' ? `/${host.libc}` : ''}. Supported: macOS ARM64, Linux x64 glibc, Windows x64.`);
  }
  if (!Number.isInteger(host.nodeApiVersion) || host.nodeApiVersion < 8) {
    fail('ATOMIC_NODE_API_UNSUPPORTED', 'Atomic requires a Node/Electron host supporting Node-API 8 or newer.');
  }
  return spec;
}

function absolutePath(value, name) {
  if (!isAbsolute(value)) fail('ATOMIC_RUNTIME_CONFIGURATION', `${name} must be an absolute path, not ${JSON.stringify(value)}.`);
  return value;
}

function exists(path) {
  try { statSync(path); return true; }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    fail('ATOMIC_RUNTIME_IO', `Cannot inspect Atomic runtime path ${path}: ${error.message}`, error);
  }
}

function inside(path, directory) {
  const rel = relative(directory, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function readManifest(directory, host, spec) {
  const path = join(directory, 'libatomic-runtime.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    fail('ATOMIC_RUNTIME_MANIFEST', `Cannot read ${path}. Install an Atomic release containing the Node-enabled runtime, or set ATOMIC_RUNTIME_DIR to that installation directory. ${error.message}`, error);
  }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.platform !== host.platform
      || manifest.arch !== host.arch || manifest.target !== spec.target || manifest.library !== spec.library
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)
      || !/^[0-9a-f]{40}$/.test(manifest.revision)
      || !Number.isInteger(manifest.nodeApiVersion) || manifest.nodeApiVersion < 8
      || manifest.nodeApiVersion > host.nodeApiVersion
      || !digestPattern.test(manifest.librarySha256) || !digestPattern.test(manifest.descriptorSha256)) {
    fail('ATOMIC_RUNTIME_MANIFEST', `Invalid or incompatible runtime manifest ${path}; expected ${spec.target}, ${spec.library}, and a supported Node-API version.`);
  }
  return manifest;
}

function runtimeByExecutable(executable, host, spec) {
  let binary;
  try {
    binary = realpathSync(executable);
    if (!statSync(binary).isFile()) throw new Error('not a regular file');
  } catch (error) {
    fail('ATOMIC_RUNTIME_NOT_FOUND', `Cannot locate the Atomic executable ${executable}: ${error.message}`, error);
  }
  const directory = dirname(binary);
  return { path: join(directory, spec.library), manifest: readManifest(directory, host, spec) };
}

/** Location of the installer's machine record, mirroring the installer's own
 * resolution: `${XDG_STATE_HOME:-$HOME/.local/state}/atomic/install.json`. */
function installationRecordPath(env, host) {
  const state = env.XDG_STATE_HOME && env.XDG_STATE_HOME !== '' ? env.XDG_STATE_HOME : '';
  const home = env.HOME || (host.platform === 'win32' ? env.USERPROFILE : undefined) || '';
  const base = state || (home ? join(home, '.local', 'state') : '');
  return base ? join(base, 'atomic', 'install.json') : undefined;
}

/** The official installer registers the active complete runtime in its
 * installation record, so editors find it without PATH or environment setup.
 * A registration that exists but is broken is a hard error: silently loading a
 * different installation would hide the exact drift the registration prevents.
 * A record without `runtime_dir` is a CLI-only or legacy install — not a
 * registration — so discovery continues to PATH. */
function registeredRuntime(env, host, spec) {
  const record = installationRecordPath(env, host);
  if (!record || !exists(record)) return undefined;
  let parsed;
  try { parsed = JSON.parse(readFileSync(record, 'utf8')); }
  catch (error) {
    fail('ATOMIC_RUNTIME_CONFIGURATION', `Cannot parse the Atomic installation record ${record}. Re-run the Atomic installer to repair it: ${error.message}`, error);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.runtime_dir === undefined) return undefined;
  const directory = absolutePath(String(parsed.runtime_dir), `runtime_dir in ${record}`);
  return { path: join(directory, spec.library), manifest: readManifest(directory, host, spec), registered: record };
}

/** Resolve installation files only: never execute a CLI, search source trees,
 * choose a "latest" version directory, or fall back after a bad installation. */
export function resolveRuntime({ env = process.env, host = currentHost(), cwd = process.cwd() } = {}) {
  const spec = platformSpec(host);
  if (env.ATOMIC_RUNTIME_DIR && env.LIBATOMIC_ADDON) {
    fail('ATOMIC_RUNTIME_CONFIGURATION', 'Set ATOMIC_RUNTIME_DIR or LIBATOMIC_ADDON, not both.');
  }
  if (env.ATOMIC_RUNTIME_DIR) {
    const directory = absolutePath(env.ATOMIC_RUNTIME_DIR, 'ATOMIC_RUNTIME_DIR');
    return { path: join(directory, spec.library), manifest: readManifest(directory, host, spec) };
  }
  if (env.LIBATOMIC_ADDON) {
    const path = absolutePath(env.LIBATOMIC_ADDON, 'LIBATOMIC_ADDON');
    if (![extname(spec.library), '.node'].includes(extname(path))) {
      fail('ATOMIC_RUNTIME_CONFIGURATION', `LIBATOMIC_ADDON must be a ${extname(spec.library)} or .node artifact for ${spec.target}.`);
    }
    const directory = dirname(path);
    // Explicit development artifacts can lack metadata. If metadata exists,
    // however, it must describe this exact library; overrides cannot bypass it.
    const manifest = exists(join(directory, 'libatomic-runtime.json')) ? readManifest(directory, host, spec) : undefined;
    if (manifest) {
      let matches;
      try { matches = realpathSync(path) === realpathSync(join(directory, manifest.library)); }
      catch (error) {
        fail('ATOMIC_RUNTIME_MANIFEST', `Cannot resolve the library named by the adjacent runtime manifest: ${error.message}`, error);
      }
      if (!matches) fail('ATOMIC_RUNTIME_MANIFEST', 'LIBATOMIC_ADDON does not match the library named in its adjacent runtime manifest.');
    }
    return { path, manifest };
  }
  if (env.ATOMIC_BIN) {
    return runtimeByExecutable(absolutePath(env.ATOMIC_BIN, 'ATOMIC_BIN'), host, spec);
  }

  // Explicit configuration above; the registered installation outranks PATH
  // discovery so an editor launched from the Dock uses the installer's choice.
  const registered = registeredRuntime(env, host, spec);
  if (registered) return registered;

  const filename = host.platform === 'win32' ? 'atomic.exe' : 'atomic';
  let workingDirectory;
  try { workingDirectory = realpathSync(cwd); } catch { workingDirectory = cwd; }
  for (const part of (env.PATH ?? env.Path ?? '').split(host.platform === 'win32' ? ';' : ':')) {
    const entry = part.replace(/^"(.*)"$/, '$1');
    // Empty/relative PATH entries include the current directory implicitly.
    if (!isAbsolute(entry) || inside(entry, workingDirectory)) continue;
    const executable = join(entry, filename);
    if (!exists(executable) || !statSync(executable).isFile()) continue;
    if (inside(realpathSync(executable), workingDirectory)) continue;
    if (host.platform !== 'win32') {
      try { accessSync(executable, constants.X_OK); } catch { continue; }
    }
    // The first executable is the active CLI. A missing/incompatible runtime
    // there is an error, not permission to load a different installation.
    return runtimeByExecutable(executable, host, spec);
  }
  fail('ATOMIC_RUNTIME_NOT_FOUND', `Atomic is not installed or is not on a trusted absolute PATH entry. Install Atomic with ${spec.library} and libatomic-runtime.json (the official installer registers it automatically), or set ATOMIC_RUNTIME_DIR to its installation directory. nodeatomic does not build Atomic.`);
}

function dlopen(path) {
  const addon = { exports: {} };
  process.dlopen(addon, path);
  return addon.exports;
}

/** Load an installed Node-API library and conservatively gate its protobuf
 * contract against the descriptor used to generate this consumer. */
export function loadAddon({ expectedDescriptorSha256, load = dlopen, ...options } = {}) {
  const runtime = resolveRuntime(options);
  if (expectedDescriptorSha256 !== undefined && !digestPattern.test(expectedDescriptorSha256)) {
    fail('ATOMIC_RUNTIME_CONTRACT', 'nodeatomic has no valid generated descriptor fingerprint; rebuild the consumer.');
  }
  const manifest = runtime.manifest;
  if (manifest && expectedDescriptorSha256 && manifest.descriptorSha256 !== expectedDescriptorSha256) {
    fail('ATOMIC_RUNTIME_CONTRACT', `Atomic ${manifest.version} has a different protobuf contract from this nodeatomic build. Install a matching Atomic runtime or update/rebuild the consumer.`);
  }
  let addon;
  try {
    if (!statSync(runtime.path).isFile()) throw new Error('not a regular file');
    if (manifest && sha256(readFileSync(runtime.path)) !== manifest.librarySha256) {
      fail('ATOMIC_RUNTIME_INTEGRITY', `Atomic library checksum mismatch: ${runtime.path}. Reinstall the complete runtime.`);
    }
    addon = load(realpathSync(runtime.path));
  } catch (error) {
    if (error instanceof AtomicRuntimeError) throw error;
    fail('ATOMIC_RUNTIME_LOAD', `Cannot load ${runtime.path}. Install a library built for this host with libatomic's node feature. ${error.message}`, error);
  }
  if (typeof addon?.call !== 'function' || typeof addon?.descriptor !== 'function') {
    fail('ATOMIC_RUNTIME_EXPORTS', 'The supplied Node-enabled libatomic must export call() and descriptor().');
  }
  let descriptor;
  try { descriptor = addon.descriptor(); }
  catch (error) {
    fail('ATOMIC_RUNTIME_CONTRACT', `Cannot read libatomic's protobuf descriptor: ${error.message}`, error);
  }
  if (!Buffer.isBuffer(descriptor) || descriptor.length === 0) {
    fail('ATOMIC_RUNTIME_CONTRACT', 'libatomic returned an empty or invalid protobuf descriptor.');
  }
  const descriptorHash = sha256(descriptor);
  if ((manifest && descriptorHash !== manifest.descriptorSha256)
      || (expectedDescriptorSha256 && descriptorHash !== expectedDescriptorSha256)) {
    fail('ATOMIC_RUNTIME_CONTRACT', 'The loaded libatomic protobuf descriptor does not match its manifest or this nodeatomic build. Update/reinstall a matching runtime.');
  }
  return addon;
}
