/**
 * Pack the library a level imports (Init, by default) into one archive. The
 * bridge imports at the module system's `exported` level, so each module needs
 * only its `.olean` and `.ir` parts.
 *
 *   node --experimental-strip-types wasm/pack-library.ts <lib/lean dir> <out.ldpk> [Module ...]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packLibrary, type PackedFile } from '../src/engine/library-pack.ts';

const [libDir, outFile, ...modules] = process.argv.slice(2);
if (!libDir || !outFile) {
  console.error('usage: pack-library.ts <lib/lean dir> <out.ldpk> [Module ...]');
  process.exit(2);
}
const roots = modules.length > 0 ? modules : ['Init'];

const files: PackedFile[] = [];
const add = (rel: string) => files.push({ path: rel, data: readFileSync(path.join(libDir, rel)) });
const walk = (relDir: string) => {
  for (const name of readdirSync(path.join(libDir, relDir)).sort()) {
    const rel = path.posix.join(relDir, name);
    if (statSync(path.join(libDir, rel)).isDirectory()) walk(rel);
    else if (/\.(olean|ir)$/.test(name)) add(rel);
  }
};
for (const root of roots) {
  for (const ext of ['.olean', '.ir']) {
    try {
      add(root + ext);
    } catch {
      // not every module has every part
    }
  }
  walk(root);
}

const packed = await packLibrary(files);
writeFileSync(outFile, packed);
const raw = files.reduce((n, f) => n + f.data.length, 0);
console.log(`${files.length} files, ${(raw / 1e6).toFixed(1)} MB raw, ${(packed.length / 1e6).toFixed(1)} MB packed → ${outFile}`);
