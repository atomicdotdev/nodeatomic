import { cpSync, mkdirSync } from 'node:fs';

const destination = new URL('../dist/generated/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const file of ['proto.cjs', 'proto.d.cts']) {
  cpSync(new URL(`../ts/generated/${file}`, import.meta.url), new URL(file, destination));
}
const runtime = new URL('../dist/runtime/', import.meta.url);
mkdirSync(runtime, { recursive: true });
for (const file of ['loader.mjs', 'loader.d.mts']) {
  cpSync(new URL(`../ts/runtime/${file}`, import.meta.url), new URL(file, runtime));
}
