import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const vendor = path.join(import.meta.dirname, 'vendor');
export const axyloDirectory = path.join(vendor, 'axylo');
export const axyloEntry = path.join(axyloDirectory, 'dist/axylo.js');

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const packed = new URL('../../tests/dist/.packed/', import.meta.url);
  const { tarball, integrity } = JSON.parse(fs.readFileSync(new URL('manifest.json', packed))).packages.axylo;
  const archive = fileURLToPath(new URL(tarball, packed));
  const digest = createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
  if (`sha512-${digest}` !== integrity) throw new Error(`${tarball} does not match the packed manifest`);

  fs.mkdirSync(vendor, { recursive: true });
  const staging = fs.mkdtempSync(path.join(vendor, 'axylo-'));
  try {
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', staging], { stdio: 'inherit' });
    fs.rmSync(axyloDirectory, { recursive: true, force: true });
    fs.renameSync(staging, axyloDirectory);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Unpacked ${tarball} (${integrity})`);
}
