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
const fontLicense = fs.readFileSync(path.join(root, 'public', 'fonts', 'source-han-sans', 'LICENSE.txt'), 'utf8');
sections.push(`## Adobe Source Han Sans 2.005R\n\nDeclared license: SIL Open Font License 1.1\n\nUnmodified SourceHanSansSC-VF.otf.woff2, Pan-CJK font with Simplified Chinese default glyphs. Self-hosted by Tooku; source: https://github.com/adobe-fonts/source-han-sans/tree/2.005R/Variable/WOFF2/OTF . SHA-256: 085cc88c530b9c434165ab926f81608a55b24e60e05719f3d41340ac45d9c62f .\n\n${fontLicense.trim()}\n`);
const serifLicense = fs.readFileSync(path.join(root, 'public', 'fonts', 'source-han-serif', 'LICENSE.txt'), 'utf8');
sections.push(`## Adobe Source Han Serif 2.003R\n\nDeclared license: SIL Open Font License 1.1\n\nUnmodified SourceHanSerifSC-VF.otf.woff2, Pan-CJK font with Simplified Chinese default glyphs. Self-hosted by Tooku; source: https://github.com/adobe-fonts/source-han-serif/tree/2.003R/Variable/WOFF2/OTF . SHA-256: 3b9451444b4a3554ab061a43cb79dc11c72c0dbc381f148c56c542dca9c0a7e3 .\n\n${serifLicense.trim()}\n`);
const navidromeLicense = fs.readFileSync(path.join(root, 'public', 'navidrome-license.txt'), 'utf8');
sections.push(`## Navidrome logo\n\nDeclared license: Apache License 2.0\n\nUnmodified logo.svg from the official Navidrome website repository, used on Tooku's login page to identify the compatible music server. Source: https://github.com/navidrome/website/blob/master/assets/icons/logo.svg . Navidrome and its logo belong to their respective owners.\n\n${navidromeLicense.trim()}\n`);
sections.push(`## Lyrics protocol research\n\nTooku's minimal lyric adapters are independently implemented with Node built-ins; no code or packages from the following projects are included. Protocol research references (2026-10-20): NeteaseCloudMusicApiEnhanced/api-enhanced (MIT), jsososo/QQMusicApi (GPL-3.0), L-1124/QQMusicApi (GPL-3.0), chenmozhijin/LDDC (GPL-3.0). See docs/15-lyrics-service-design.md for source links and implementation boundaries. Future code reuse requires separate license review and attribution; module separation does not remove license obligations.\n`);
const notices = `# Tooku third-party notices\n\nGenerated from installed production dependencies and their packaged license texts. This file does not assign a license to Tooku's original source. Regenerate after dependency changes with: node scripts/license-notices.mjs\n\nThe server uses Node.js 24 built-in HTTP, crypto, filesystem and SQLite modules, with no additional npm production packages. Node.js and its bundled components are covered by the LICENSE shipped with the runtime distribution: https://github.com/nodejs/node/blob/v24.x/LICENSE . The Docker runtime retains that distribution and its notices.\n\n${sections.join('\n---\n\n')}`;
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
fs.writeFileSync(path.join(root, 'public', 'third-party-notices.txt'), notices);
console.log(`Recorded full packaged licenses for ${seen.size} production packages.`);
