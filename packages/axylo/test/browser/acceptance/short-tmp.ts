/**
 * Browser startup under a short temporary directory, for runners whose TMPDIR is too deep for Chrome.
 *
 * Chrome on Linux binds its SingletonSocket at `$TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket`
 * (branded builds: `com.google.Chrome.XXXXXX`), and a Unix socket path must fit in `sun_path` (108 bytes with
 * the terminating NUL). When it does not, Chrome aborts with "Socket path too long". Playwright (1.65) creates
 * its profile and artifacts directories with `os.tmpdir()` and spawns the browser with `process.env`, both read
 * at launch time, so setting TMPDIR for the duration of the launch is enough; the browser keeps the environment
 * it was spawned with.
 *
 * The short spelling is `/proc/<this process>/cwd/<relative path>`: the kernel resolves it to the real (long)
 * directory, and Node and Chrome keep the short spelling as given. The directory itself is a fresh one inside
 * the workspace this process runs in (inside the current TMPDIR when that is under the working directory), so
 * nothing outside the workspace is written, and it is removed after the browser stops.
 *
 * Only used when needed: on Linux, for Chromium, when the predicted socket path is too long. Otherwise `start`
 * and `stop` run exactly as before. A failure to start is never hidden: it propagates to the caller.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** `sun_path` holds 108 bytes on Linux, including the terminating NUL. */
const SOCKET_PATH_LIMIT = 107;
/** The longer of Chrome's two temp-directory spellings (Chromium vs Google Chrome), with mkdtemp's six characters. */
const SOCKET_SUFFIX = '/.org.chromium.Chromium.XXXXXX/SingletonSocket';

export interface ShortTmpOptions {
  engine: string;
  platform?: NodeJS.Platform;
  pid?: number;
  cwd?: string;
  tmpdir?: string;
}

/** Whether Chrome's socket under `tmpdir` would exceed the Unix socket path limit. */
export function socketPathTooLong(tmpdir: string): boolean {
  return Buffer.byteLength(path.join(tmpdir, SOCKET_SUFFIX)) > SOCKET_PATH_LIMIT;
}

export function needsShortTmp(options: ShortTmpOptions): boolean {
  const platform = options.platform ?? process.platform;
  return platform === 'linux' && options.engine === 'chromium' && socketPathTooLong(options.tmpdir ?? os.tmpdir());
}

/** The created directory, in its short spelling; undefined when the helper is not in use. */
let created: string | undefined;

/**
 * Runs `start` with TMPDIR pointing at a fresh short-spelled directory when Chrome needs it, and restores the
 * previous TMPDIR (or its absence) afterwards, whether `start` succeeds or not, so other test code sees the
 * process environment unchanged.
 */
export async function startWithShortTmp(start: () => Promise<void>, options: ShortTmpOptions): Promise<void> {
  if (!needsShortTmp(options)) { await start(); return; }
  if (created !== undefined) throw new Error(`short TMPDIR already in use: ${created}`);
  const pid = options.pid ?? process.pid;
  const cwd = options.cwd ?? process.cwd();
  const tmpdir = options.tmpdir ?? os.tmpdir();
  const fromCwd = path.relative(cwd, tmpdir);
  // A TMPDIR inside the workspace keeps scratch where the runner put it, if its short spelling fits;
  // otherwise the workspace root.
  const inside = fromCwd !== '' && !fromCwd.startsWith('..') && !path.isAbsolute(fromCwd);
  const fits = (alias: string): boolean => !socketPathTooLong(path.join(alias, '.axylo-XXXXXX'));
  const root = `/proc/${pid}/cwd`;
  const alias = inside && fits(path.join(root, fromCwd)) ? path.join(root, fromCwd) : root;
  if (!fits(alias)) throw new Error(`short TMPDIR is still too long for Chrome's socket: ${alias}`);
  const dir = fs.mkdtempSync(path.join(alias, '.axylo-'));
  created = dir;
  const had = Object.prototype.hasOwnProperty.call(process.env, 'TMPDIR');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    await start();
  } finally {
    if (had) process.env.TMPDIR = previous;
    else delete process.env.TMPDIR;
  }
}

/** Runs `stop`, then removes the directory `startWithShortTmp` created, if any, even when `stop` fails. */
export async function stopWithShortTmp(stop: () => Promise<void>): Promise<void> {
  try {
    await stop();
  } finally {
    const dir = created;
    created = undefined;
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The directory currently in use, for probes. */
export const shortTmpDir = (): string | undefined => created;
