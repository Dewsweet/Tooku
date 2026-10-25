import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const includeDevelopment = process.argv.includes('--all');
const outputFlag = process.argv.indexOf('--output');
const output = path.resolve(root, outputFlag >= 0 && process.argv[outputFlag + 1]
  ? process.argv[outputFlag + 1]
  : `.local/security/tooku-${includeDevelopment ? 'all' : 'prod'}.cdx.json`);
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packages = new Map();
const dependencies = new Map();
const processedScopes = new Map();

function purl(name, version) {
  const encoded = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

function component(pkg, scope) {
  const ref = purl(pkg.name, pkg.version);
  return {
    type: 'library',
    'bom-ref': ref,
    group: pkg.name.startsWith('@') ? pkg.name.slice(1).split('/')[0] : undefined,
    name: pkg.name.startsWith('@') ? pkg.name.split('/')[1] : pkg.name,
    version: pkg.version,
    scope: scope === 'development' ? 'excluded' : 'required',
    licenses: typeof pkg.license === 'string' ? [{ expression: pkg.license }] : undefined,
    purl: ref,
    properties: [{ name: 'tooku:dependencyScope', value: scope }],
  };
}

async function inspect(directory, scope) {
  const actual = await realpath(directory);
  const pkg = JSON.parse(await readFile(path.join(actual, 'package.json'), 'utf8'));
  const ref = purl(pkg.name, pkg.version);
  const previous = packages.get(ref);
  if (!previous || previous.scope === 'excluded' && scope === 'production') packages.set(ref, component(pkg, scope));
  const completed = processedScopes.get(ref) ?? new Set();
  if (completed.has(scope)) return ref;
  completed.add(scope);
  processedScopes.set(ref, completed);
  if (!dependencies.has(ref)) dependencies.set(ref, new Set());
  const marker = `${path.sep}node_modules${path.sep}`;
  const markerIndex = actual.lastIndexOf(marker);
  const dependencyRoot = markerIndex >= 0 ? actual.slice(0, markerIndex + marker.length) : path.join(actual, 'node_modules');
  for (const [name, optional] of [
    ...Object.keys(pkg.dependencies ?? {}).map((name) => [name, false]),
    ...Object.keys(pkg.optionalDependencies ?? {}).map((name) => [name, true]),
  ]) {
    const candidate = path.join(dependencyRoot, name);
    if (!existsSync(candidate)) {
      if (optional) continue;
      throw new Error(`Missing installed dependency ${name} required by ${pkg.name}@${pkg.version}`);
    }
    const child = await inspect(candidate, scope);
    dependencies.get(ref).add(child);
  }
  return ref;
}

const rootRef = purl(manifest.name, manifest.version);
dependencies.set(rootRef, new Set());
const roots = [
  ...Object.keys(manifest.dependencies ?? {}).map((name) => [name, 'production']),
  ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => [name, 'production']),
  ...(includeDevelopment ? Object.keys(manifest.devDependencies ?? {}).map((name) => [name, 'development']) : []),
];
for (const [name, scope] of roots) {
  const child = await inspect(path.join(root, 'node_modules', name), scope);
  dependencies.get(rootRef).add(child);
}

const clean = (value) => JSON.parse(JSON.stringify(value));
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'Tooku SBOM generator', version: '1' }] },
    component: { type: 'application', 'bom-ref': rootRef, name: manifest.name, version: manifest.version, purl: rootRef },
    properties: [{ name: 'tooku:includedScopes', value: includeDevelopment ? 'production,development' : 'production' }],
  },
  components: [...packages.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])).map(clean),
  dependencies: [...dependencies.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([ref, values]) => ({ ref, dependsOn: [...values].sort() })),
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Wrote ${packages.size} components to ${path.relative(root, output)}.`);
