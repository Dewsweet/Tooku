import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const seen = new Map();
function inspect(directory) {
  const actual = fs.realpathSync(directory);
  const pkg = JSON.parse(fs.readFileSync(path.join(actual, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const filename = fs.readdirSync(actual).find((name) => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(name));
  if (!filename) throw new Error(`Missing packaged license: ${key}`);
  seen.set(key, { pkg, license: fs.readFileSync(path.join(actual, filename), 'utf8') });
  const marker = `${path.sep}node_modules${path.sep}`;
  const dependencyRoot = actual.slice(0, actual.lastIndexOf(marker) + marker.length);
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const candidate = path.join(dependencyRoot, name);
    if (fs.existsSync(candidate)) inspect(candidate);
    else throw new Error(`Missing runtime dependency: ${name}`);
  }
}
for (const name of Object.keys(manifest.dependencies ?? {})) inspect(path.join(root, 'node_modules', name));
const sections = [...seen.values()].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name)).map(({ pkg, license }) => `## ${pkg.name} ${pkg.version}\n\nDeclared license: ${pkg.license ?? 'see license text'}\n\n${license.trim()}\n`);
const notices = `# Tooku third-party notices\n\nGenerated from installed production dependencies and their packaged license texts. This file does not assign a license to Tooku's original source. Regenerate after dependency changes with: node scripts/license-notices.mjs\n\nThe server uses Node.js 24 built-in HTTP, crypto, filesystem and SQLite modules, with no additional npm production packages. Node.js and its bundled components are covered by the LICENSE shipped with the runtime distribution: https://github.com/nodejs/node/blob/v24.x/LICENSE . The Docker runtime retains that distribution and its notices.\n\n${sections.join('\n---\n\n')}`;
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
fs.writeFileSync(path.join(root, 'public', 'third-party-notices.txt'), notices);
console.log(`Recorded full packaged licenses for ${seen.size} production packages.`);
