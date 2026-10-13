import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signLicense, verifyLicense } from '../license.mjs';

function publicText(privateKey) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('请选择 Ed25519 私钥文件');
  return Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).x, 'base64url').toString('base64');
}
function newFile(filename, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, content, { flag: 'wx', mode });
}
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 32768) throw Error('请求过大');
}
try {
  const request = JSON.parse(input);
  let result;
  if (request.action === 'keygen') {
    const directory = path.resolve(request.directory);
    const privatePath = path.join(directory, 'private.pem'), publicPath = path.join(directory, 'public.key');
    if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw Error('目录中已有密钥，请选择一个新目录，现有密钥不会被覆盖');
    const pair = crypto.generateKeyPairSync('ed25519');
    const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
    const pub = publicText(pem);
    newFile(privatePath, pem);
    newFile(publicPath, pub + '\n', 0o644);
    result = { privatePath, publicText: pub };
  } else if (request.action === 'info') {
    result = { publicText: publicText(fs.readFileSync(request.privatePath)) };
  } else if (request.action === 'sign') {
    const pem = fs.readFileSync(request.privatePath);
    const pub = publicText(pem);
    const expires = request.expires || '';
    if (expires && Date.parse(expires) <= Date.now()) throw Error('到期时间必须晚于当前时间');
    const record = signLicense(pem, { machine_id: request.machine, edition: 'pro', expires_at: expires, extra: request.extra || '' });
    const verification = verifyLicense(record, pub, { machine: request.machine });
    newFile(request.output, JSON.stringify(record, null, 2) + '\n');
    result = { output: path.resolve(request.output), license: record, verification, publicText: pub };
  } else throw Error('未知操作');
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
