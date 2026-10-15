#!/usr/bin/env node
// Extract verbatim project sources from original Vite source maps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [distArg, outputArg] = process.argv.slice(2);
if (!distArg || !outputArg) throw Error('Usage: node tools/recover_frontend.mjs <extracted-server/dist> <new-output-directory>');
const dist = path.resolve(distArg), output = path.resolve(outputArg);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Output directory must be empty or new');
const sources = new Map();
for (const filename of fs.readdirSync(path.join(dist, 'assets')).filter(f => f.endsWith('.map')).sort()) {
  const map = JSON.parse(fs.readFileSync(path.join(dist, 'assets', filename), 'utf8'));
  map.sources.forEach((name, index) => {
    if (!name.startsWith('../../src/') || typeof map.sourcesContent?.[index] !== 'string') return;
    const relative = name.slice(6), content = map.sourcesContent[index];
    if (!relative.startsWith('src/') || relative.split('/').includes('..') || relative.includes('\\')) throw Error('Unsafe source map path');
    const existing = sources.get(relative);
    if (existing && existing.content !== content) throw Error('Conflicting source: ' + relative);
    sources.set(relative, { content, map: filename, source: name });
  });
}
const manifest = [];
for (const [relative, record] of sources) {
  const file = path.join(output, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, record.content);
  manifest.push({ path: relative, map: record.map, source: record.source, sha256: crypto.createHash('sha256').update(record.content).digest('hex'), bytes: Buffer.byteLength(record.content) });
}
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Actual ${manifest.length} verbatim source files`);
