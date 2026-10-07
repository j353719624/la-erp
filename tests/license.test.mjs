import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signaturePayload, signLicense, verifyLicense, machineID, rotateServerPublicKey } from '../tools/license.mjs';
const pair = crypto.generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const machine = 'a'.repeat(64);
const fields = { machine_id: machine, issued_at: '2026-10-08T00:00:00Z', expires_at: '2030-01-01T00:00:00Z', edition: 'pro', extra: '<企业>&\u2028\u2029' };

test('Go-compatible field order, escaping, omitempty, and signature exclusion', () => {
  assert.equal(signaturePayload({ machine_id: machine, issued_at: '', expires_at: '', extra: '', edition: '', signature: 'excluded' }).toString(), `{"machine_id":"${machine}","issued_at":"","expires_at":""}`);
  assert.match(signaturePayload(fields).toString(), /"extra":"\\u003c企业\\u003e\\u0026\\u2028\\u2029","edition":"pro"/);
});
test('valid license, signed fields tampering, wrong host, wrong edition, expiration, wrong key', () => {
  const record = signLicense(privateKey, fields), options = { machine, now: new Date('2026-10-08T00:00:00Z') };
  assert.equal(verifyLicense(record, publicKey, options).valid, true);
  for (const field of ['machine_id', 'issued_at', 'expires_at', 'extra', 'edition']) assert.throws(() => verifyLicense({ ...record, [field]: 'modified' }, publicKey, options), /签名/);
  assert.throws(() => verifyLicense(record, publicKey, { ...options, machine: 'b'.repeat(64) }), /机器码/);
  assert.throws(() => verifyLicense(record, publicKey, { ...options, edition: 'lite' }), /版本/);
  assert.throws(() => verifyLicense(record, publicKey, { ...options, now: new Date('2031-01-01') }), /过期/);
  const other = crypto.generateKeyPairSync('ed25519').publicKey;
  assert.throws(() => verifyLicense(record, Buffer.from(other.export({ format: 'jwk' }).x, 'base64url').toString('base64'), options), /签名/);
});
test('perpetual and legacy empty edition are accepted', () => {
  const record = signLicense(privateKey, { machine_id: machine, expires_at: '', edition: '' });
  assert.equal(verifyLicense(record, publicKey, { machine, now: new Date('2099-01-01') }).valid, true);
});
test('invalid date, malformed machine ID, wrong key type, malformed public key and unsupported binary rejected', () => {
  assert.throws(() => signLicense(privateKey, { ...fields, expires_at: '2026-02-30T00:00:00Z' }), /RFC3339/);
  assert.throws(() => signLicense(privateKey, { ...fields, machine_id: 'short' }), /机器码/);
  assert.throws(() => verifyLicense(signLicense(privateKey, fields), 'invalid'), /公钥/);
  assert.throws(() => rotateServerPublicKey(Buffer.from('unsupported'), publicKey), /哈希/);
});
test('DMI first, zero DMI falls back, case preserved, no identity rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-erp-test-'));
  try {
    fs.mkdirSync(path.join(root, 'sys/class/dmi/id'), { recursive: true });
    fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sys/class/dmi/id/product_uuid'), ' UUID-UPPER \n');
    fs.writeFileSync(path.join(root, 'etc/machine-id'), 'fallback\n');
    assert.equal(machineID(root), crypto.createHash('sha256').update('UUID-UPPER').digest('hex'));
    fs.writeFileSync(path.join(root, 'sys/class/dmi/id/product_uuid'), '00000000-0000-0000-0000-000000000000');
    assert.equal(machineID(root), crypto.createHash('sha256').update('fallback').digest('hex'));
    fs.writeFileSync(path.join(root, 'etc/machine-id'), ' ');
    assert.throws(() => machineID(root), /无法读取/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
