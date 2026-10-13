// Reads recovered TS syntax only; this inventory does not probe a live server.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(path.join(root, 'frontend/package.json'))('typescript');
const rows = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(filename); continue; }
    if (!/\.tsx?$/.test(filename)) continue;
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'http') {
        const method = node.expression.name.text;
        if (['get','post','put','patch','delete','upload','download'].includes(method)) {
          rows.push({ source: path.relative(root, filename).replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, helper: method, method: ({ upload: 'POST', download: 'GET' })[method] || method.toUpperCase(), path_expression: node.arguments[0]?.getText(source), response_type: node.typeArguments?.map(n => n.getText(source)).join(', ') || null });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
walk(path.join(root, 'frontend/src/api'));
fs.writeFileSync(path.join(root, 'evidence/frontend-api-inventory.json'), JSON.stringify({ description: 'Static client call inventory; paths are relative to the /api base and may contain template parameters. Not a complete server route list.', calls: rows }, null, 2) + '\n');
console.log(`Recorded ${rows.length} client API calls.`);
