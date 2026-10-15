// Collects contracts from a disposable original server, never a production host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { machineID, signLicense, rotateServerPublicKey } from './license.mjs';

if (process.platform !== 'linux' || !process.argv[2] || !process.argv[3]) throw Error('Usage on Linux: node tools/capture-backend.mjs <original-server> <output-directory>');
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'la-erp-contract-'));
const pair = crypto.generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const binary = rotateServerPublicKey(fs.readFileSync(path.resolve(process.argv[2])), publicKey).binary;
const server = path.join(temp, 'server');
fs.writeFileSync(server, binary, { mode: 0o755 });
fs.mkdirSync(path.join(temp, 'data')); fs.mkdirSync(path.join(temp, 'logs')); fs.mkdirSync(path.join(temp, 'uploads'));
fs.writeFileSync(path.join(temp, 'license.key'), JSON.stringify(signLicense(privateKey, { machine_id: machineID(), edition: 'pro', expires_at: '' })));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const config = path.join(temp, 'config.yaml');
fs.writeFileSync(config, `server:\n  port: ${port}\n  mode: debug\ndatabase:\n  driver: sqlite\n  dsn: '${temp}/data/la-erp.db'\njwt:\n  secret: '${crypto.randomBytes(32).toString('hex')}'\n  access_token_ttl: 7200\n  refresh_token_ttl: 604800\nlog:\n  level: info\n  path: '${temp}/logs'\nupload:\n  path: '${temp}/uploads'\n  max_size: 10\nlicense:\n  enabled: true\n  file: '${temp}/license.key'\n  trial_days: 30\n`);
const child = spawn(server, ['-c', config], { cwd: temp, env: { ...process.env, TZ: 'Asia/Shanghai' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', exited = false;
child.stdout.on('data', chunk => logs += chunk);
child.stderr.on('data', chunk => logs += chunk);
child.on('exit', () => exited = true);
child.on('error', error => { logs += error.message; exited = true; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|secret|token|signature/i.test(key) ? '[redacted]' : sanitize(item)]));
  return value;
}
const records = [];
let token;
async function request(method, endpoint, body, authenticated = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated && token) headers.Authorization = `Bearer ${token}`;
  let payload=body===undefined?undefined:JSON.stringify(body);
  if(body?.$multipart){delete headers['Content-Type'];payload=new FormData();const f=body.$multipart;if(f.filename!==undefined){let bytes=Buffer.from(f.base64||'','base64');if(f.size_bytes){const padded=Buffer.alloc(f.size_bytes);bytes.copy(padded);bytes=padded}payload.append(f.field||'file',new Blob([bytes],{type:f.mime||'application/octet-stream'}),f.filename)}}
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers, body: payload, signal: AbortSignal.timeout(10000) });
  const raw=Buffer.from(await response.arrayBuffer());const text=raw.toString('utf8');
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 1000); }
  if(response.headers.get('content-type')?.startsWith('image/'))value={byte_length:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex'),content_type:response.headers.get('content-type')};
  records.push({ method, endpoint, request_body: sanitize(body), authenticated, status: response.status, body: sanitize(value) });
  return value;
}
try {
  let healthy = false;
  for (let i = 0; i < 120 && !exited; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) { healthy = true; break; } } catch {}
    await delay(500);
  }
  if (!healthy) throw Error('Original server did not start: ' + logs.slice(-3000));
  const login = await request('POST', '/api/v1/auth/login', { username: 'admin', password: 'admin123' }, false);
  token = login.data?.access_token;
  if (!token) throw Error('Fresh instance default login failed: ' + JSON.stringify(sanitize(login)));
  const inventory = JSON.parse(fs.readFileSync(new URL('../evidence/frontend-api-inventory.json', import.meta.url), 'utf8')).calls;
  const endpoints = new Set(['/api/v1/auth/me', '/api/v1/license/status']);
  for (const entry of inventory) {
    if (entry.method !== 'GET' || !/^['"`][^'"`]*['"`]$/.test(entry.path_expression || '') || entry.path_expression.includes('${')) continue;
    const route = entry.path_expression.slice(1, -1);
    if (!route.startsWith('/v1/') || /export|download|backup|template-file|stream/.test(route)) continue;
    endpoints.add('/api' + route);
  }
  for (const endpoint of endpoints) {
    try { await request('GET', endpoint); } catch (error) { records.push({ method: 'GET', endpoint, error: error.message }); }
  }
  // Fresh-instance mutations are recorded to reconstruct validation and CRUD semantics.
  const cases = [
    ['/api/v1/units', { name: '恢复测试单位', code: 'recovery-test-unit', precision: 2 }],
    ['/api/v1/warehouses', { name: '恢复测试仓库', code: 'recovery-test-wh', status: 'active' }],
    ['/api/v1/categories', { name: '恢复测试分类', code: 'recovery-test-category' }],
    ['/api/v1/departments', { name: '恢复测试部门', code: 'recovery-test-department' }],
    ['/api/v1/users', { username: 'recovery_test', password: 'recovery123', name: '恢复测试用户' }],
    ['/api/v1/customers', { name: '恢复测试客户', code: 'recovery-test-customer' }],
    ['/api/v1/suppliers', { name: '恢复测试供应商', code: 'recovery-test-supplier' }],
    ['/api/v1/products', { name: '恢复测试产品', code: 'recovery-test-product', product_type: 'finished', unit_id: null }]
  ];
  for (const [endpoint, fields] of cases) {
    await request('POST', endpoint, {});
    const create = await request('POST', endpoint, fields);
    const id = create.data?.id;
    if (!id) continue;
    await request('GET', endpoint + '/' + id);
    await request('PUT', endpoint + '/' + id, { name: fields.name + '已修改' });
    await request('DELETE', endpoint + '/' + id);
    await request('GET', endpoint + '/' + id);
  }
  await request('POST', '/api/v1/auth/login', { username: 'admin', password: 'wrong' }, false);
  await request('GET', '/api/v1/users', undefined, false);
  const schemaScript = String.raw`
import sqlite3,json,sys,pathlib
db=sqlite3.connect(sys.argv[1]);db.row_factory=sqlite3.Row
tables=[];sql=[];seed={}
for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"):
 item=dict(row);sql.append(item['sql']+';')
 if item['type']=='table':
  name=item['name'];quoted='"'+name.replace('"','""')+'"'
  item['columns']=[dict(x) for x in db.execute('PRAGMA table_info('+quoted+')')]
  item['foreign_keys']=[dict(x) for x in db.execute('PRAGMA foreign_key_list('+quoted+')')]
  item['row_count']=db.execute('SELECT count(*) FROM '+quoted).fetchone()[0]
  tables.append(item)
  if name not in ['audit_logs','refresh_tokens','export_files']:
   rows=[]
   for record in db.execute('SELECT * FROM '+quoted):
    record=dict(record)
    if record.get('deleted_at') or str(record.get('code','')).startswith('recovery-test') or record.get('username')=='recovery_test':continue
    for key in list(record):
     if 'password' in key or key.endswith('_secret'):record.pop(key)
    rows.append(record)
   if rows:seed[name]=rows
dest=pathlib.Path(sys.argv[2]);(dest/'database-schema.json').write_text(json.dumps(tables,ensure_ascii=False,indent=2),encoding='utf8')
(dest/'database-schema.sql').write_text('\n\n'.join(sql)+'\n',encoding='utf8')
(dest/'seed-data.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2,default=lambda v:{'$sqlite_blob':v.hex()} if isinstance(v,bytes) else str(v)),encoding='utf8')
(dest/'accounts-including-deleted.json').write_text(json.dumps([dict(x) for x in db.execute('SELECT * FROM accounts ORDER BY created_at')],ensure_ascii=False,indent=2),encoding='utf8')
(dest/'currencies-including-deleted.json').write_text(json.dumps([dict(x) for x in db.execute('SELECT * FROM currencies ORDER BY created_at')],ensure_ascii=False,indent=2),encoding='utf8')
for table in ['bank_accounts','bank_statements','bo_ms','bom_items','routings','routing_steps','work_centers','work_orders','work_order_materials','work_order_processes','subcontract_orders','subcontract_order_material_lines','subcontract_receive_logs']:(dest/(table+'-including-deleted.json')).write_text(json.dumps([dict(x) for x in db.execute('SELECT * FROM '+table+' ORDER BY created_at')],ensure_ascii=False,indent=2),encoding='utf8')
print('Actual tables:',len(tables))
`;
  const dump = spawnSync('python3', ['-c', schemaScript, path.join(temp, 'data/la-erp.db'), output], { encoding: 'utf8' });
  if (dump.status !== 0) throw Error(dump.stderr);
  console.log(dump.stdout.trim());
  const routes = logs.split('\n').filter(line => line.includes('[GIN-debug]') && /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(line));
  fs.writeFileSync(path.join(output, 'routes.txt'), routes.join('\n') + '\n');
  fs.writeFileSync(path.join(output, 'api-contracts.json'), JSON.stringify(records, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'capture-summary.json'), JSON.stringify({ original_sha256: crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'), route_lines: routes.length, requests: records.length, isolated_fresh_database: true, secrets_redacted: true }, null, 2) + '\n');
  console.log(`Captured ${routes.length} routes and ${records.length} request/response contracts.`);

  if(process.env.CAPTURE_MRP_ONLY==='1'){
    const start=records.length;const {captureMRPFlows}=await import('./capture-mrp-flows.mjs');
    const baseline=records.slice();
    try{await captureMRPFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'mrp-flow-contracts.json'),JSON.stringify(records.slice(start),null,2)+'\n');const state=path.join(output,'mrp-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const suggestionStart=records.length;const {captureSuggestionFlows}=await import('./capture-suggestion-flows.mjs');
    try{await captureSuggestionFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'suggestion-flow-contracts.json'),JSON.stringify(records.slice(suggestionStart),null,2)+'\n');const state=path.join(output,'suggestion-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const quantityStart=records.length;const {captureMRPQuantityFlows}=await import('./capture-mrp-quantity-flows.mjs');
    try{await captureMRPQuantityFlows(request)}finally{fs.writeFileSync(path.join(output,'mrp-quantity-contracts.json'),JSON.stringify(records.slice(quantityStart),null,2)+'\n');const state=path.join(output,'quantity-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const multiStart=records.length;const {captureSuggestionMultiline}=await import('./capture-suggestion-multiline.mjs');
    try{await captureSuggestionMultiline(request)}finally{fs.writeFileSync(path.join(output,'suggestion-multiline-contracts.json'),JSON.stringify(records.slice(multiStart),null,2)+'\n');const state=path.join(output,'multiline-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const nestedStart=records.length;const {captureMRPNested}=await import('./capture-mrp-nested.mjs');
    try{await captureMRPNested(request)}finally{fs.writeFileSync(path.join(output,'mrp-nested-contracts.json'),JSON.stringify(records.slice(nestedStart),null,2)+'\n');const state=path.join(output,'nested-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const generationStart=records.length;const {captureMRPGeneration}=await import('./capture-mrp-generation.mjs');
    try{await captureMRPGeneration(request)}finally{fs.writeFileSync(path.join(output,'mrp-generation-contracts.json'),JSON.stringify(records.slice(generationStart),null,2)+'\n');const state=path.join(output,'generation-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const versionStart=records.length;const {captureBOMVersions}=await import('./capture-bom-versions.mjs');
    try{await captureBOMVersions(request)}finally{fs.writeFileSync(path.join(output,'bom-version-contracts.json'),JSON.stringify(records.slice(versionStart),null,2)+'\n');const state=path.join(output,'version-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const lifecycleStart=records.length;const {captureBOMLifecycle}=await import('./capture-bom-lifecycle.mjs');
    try{await captureBOMLifecycle(request)}finally{fs.writeFileSync(path.join(output,'bom-lifecycle-contracts.json'),JSON.stringify(records.slice(lifecycleStart),null,2)+'\n');const state=path.join(output,'lifecycle-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const cycleStart=records.length;const {captureBOMCycles}=await import('./capture-bom-cycles.mjs');
    try{await captureBOMCycles(request)}finally{fs.writeFileSync(path.join(output,'bom-cycle-contracts.json'),JSON.stringify(records.slice(cycleStart),null,2)+'\n');const state=path.join(output,'cycle-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const duplicateStart=records.length;const {captureBOMDuplicates}=await import('./capture-bom-duplicates.mjs');
    try{await captureBOMDuplicates(request)}finally{fs.writeFileSync(path.join(output,'bom-duplicate-contracts.json'),JSON.stringify(records.slice(duplicateStart),null,2)+'\n');const state=path.join(output,'duplicate-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const serialStart=records.length;const {captureSerialNumbers}=await import('./capture-serial-numbers.mjs');
    try{await captureSerialNumbers(request)}finally{fs.writeFileSync(path.join(output,'serial-number-contracts.json'),JSON.stringify(records.slice(serialStart),null,2)+'\n');const state=path.join(output,'serial-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const depthStart=records.length;const {captureBOMDepth}=await import('./capture-bom-depth.mjs');
    try{await captureBOMDepth(request)}finally{fs.writeFileSync(path.join(output,'bom-depth-contracts.json'),JSON.stringify(records.slice(depthStart),null,2)+'\n');const state=path.join(output,'depth-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const mpsStart=records.length;const {captureMPSPlans}=await import('./capture-mps-plans.mjs');
    try{await captureMPSPlans(request)}finally{fs.writeFileSync(path.join(output,'mps-plan-contracts.json'),JSON.stringify(records.slice(mpsStart),null,2)+'\n');const state=path.join(output,'mps-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
  }
  if(process.env.CAPTURE_MRP_ONLY==='1'){
    const listStart=records.length;const {captureWorkOrderList}=await import('./capture-work-order-list.mjs');
    try{await captureWorkOrderList(request)}finally{fs.writeFileSync(path.join(output,'work-order-list-contracts.json'),JSON.stringify(records.slice(listStart),null,2)+'\n');const state=path.join(output,'work-order-list-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
  }
  if(process.env.CAPTURE_MRP_ONLY==='1'){
    const reworkStart=records.length;const {captureReworkOrders}=await import('./capture-rework-orders.mjs');
    try{await captureReworkOrders(request)}finally{fs.writeFileSync(path.join(output,'rework-order-contracts.json'),JSON.stringify(records.slice(reworkStart),null,2)+'\n');const state=path.join(output,'rework-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
  }
  if(process.env.CAPTURE_MRP_ONLY==='1'){
    const start=records.length;const {captureCapacityLoad}=await import('./capture-capacity-load.mjs');
    try{await captureCapacityLoad(request)}finally{fs.writeFileSync(path.join(output,'capacity-load-contracts.json'),JSON.stringify(records.slice(start),null,2)+'\n');const state=path.join(output,'capacity-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
  }
  if(process.env.CAPTURE_MRP_ONLY==='1'){
    const start=records.length;const {captureSubcontractOrders}=await import('./capture-subcontract-orders.mjs');
    try{await captureSubcontractOrders(request)}finally{fs.writeFileSync(path.join(output,'subcontract-order-contracts.json'),JSON.stringify(records.slice(start),null,2)+'\n');const state=path.join(output,'subcontract-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
  }
  if (process.env.CAPTURE_BUSINESS_CONTRACTS === '1') {
    const { captureBusinessFlows } = await import('./capture-business-flows.mjs');
    const baseline = records.slice();
    try { await captureBusinessFlows(request, baseline); }
    finally { fs.writeFileSync(path.join(output, 'business-flow-contracts.json'), JSON.stringify(records.slice(baseline.length), null, 2) + '\n'); const state = path.join(output, 'business-state'); fs.mkdirSync(state, {recursive:true}); const result = spawnSync('python3', ['-c', schemaScript, path.join(temp, 'data/la-erp.db'), state], {encoding:'utf8'}); if (result.status !== 0) throw new Error(result.stderr); }
    console.log(`Captured ${records.length - baseline.length} business-flow operations.`);
    const productionStart=records.length;
    const {captureProductionFlows}=await import('./capture-production-flows.mjs');
    try {await captureProductionFlows(request,baseline);}
    finally {fs.writeFileSync(path.join(output,'production-flow-contracts.json'),JSON.stringify(records.slice(productionStart),null,2)+'\n');const state=path.join(output,'production-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
    const reportsStart=records.length;
    for (const endpoint of ['/api/v1/reports/dashboard', '/api/v1/reports/export', '/api/v1/reports/finance/balance-sheet', '/api/v1/reports/finance/cash-flow', '/api/v1/reports/finance/general-ledger', '/api/v1/reports/finance/profit-loss', '/api/v1/reports/finance/statement/customer', '/api/v1/reports/finance/statement/supplier', '/api/v1/reports/finance/trial-balance', '/api/v1/reports/inventory/abc', '/api/v1/reports/inventory/age', '/api/v1/reports/inventory/balance', '/api/v1/reports/inventory/dormant', '/api/v1/reports/inventory/expiry-alert', '/api/v1/reports/inventory/reorder-suggestions', '/api/v1/reports/inventory/turnover', '/api/v1/reports/purchase/by-product', '/api/v1/reports/purchase/by-supplier', '/api/v1/reports/purchase/price-trend', '/api/v1/reports/purchase/trend', '/api/v1/reports/sales/by-customer', '/api/v1/reports/sales/by-product', '/api/v1/reports/sales/forecast', '/api/v1/reports/sales/profit', '/api/v1/reports/sales/profit-summary', '/api/v1/reports/sales/trend', '/api/v1/reports/trade/fulfillment', '/api/v1/reports/trade/fulfillment-summary']) await request('GET',endpoint);
    const month=new Date().toISOString().slice(0,7);
    for(const path of ['finance/trial-balance','finance/profit-loss','finance/balance-sheet','finance/cash-flow']) for(const query of [`period=${month}`,`period=2026-01`,`start_date=2026-01-01&end_date=2026-01-31`,`start_date=2026-01-01&end_date=2026-12-31`]) await request('GET',`/api/v1/reports/${path}?${query}`);
    for(const code of ['1001','1122','1403','2202','6001']) await request('GET',`/api/v1/reports/finance/general-ledger?account_code=${code}`);
    for(const path of ['sales/by-product','sales/by-customer','sales/trend','sales/profit','purchase/by-product','purchase/by-supplier','purchase/trend','purchase/price-trend']) for(const query of ['start_date=2026-01-01&end_date=2026-01-31','start_date=2026-01-01&end_date=2026-12-31']) await request('GET',`/api/v1/reports/${path}?${query}`);
    for(const path of ['finance/trial-balance','finance/profit-loss','finance/balance-sheet']) await request('GET',`/api/v1/reports/${path}?start_date=2026-11-01&end_date=2026-11-30`);
    fs.writeFileSync(path.join(output,'report-contracts.json'),JSON.stringify(records.slice(reportsStart),null,2)+'\n');
    const probeStart=records.length;
    const accountResponse=await request('GET','/api/v1/accounts?page_size=1000');
    const accounts=Array.isArray(accountResponse.data)?accountResponse.data:(accountResponse.data?.list||[]);
    const cash=accounts.find(x=>x.code==='1001');
    for(const code of ['1601','2001','6001']) {
      const contra=accounts.find(x=>x.code===code);
      if(!cash||!contra)throw Error('Missing cash classification account');
      const doc=await request('POST','/api/v1/vouchers',{type:'general',voucher_date:new Date().toISOString(),remark:'现金流分类验证 '+code,total_debit:20,total_credit:20,entries:[{account_id:cash.id,account_code:cash.code,account_name:cash.name,direction:'debit',amount:20},{account_id:contra.id,account_code:contra.code,account_name:contra.name,direction:'credit',amount:20}]});
      if(!doc.data?.id)throw Error('Cash classification voucher failed');
      await request('POST','/api/v1/vouchers/'+doc.data.id+'/post',{});
      await request('GET','/api/v1/reports/finance/cash-flow');
    }
    fs.writeFileSync(path.join(output,'report-classification-contracts.json'),JSON.stringify(records.slice(probeStart),null,2)+'\n');
    const inventoryStart=records.length;
    const {captureInventoryFlows}=await import('./capture-inventory-flows.mjs');
    try{await captureInventoryFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'inventory-flow-contracts.json'),JSON.stringify(records.slice(inventoryStart),null,2)+'\n')}
    const unitStart=records.length;const {captureUnitFlows}=await import('./capture-unit-flows.mjs');
    try{await captureUnitFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'unit-flow-contracts.json'),JSON.stringify(records.slice(unitStart),null,2)+'\n');const state=path.join(output,'unit-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const photoStart=records.length;const {capturePhotoFlows}=await import('./capture-photo-flows.mjs');
    try{await capturePhotoFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'photo-flow-contracts.json'),JSON.stringify(records.slice(photoStart),null,2)+'\n')}
    const statementStart=records.length;const {captureStatementFlows}=await import('./capture-statement-flows.mjs');
    try{await captureStatementFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'statement-flow-contracts.json'),JSON.stringify(records.slice(statementStart),null,2)+'\n')}
    const reorderStart=records.length;const {captureReorderFlows}=await import('./capture-reorder-flows.mjs');
    try{await captureReorderFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'reorder-flow-contracts.json'),JSON.stringify(records.slice(reorderStart),null,2)+'\n')}
    const uploadStart=records.length;const {captureUploadFlows}=await import('./capture-upload-flows.mjs');
    try{await captureUploadFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'upload-flow-contracts.json'),JSON.stringify(records.slice(uploadStart),null,2)+'\n')}
    const accountStart=records.length;const {captureAccountFlows}=await import('./capture-account-flows.mjs');
    try{await captureAccountFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'account-flow-contracts.json'),JSON.stringify(records.slice(accountStart),null,2)+'\n');const state=path.join(output,'account-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const mappingStart=records.length;const {captureMappingFlows}=await import('./capture-mapping-flows.mjs');
    try{await captureMappingFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'mapping-flow-contracts.json'),JSON.stringify(records.slice(mappingStart),null,2)+'\n');const state=path.join(output,'mapping-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const currencyStart=records.length;const {captureCurrencyFlows}=await import('./capture-currency-flows.mjs');
    try{await captureCurrencyFlows(request)}finally{fs.writeFileSync(path.join(output,'currency-flow-contracts.json'),JSON.stringify(records.slice(currencyStart),null,2)+'\n');const state=path.join(output,'currency-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
    const bankStart=records.length;const {captureBankFlows}=await import('./capture-bank-flows.mjs');
    try{await captureBankFlows(request,baseline)}finally{fs.writeFileSync(path.join(output,'bank-flow-contracts.json'),JSON.stringify(records.slice(bankStart),null,2)+'\n');const state=path.join(output,'bank-state');fs.mkdirSync(state,{recursive:true});const result=spawnSync('python3',['-c',schemaScript,path.join(temp,'data/la-erp.db'),state],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}




  }
} finally {
  if (!exited) child.kill('SIGTERM');
  for (let i = 0; i < 30 && !exited; i++) await delay(100);
  if (!exited) { child.kill('SIGKILL'); await delay(200); }
  fs.rmSync(temp, { recursive: true, force: true });
}
