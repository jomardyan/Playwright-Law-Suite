// Development Make helpers: no dependency installation, server startup or data cleanup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owned = ["dist"];
const archives = ["^universcan-[A-Za-z0-9.+-]+\\.tgz$"];
const [operation = 'help', ...values] = process.argv.slice(2);
function checked(value) {
  if (!value || !value.trim()) throw new Error('An output path must not be empty.');
  const target = path.resolve(root, value), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Output must stay inside this project: ' + value);
  const portable = relative.split(path.sep).join('/');
  if (!owned.some(p => portable === p || portable.startsWith(p + '/')) && !archives.some(pattern => new RegExp(pattern).test(portable))) throw new Error('Not an owned generated output: ' + value);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing a symlink/junction output: ' + current);
  }
  const tracked = spawnSync('git', ['ls-files', '--', portable], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (tracked.status === 0 && tracked.stdout.trim()) throw new Error('Refusing to remove or overwrite tracked source: ' + portable);
  if (tracked.error || tracked.status !== 0) throw new Error('Git must succeed to verify tracked-source safety.');
  return target;
}
if (operation === 'help') {
  console.log('GNU Make development commands (the default only prints this help):');
  const seen = new Set();
  for (const line of fs.readFileSync(path.join(root, 'Makefile'), 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*)*):[^#]*##\s*(.+)$/.exec(line);
    if (match && !seen.has(match[1])) { console.log('  ' + match[1].padEnd(25) + match[2]); seen.add(match[1]); }
  }
  console.log('See MAKE.md for executable/path overrides, prerequisites and cleanup scope.');
} else if (operation === 'guard-app') {
  if (values.length !== 1 || path.resolve(root, values[0]) !== path.resolve(root, 'ai-metadata-cleaner-clone')) throw new Error('APP_DIR must identify this repository\'s maintained application.');
} else if (['guard', 'resolve', 'mkdir', 'clean'].includes(operation)) {
  const selected = values.length ? values : owned;
  // Validate every path before performing any mutation.
  const targets = selected.map(checked);
  if (operation === 'resolve') targets.forEach(p => console.log(p));
  if (operation === 'mkdir') targets.forEach(p => fs.mkdirSync(p, { recursive: true }));
  if (operation === 'clean') {
    for (const file of fs.readdirSync(root)) if (archives.some(pattern => new RegExp(pattern).test(file))) targets.push(checked(file));
    for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  }
} else throw new Error('Unknown Make helper operation: ' + operation);
