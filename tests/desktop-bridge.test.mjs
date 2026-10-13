import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyLicense } from '../tools/license.mjs';
const bridge = fileURLToPath(new URL('../tools/desktop/bridge.mjs', import.meta.url));
function call(input) {
  const child = spawnSync(process.execPath, [bridge], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /BEGIN PRIVATE KEY/);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.ok ? 0 : 1);
  return result;
}
test('desktop bridge generates keys, loads private key, exports verified licenses and protects existing files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'la-erp-gui-'));
  try {
    const generated = call({ action: 'keygen', directory });
    assert.equal(generated.ok, true);
    const originalKey = fs.readFileSync(generated.privatePath);
    assert.equal(call({ action: 'keygen', directory }).ok, false);
    assert.deepEqual(fs.readFileSync(generated.privatePath), originalKey);
    const info = call({ action: 'info', privatePath: generated.privatePath });
    assert.equal(info.publicText, generated.publicText);
    const machine = 'a'.repeat(64), output = path.join(directory, 'license.key');
    const request = { action: 'sign', privatePath: generated.privatePath, machine, output, extra: '<客户>&中文' };
    assert.equal(call(request).ok, true);
    const record = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(verifyLicense(record, info.publicText, { machine }).valid, true);
    const originalLicense = fs.readFileSync(output);
    assert.equal(call(request).ok, false);
    assert.deepEqual(fs.readFileSync(output), originalLicense);
    const timed = call({ ...request, output: path.join(directory, 'timed.key'), expires: '2030-01-01T00:00:00+08:00' });
    assert.equal(timed.ok, true);
    assert.equal(call({ ...request, output: path.join(directory, 'bad.key'), machine: 'invalid' }).ok, false);
    assert.equal(fs.existsSync(path.join(directory, 'bad.key')), false);
    assert.equal(call({ ...request, output: path.join(directory, 'expired.key'), expires: '2000-01-01T00:00:00Z' }).ok, false);
    assert.equal(fs.existsSync(path.join(directory, 'expired.key')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
