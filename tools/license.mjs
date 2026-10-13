#!/usr/bin/env node
// Reconstructed from LA-ERP 1.4.51: SignaturePayload at 0xe3c1a0,
// Ed25519 verification at 0xe3c400, embedded public key at 0x3e5f61d.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ORIGINAL_PUBLIC_KEY = 'v08PqUbX9oNfLruLg3oDEVuTbM+koZ5uG2Qf5rIDYhw=';
export const ORIGINAL_SERVER_SHA256 = 'ce7b3d8a5d5b46470a51349f0dc357086c95476bb46a73f2ec3537da78432ef8';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

export function publicKeyFromBase64(text) {
  const value = text.trim();
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== value) throw Error('公钥必须是 32 字节 Ed25519 公钥的标准 Base64');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function signaturePayload(license) {
  const payload = {};
  for (const field of ['machine_id', 'issued_at', 'expires_at']) {
    if (license[field] !== undefined && typeof license[field] !== 'string') throw Error(`${field} 必须是字符串`);
    payload[field] = license[field] ?? '';
  }
  for (const field of ['extra', 'edition']) {
    if (license[field] !== undefined && typeof license[field] !== 'string') throw Error(`${field} 必须是字符串`);
    if (license[field]) payload[field] = license[field];
  }
  // Go encoding/json.Marshal escapes HTML characters and U+2028/U+2029.
  return Buffer.from(JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

export function machineID(root = '/') {
  for (const file of ['sys/class/dmi/id/product_uuid', 'etc/machine-id', 'var/lib/dbus/machine-id']) {
    try {
      const text = fs.readFileSync(path.join(root, file), 'utf8').trim();
      if (text && text !== '00000000-0000-0000-0000-000000000000') return sha256(Buffer.from(text));
    } catch (err) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(err.code)) throw err;
    }
  }
  throw Error('无法读取 DMI product_uuid 或 machine-id；请在实际 Linux/NAS 主机运行');
}

function validRFC3339(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return m >= 1 && m <= 12 && d >= 1 && d <= days && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

export function signLicense(privateKey, fields) {
  if (!/^[a-f0-9]{64}$/.test(fields.machine_id || '')) throw Error('机器码必须是 64 位小写十六进制字符串');
  if (fields.edition && !['pro', 'lite'].includes(fields.edition)) throw Error('edition 只能是 pro 或 lite');
  if (fields.expires_at && !validRFC3339(fields.expires_at)) throw Error('expires_at 必须是 RFC3339 时间，空字符串表示永久');
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('需要 Ed25519 私钥');
  const record = { machine_id: fields.machine_id, issued_at: fields.issued_at || new Date().toISOString(), expires_at: fields.expires_at || '' };
  if (fields.extra) record.extra = fields.extra;
  if (fields.edition) record.edition = fields.edition;
  record.signature = crypto.sign(null, signaturePayload(record), key).toString('base64');
  return record;
}

export function verifyLicense(license, publicText, { machine, edition = 'pro', now = new Date() } = {}) {
  const publicKey = publicKeyFromBase64(publicText);
  const signature = Buffer.from(license.signature || '', 'base64');
  if (signature.length !== 64 || !crypto.verify(null, signaturePayload(license), publicKey, signature)) throw Error('授权签名无效');
  if (machine !== undefined && license.machine_id !== machine) throw Error('授权机器码不匹配');
  // The original pro verifier accepts empty edition for legacy keys.
  if (license.edition && license.edition !== edition) throw Error('授权产品版本不匹配');
  if (license.expires_at) {
    if (!validRFC3339(license.expires_at)) throw Error('授权到期时间格式无效');
    if (now.getTime() > Date.parse(license.expires_at)) throw Error('授权已过期');
  }
  return { valid: true, machine_id: license.machine_id, edition: license.edition || 'legacy', expires_at: license.expires_at || '' };
}

export function rotateServerPublicKey(binary, newPublicText) {
  publicKeyFromBase64(newPublicText);
  if (sha256(binary) !== ORIGINAL_SERVER_SHA256) throw Error('仅支持已核验的原始 1.4.51 二进制；文件哈希不匹配');
  const oldKey = Buffer.from(ORIGINAL_PUBLIC_KEY), newKey = Buffer.from(newPublicText.trim());
  const offset = binary.indexOf(oldKey);
  if (offset < 0 || binary.indexOf(oldKey, offset + 1) >= 0) throw Error('原公钥位置不唯一');
  if (oldKey.equals(newKey)) throw Error('新旧公钥相同');
  const result = Buffer.from(binary);
  newKey.copy(result, offset);
  return { binary: result, offset, original_sha256: sha256(binary), migrated_sha256: sha256(result) };
}

const help = `LA-ERP 授权恢复工具（Node.js 22+，无第三方依赖）
  node tools/license.mjs keygen --dir <密钥目录>
  node tools/license.mjs machine [--root <Linux根目录>]
  node tools/license.mjs sign --private <private.pem> --machine-id <机器码> --out <license.key> [--edition pro|lite] [--expires <RFC3339>] [--extra <说明>]
  node tools/license.mjs verify --public <public.key> --file <license.key> [--machine-id <机器码>] [--edition pro|lite]
  node tools/license.mjs rotate --server <原始la-erp-server> --public <public.key> --out <迁移后的程序>
私钥留在签发电脑上；更换公钥后，旧私钥签发的授权不再有效。`;

function required(options, key) { if (!options[key]) throw Error(`缺少 --${key}`); return options[key]; }
function writeNew(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, data, { flag: 'wx', mode });
}
function cli() {
  const [cmd, ...args] = process.argv.slice(2), options = {};
  if (!cmd || cmd === '--help' || cmd === 'help') return console.log(help);
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) throw Error('参数必须按 --名称 值 提供');
    if (options[args[i].slice(2)] !== undefined) throw Error(`重复参数 ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  if (cmd === 'keygen') {
    const dir = path.resolve(required(options, 'dir'));
    if (fs.existsSync(path.join(dir, 'private.pem')) || fs.existsSync(path.join(dir, 'public.key'))) throw Error('目录已有密钥，不会覆盖');
    const pair = crypto.generateKeyPairSync('ed25519');
    writeNew(path.join(dir, 'private.pem'), pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const raw = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url');
    writeNew(path.join(dir, 'public.key'), raw.toString('base64') + '\n', 0o644);
    console.log(`已生成密钥：${dir}（私钥不上传仓库）`);
  } else if (cmd === 'machine') console.log(machineID(options.root || '/'));
  else if (cmd === 'sign') {
    const license = signLicense(fs.readFileSync(required(options, 'private')), { machine_id: required(options, 'machine-id'), edition: options.edition ?? 'pro', expires_at: options.expires || '', extra: options.extra || '' });
    writeNew(required(options, 'out'), JSON.stringify(license, null, 2) + '\n');
    console.log(`已签发：${options.out}`);
  } else if (cmd === 'verify') {
    console.log(JSON.stringify(verifyLicense(JSON.parse(fs.readFileSync(required(options, 'file'), 'utf8')), fs.readFileSync(required(options, 'public'), 'utf8'), { machine: options['machine-id'], edition: options.edition || 'pro' }), null, 2));
  } else if (cmd === 'rotate') {
    const original = path.resolve(required(options, 'server')), out = path.resolve(required(options, 'out'));
    if (original === out) throw Error('输出文件不能覆盖原程序');
    const result = rotateServerPublicKey(fs.readFileSync(original), fs.readFileSync(required(options, 'public'), 'utf8'));
    writeNew(out, result.binary, 0o755);
    console.log(JSON.stringify({ offset: result.offset, original_sha256: result.original_sha256, migrated_sha256: result.migrated_sha256 }, null, 2));
  } else throw Error(`未知命令 ${cmd}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); } catch (err) { console.error(err.message); process.exitCode = 1; }
}
