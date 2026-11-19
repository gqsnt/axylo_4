import { basename } from 'node:path';

function * tokens(command) {
  const piece = /[ \t\r]+|\n|#[^\n]*|(?:\d+)?(?:<<<|<<-|<<|>>|<>|<&|>&|>\||[<>])|&&|\|\||[;&|()]|'[^']*'|"(?:[^"\\]|\\[\s\S])*"|\\[\s\S]|[^\s'"\\<>;&|()]+/y;
  const documents = [];
  let word;
  let delimiter;
  let offset = 0;
  while (offset < command.length) {
    piece.lastIndex = offset;
    const match = piece.exec(command);
    if (!match) throw new Error('Unterminated shell word.');
    const [part] = match;
    offset = piece.lastIndex;
    const operator = /^(?:(?:\d+)?[<>]|[;&|()]|\n)/.test(part);
    if (operator || /^[ \t\r]/.test(part)) {
      if (word !== undefined) {
        if (delimiter) {
          documents.push({ word, stripTabs: delimiter === '<<-' });
          delimiter = undefined;
        }
        yield { word };
        word = undefined;
      }
      if (operator) {
        yield { operator: part };
        if (/^\d*<<-?$/.test(part)) delimiter = part.endsWith('-') ? '<<-' : '<<';
        if (part === '\n') {
          for (const document of documents.splice(0)) {
            // A shell feeds these lines to stdin, even when they look like commands.
            while (offset < command.length) {
              const end = command.indexOf('\n', offset);
              const line = command.slice(offset, end < 0 ? undefined : end);
              offset = end < 0 ? command.length : end + 1;
              if ((document.stripTabs ? line.replace(/^\t+/, '') : line) === document.word) break;
            }
          }
        }
      }
    } else if (!part.startsWith('#') || word !== undefined) {
      if (part === '\\\n') continue;
      word = (word ?? '') + (part.startsWith("'") ? part.slice(1, -1) : part.startsWith('"')
        ? part.slice(1, -1).replace(/\\([$`"\\\n])/g, (_, char) => char === '\n' ? '' : char)
        : part.startsWith('\\') ? part.slice(1) : part);
    }
  }
  if (word !== undefined) yield { word };
}

const shells = new Set(['bash', 'dash', 'sh', 'zsh']);
const textCommands = new Set(['echo', 'printf', 'true', 'false', ':', 'export', 'set', 'unset']);
const fileCommands = new Set(['.', 'cat', 'cp', 'diff', 'du', 'file', 'head', 'less', 'ls', 'mkdir', 'mv', 'readlink',
  'realpath', 'rm', 'rmdir', 'source', 'stat', 'tail', 'touch', 'wc']);
const rgShortValues = new Set(['-E', '-j', '-g', '-M', '-r', '-t', '-T']);
const searchFlags = new Set(['-A', '-B', '-C', '-d', '-D', '-m',
  '--after-context', '--before-context', '--context', '--glob', '--iglob', '--encoding', '--threads',
  '--max-columns', '--max-count', '--max-depth', '--max-filesize', '--path-separator', '--replace', '--sort',
  '--sortr', '--type', '--type-not', '--type-add', '--type-clear', '--directories', '--devices', '--include',
  '--exclude', '--exclude-dir']);
const fileFlags = new Set(['--ignore-file', '--exclude-from', '--files-from', '--reference', '--output', '--directory',
  '--require', '--import', '--loader', '--experimental-loader']);

function * operands(name, args) {
  if (textCommands.has(name)) return;
  if (name === 'find') {
    for (const arg of args) {
      if (['-H', '-L', '-P'].includes(arg)) continue;
      if (/^[-!(]/.test(arg)) break;
      yield { path: arg, bare: true };
    }
    return;
  }

  const search = ['rg', 'grep', 'egrep', 'fgrep', 'sed', 'awk'].includes(name);
  const node = name === 'node' || name === 'nodejs';
  const interpreter = ['python', 'python3', 'ruby', 'perl'].includes(name);
  let needsPattern = search && !args.includes('--files');
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (options && arg === '--') {
      options = false;
    } else if (options && arg.startsWith('-') && arg !== '-') {
      const at = arg.indexOf('=');
      const flag = at < 0 ? arg : arg.slice(0, at);
      const value = () => at < 0 ? args[++i] : arg.slice(at + 1);
      if (search && ['-e', '--regexp', '--expression', '-f', '--file'].includes(flag)) {
        const operand = value();
        if (flag === '-f' || flag === '--file') yield { path: operand, bare: true };
        needsPattern = false;
      } else if (search && /^-[ef].+/.test(flag)) {
        if (flag.startsWith('-f')) yield { path: arg.slice(2), bare: true };
        needsPattern = false;
      } else if (fileFlags.has(flag) || (node && flag === '-r')) {
        yield { path: value(), bare: true };
      } else if ((search && searchFlags.has(flag)) || (name === 'rg' && rgShortValues.has(flag)) ||
          (name === 'awk' && flag === '-v') ||
          (['head', 'tail'].includes(name) && ['-n', '-c', '--lines', '--bytes'].includes(flag)) ||
          (node && ['-e', '-p', '--eval', '--print', '--input-type', '--conditions', '-C'].includes(flag)) ||
          (interpreter && ['-c', '-e', '-m'].includes(flag))) {
        value();
      }
    } else if (needsPattern) {
      needsPattern = false;
    } else if (!/^[A-Za-z_]\w*=/.test(arg) || name !== 'awk') {
      yield { path: arg, bare: search || node || interpreter || shells.has(name) || fileCommands.has(name) };
    }
  }
}

export function * commandPaths(command, directory, toPath) {
  const words = [];
  const subshells = [];
  let redirect;
  for (const token of tokens(command + '\n')) {
    const { word, operator } = token;
    if (word !== undefined) {
      if (!redirect) words.push(word);
      else if (!redirect.includes('<<') && !(/&$/.test(redirect) && /^[\d-]+$/.test(word))) {
        yield toPath(word, directory, true);
      }
      redirect = undefined;
      continue;
    }
    if (/[<>]/.test(operator)) {
      redirect = operator;
      continue;
    }

    const start = words.findIndex(word => !/^[A-Za-z_]\w*=/.test(word));
    if (start !== -1) {
      let [program, ...args] = words.slice(start);
      // These prefixes launch the command that follows them.
      while (['command', 'env', 'exec'].includes(program) && args.length) {
        [program, ...args] = args;
        while (/^[A-Za-z_]\w*=/.test(program) && args.length) [program, ...args] = args;
      }
      const name = basename(program);
      const script = shells.has(name) ? args.findIndex(arg => /^-[a-z]*c[a-z]*$/.test(arg)) : -1;
      yield toPath(program, directory, false);
      if (script >= 0 && args[script + 1] !== undefined) {
        yield * commandPaths(args[script + 1], directory, toPath);
      } else if (name === 'cd') {
        const target = args.find(arg => arg === '-' || !arg.startsWith('-')) ?? '~';
        const next = toPath(target, directory, true);
        yield next;
        if (operator !== '|') directory = next ?? (target === '/' ? target : directory);
      } else {
        for (const { path, bare } of operands(name, args)) yield toPath(path, directory, bare);
      }
    }
    if (operator === '(') subshells.push(directory);
    if (operator === ')' && subshells.length) directory = subshells.pop();
    words.length = 0;
    redirect = undefined;
  }
}
