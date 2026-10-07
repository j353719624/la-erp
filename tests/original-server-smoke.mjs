// Runs the original Linux binary in a disposable directory, with all network
// listeners bound to loopback. No production database or license is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { machineID, signLicense, rotateServerPublicKey } from '../tools/license.mjs';

if (process.platform !== 'linux' || !process.argv[2]) throw Error('Usage on Linux: node tests/original-server-smoke.mjs <original-server>');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'la-erp-smoke-'));
const original = fs.readFileSync(path.resolve(process.argv[2]));
const pair = crypto.generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicText = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const migrated = rotateServerPublicKey(original, publicText);
const server = path.join(dir, 'la-erp-server');
fs.writeFileSync(server, migrated.binary, { mode: 0o755 });
const identity = machineID();
const baseFields = { machine_id: identity, edition: 'pro', issued_at: new Date().toISOString(), expires_at: '' };

const probe = net.createServer();
await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));

async function runCase(label, record, shouldStart, rawBinary) {
  const caseDir = path.join(dir, label);
  fs.mkdirSync(path.join(caseDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(caseDir, 'logs'));
  fs.mkdirSync(path.join(caseDir, 'uploads'));
  const lic = path.join(caseDir, 'license.key');
  fs.writeFileSync(lic, JSON.stringify(record));
  const config = path.join(caseDir, 'config.yaml');
  fs.writeFileSync(config, `server:\n  port: ${port}\n  host: 127.0.0.1\n  mode: release\ndatabase:\n  driver: sqlite\n  dsn: '${caseDir}/data/la-erp.db'\njwt:\n  secret: '${crypto.randomBytes(32).toString('hex')}'\n  access_token_ttl: 7200\n  refresh_token_ttl: 604800\nlog:\n  level: info\n  path: '${caseDir}/logs'\nupload:\n  path: '${caseDir}/uploads'\n  max_size: 10\nlicense:\n  enabled: true\n  file: '${lic}'\n  trial_days: 30\n`);
  let executable = server;
  if (rawBinary) { executable = path.join(caseDir, 'original-server'); fs.writeFileSync(executable, rawBinary, { mode: 0o755 }); }
  const child = spawn(executable, ['-c', config], { cwd: caseDir, env: { ...process.env, TZ: 'Asia/Shanghai' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exitCode = null, exited = false;
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => output += b);
  child.on('exit', code => { exitCode = code; exited = true; });
  child.on('error', err => { output += err.message; exited = true; exitCode = -1; });
  try {
    if (shouldStart) {
      let healthy = false;
      for (let i = 0; i < 120; i++) {
        if (exited) break;
        try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { healthy = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(healthy, true, `valid license did not start server: ${output.slice(-4000)}`);
      assert.match(output, /已授权|licensed/, 'license success banner missing');
    } else {
      for (let i = 0; i < 30 && !exited; i++) await new Promise(resolve => setTimeout(resolve, 200));
      assert.equal(exited, true, `invalid license did not terminate: ${output.slice(-2000)}`);
      assert.notEqual(exitCode, 0, 'invalid license exited successfully');
      assert.match(output, /授权|license/i, 'license rejection not identified');
    }
    console.log(`PASS ${label}`);
  } finally {
    if (!exited) child.kill('SIGTERM');
    for (let i = 0; i < 20 && !exited; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!exited) child.kill('SIGKILL');
  }
}
try {
  const valid = signLicense(privateKey, baseFields);
  await runCase('original-rejects-new-key', valid, false, original);
  await runCase('tampered', { ...valid, extra: 'changed' }, false);
  await runCase('wrong-machine', signLicense(privateKey, { ...baseFields, machine_id: 'f'.repeat(64) }), false);
  await runCase('wrong-edition', signLicense(privateKey, { ...baseFields, edition: 'lite' }), false);
  await runCase('expired', signLicense(privateKey, { ...baseFields, expires_at: '2000-01-01T00:00:00Z' }), false);
  await runCase('valid', valid, true);
  console.log('Original binary validates reconstructed signatures; all six cases passed.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
