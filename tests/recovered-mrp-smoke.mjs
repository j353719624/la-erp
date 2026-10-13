import { spawn } from 'node:child_process';
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const binary = resolve(process.argv[2] || 'backend/la-erp-server');
await access(binary);
const dir = await mkdtemp(join(tmpdir(), 'la-erp-source-smoke-'));
const uploadDir=join(dir,'photo-storage');const configFile=join(dir,'upload.yaml');
await writeFile(configFile,`upload:\n  path: '${uploadDir.replaceAll('\\','/').replaceAll("'","''")}'\n  max_size: 10\n`);
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child, output = '', token;
async function start() {
  child = spawn(binary, ['-dev','-c',configFile, '-listen', `127.0.0.1:${port}`, '-db', join(dir, 'test.db')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Source server exited: ${output}`);
    try { const r = await fetch(base + '/health'); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Source server did not start: ' + output);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await exited;
}
async function request(method, path, body, expected = 200) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json(); assert.equal(res.status, expected, JSON.stringify(json));
  if (expected === 200) assert.equal(json.code, 0, JSON.stringify(json));
  return json.data;
}
try {
 await start();
 token=(await request('POST','/api/v1/auth/login',{username:'admin',password:'admin123'})).access_token;
 const unit=(await request('GET','/api/v1/units')).list[0];
 const warehouse=(await request('GET','/api/v1/warehouses')).list[0];
 const customer=await request('POST','/api/v1/customers',{code:'MRP-SMOKE-C',name:'MRP customer'});
 const makeProduct=(code,type)=>request('POST','/api/v1/products',{code,name:code,unit_id:unit.id,product_type:type,cost_method:'weighted_avg'});
 const raw=await makeProduct('MRP-SMOKE-RAW','raw_material'),finished=await makeProduct('MRP-SMOKE-FINISHED','finished');
 await request('POST','/api/v1/boms',{product_id:finished.id,product_name:finished.name,product_code:finished.code,items:[{product_id:raw.id,product_name:raw.name,product_code:raw.code,unit_id:unit.id,qty:3}]});
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:finished.id,qty:5,unit_cost:3}]});
 await request('POST',`/api/v1/stock-ins/${stock.id}/confirm`,{});
 const sale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:finished.id,unit_id:unit.id,qty:5,price:10}]});
 await request('POST',`/api/v1/sales-orders/${sale.id}/confirm`,{});
 const plan=await request('POST','/api/v1/mrp/run',{});
 assert.equal(plan.demand_source_count,1);
 const demand=plan.edges.lines.find(x=>x.product_id===raw.id);assert.equal(demand.gross_demand,'15');assert.equal(demand.suggested_qty,'15');
 const production=plan.edges.lines.find(x=>x.product_id===finished.id);assert.equal(production.available_qty,'0');assert.equal(production.suggested_qty,'5');
 const generate=()=>request('POST',`/api/v1/mrp/requirements/${plan.id}/generate-work-orders`,{});
 const first=(await generate())[0],second=(await generate())[0];assert.notEqual(first.id,second.id);assert.equal(first.qty,'5');assert.deepEqual(first.edges,{});
 const suggestions=(await request('GET','/api/v1/purchase-suggestions')).list;assert.equal(suggestions.length,1);assert.equal(suggestions[0].mrp_id,plan.id);
 const suggestion=suggestions[0];
 const converted=await request('POST',`/api/v1/purchase-suggestions/${suggestion.id}/convert`,{supplier_id:customer.id,warehouse_id:warehouse.id});
 assert.equal(converted.total_qty,'15');assert.equal(converted.total_amount,'0');assert.equal(converted.supplier_id,undefined);assert.equal(converted.warehouse_id,undefined);
 const ordered=await request('GET',`/api/v1/purchase-suggestions/${suggestion.id}`);assert.equal(ordered.status,'ordered');assert.equal(ordered.edges.lines[0].status,'ordered');
 await stop();await start();
 const persisted=await request('GET',`/api/v1/mrp/requirements/${plan.id}`);assert.equal(persisted.edges.lines.find(x=>x.product_id===raw.id).suggested_qty,'15');
 const persistedPurchase=await request('GET',`/api/v1/purchase-orders/${converted.id}`);assert.equal(persistedPurchase.edges.lines[0].qty,'15');assert.equal(persistedPurchase.edges.lines[0].price,'0');
 assert.equal((await request('GET',`/api/v1/work-orders/${first.id}`)).qty,'5');
 await request('DELETE',`/api/v1/mrp/requirements/${plan.id}`);await request('DELETE',`/api/v1/mrp/requirements/${plan.id}`);
 await request('GET',`/api/v1/mrp/requirements/${plan.id}`,undefined,404);
 assert.equal((await request('GET','/api/v1/purchase-suggestions')).list.length,1);
 assert.equal((await request('GET',`/api/v1/work-orders/${second.id}`)).qty,'5');
 await request('DELETE',`/api/v1/purchase-suggestions/${suggestion.id}`);await request('DELETE',`/api/v1/purchase-suggestions/${suggestion.id}`);
 await request('GET',`/api/v1/purchase-suggestions/${suggestion.id}`,undefined,404);
 assert.equal((await request('GET',`/api/v1/purchase-orders/${converted.id}`)).total_qty,'15');
 const nestRaw=await makeProduct('NEST-SMOKE-RAW','raw_material'),semi=await makeProduct('NEST-SMOKE-SEMI','semi_finished'),top=await makeProduct('NEST-SMOKE-TOP','finished');
 const item=(p,qty,scrap_rate)=>({product_id:p.id,product_name:p.name,product_code:p.code,unit_id:unit.id,qty,scrap_rate});
 await request('POST','/api/v1/boms',{product_id:semi.id,qty_per:2,items:[item(nestRaw,3,.1)]});
 const topBom=await request('POST','/api/v1/boms',{product_id:top.id,qty_per:4,items:[item(semi,2,.25)]});
 const nestedStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:top.id,qty:2,unit_cost:10},{product_id:semi.id,qty:1,unit_cost:6},{product_id:nestRaw.id,qty:1,unit_cost:2}]});
 await request('POST',`/api/v1/stock-ins/${nestedStock.id}/confirm`,{});
 const nestedSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:top.id,unit_id:unit.id,qty:2,price:20}]});await request('POST',`/api/v1/sales-orders/${nestedSale.id}/confirm`,{});
 const nestedPlan=await request('POST','/api/v1/mrp/run',{});assert.equal(nestedPlan.edges.lines.find(x=>x.product_id===semi.id).gross_demand,'5');assert.equal(nestedPlan.edges.lines.find(x=>x.product_id===nestRaw.id).gross_demand,'16.5');
 const nestedGenerated=await request('POST',`/api/v1/mrp/requirements/${nestedPlan.id}/generate-work-orders`,{});assert.equal(nestedGenerated.length,3);
 const topWork=nestedGenerated.find(x=>x.product_id===top.id),semiWork=nestedGenerated.find(x=>x.product_id===semi.id);assert.equal(topWork.qty,'2');assert.equal(semiWork.qty,'4');
 assert.equal((await request('GET',`/api/v1/work-orders/${topWork.id}/materials`))[0].qty_required,'1.0025');assert.equal((await request('GET',`/api/v1/work-orders/${semiWork.id}/materials`))[0].qty_required,'6.006');
 await request('PUT',`/api/v1/products/${nestRaw.id}`,{purchase_price:2});await request('PUT',`/api/v1/products/${semi.id}`,{purchase_price:7});
 const tree=await request('GET',`/api/v1/boms/${topBom.id}/tree`);assert.equal(tree.total_cost,'26');assert.equal(tree.children[0].line_cost,'14');assert.equal(tree.children[0].children[0].total_qty,'6');
 await stop();await start();assert.equal((await request('GET',`/api/v1/boms/${topBom.id}/tree`)).total_cost,'26');assert.equal((await request('GET',`/api/v1/mrp/requirements/${nestedPlan.id}`)).edges.lines.find(x=>x.product_id===nestRaw.id).gross_demand,'16.5');
 assert.equal((await request('GET',`/api/v1/work-orders/${topWork.id}/materials`))[0].qty_required,'1.0025');
 await request('POST','/api/v1/boms/00000000-0000-0000-0000-000000000001/activate',{},500);
 const oldSemi=(await request('GET','/api/v1/boms')).list.find(x=>x.product_id===semi.id);
 const newSemi=await request('POST','/api/v1/boms',{product_id:semi.id,version:'0.5',qty_per:1,items:[item(nestRaw,4,0)]});
 assert.equal((await request('GET',`/api/v1/boms/${topBom.id}/tree`)).total_cost,'30');
 await request('POST',`/api/v1/boms/${oldSemi.id}/activate`,{});
 assert.equal((await request('GET',`/api/v1/boms/${topBom.id}/tree`)).children[0].bom_id,newSemi.id);
 const versionPlan=await request('POST','/api/v1/mrp/run',{});assert.equal(versionPlan.edges.lines.find(x=>x.product_id===nestRaw.id).gross_demand,'20');
 const versionWorks=await request('POST',`/api/v1/mrp/requirements/${versionPlan.id}/generate-work-orders`,{});const versionSemi=versionWorks.find(x=>x.product_id===semi.id);assert.equal(versionSemi.bom_id,newSemi.id);
 assert.equal((await request('GET',`/api/v1/work-orders/${versionSemi.id}/materials`))[0].qty_required,'16');
 await stop();await start();assert.equal((await request('GET',`/api/v1/boms/${topBom.id}/tree`)).children[0].bom_id,newSemi.id);

 assert.equal((await request('POST',`/api/v1/boms/${newSemi.id}/deactivate`,{})).status,'inactive');
 assert.equal((await request('GET',`/api/v1/boms/${topBom.id}/tree`)).total_cost,'26');
 await request('POST',`/api/v1/boms/${newSemi.id}/deactivate`,{});
 await request('POST',`/api/v1/boms/${oldSemi.id}/deactivate`,{});
 const inactiveTree=await request('GET',`/api/v1/boms/${topBom.id}/tree`);assert.equal(inactiveTree.total_cost,'14');assert.equal(inactiveTree.children[0].has_bom,false);
 const inactivePlan=await request('POST','/api/v1/mrp/run',{});assert.equal(inactivePlan.edges.lines.find(x=>x.product_id===semi.id).requirement_type,'purchase');assert.equal(inactivePlan.edges.lines.some(x=>x.product_id===nestRaw.id),false);
 await request('POST','/api/v1/boms/00000000-0000-0000-0000-000000000001/deactivate',{},500);
 await stop();await start();assert.equal((await request('GET',`/api/v1/boms/${newSemi.id}`)).status,'inactive');

 const rejected=await fetch(base+`/api/v1/boms/${newSemi.id}`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});const rejection=await rejected.json();assert.equal(rejection.code,10000);assert.equal(rejection.message,'该 BOM 已被 1 张工单引用，不能删除（请先删除关联的草稿工单）');
 assert.equal((await request('GET',`/api/v1/boms/${newSemi.id}`)).status,'inactive');
 const unusedBom=await request('POST','/api/v1/boms',{product_id:semi.id,qty_per:1,items:[item(nestRaw,5,0)]});
 await request('DELETE',`/api/v1/boms/${unusedBom.id}`);await request('GET',`/api/v1/boms/${unusedBom.id}`,undefined,404);
 for(const [method,path] of [['DELETE',`/api/v1/boms/${unusedBom.id}`],['POST',`/api/v1/boms/${unusedBom.id}/activate`],['POST',`/api/v1/boms/${unusedBom.id}/deactivate`],['DELETE','/api/v1/boms/00000000-0000-0000-0000-000000000001']]){
 const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});const json=await res.json();assert.equal(res.status,200);assert.equal(json.code,10000);assert.equal(json.message,'BOM不存在');
 }
 await stop();await start();await request('GET',`/api/v1/boms/${unusedBom.id}`,undefined,404);assert.equal((await request('GET',`/api/v1/work-orders/${versionSemi.id}`)).bom_id,newSemi.id);

 const bomList=(await request('GET','/api/v1/boms?page_size=100')).list;const listedBom=bomList.find(x=>x.id===newSemi.id);assert.equal(listedBom.edges.product.id,semi.id);assert.equal(listedBom.edges.items[0].qty,'4');assert.deepEqual(listedBom.edges.items[0].edges,{});assert.equal(bomList.some(x=>x.id===unusedBom.id),false);

 const cycleA=await makeProduct('CYCLE-SMOKE-A','finished'),cycleB=await makeProduct('CYCLE-SMOKE-B','finished');await request('PUT',`/api/v1/products/${cycleA.id}`,{purchase_price:2});await request('PUT',`/api/v1/products/${cycleB.id}`,{purchase_price:3});
 const selfBom=await request('POST','/api/v1/boms',{product_id:cycleA.id,items:[item(cycleA,1,0)]});const selfTree=await request('GET',`/api/v1/boms/${selfBom.id}/tree`);assert.equal(selfTree.total_cost,'4');assert.equal(selfTree.children[0].children[0].circular,true);
 const cycleAB=await request('POST','/api/v1/boms',{product_id:cycleA.id,items:[item(cycleB,1,0)]}),cycleBA=await request('POST','/api/v1/boms',{product_id:cycleB.id,items:[item(cycleA,1,0)]});
 const cycleTree=await request('GET',`/api/v1/boms/${cycleAB.id}/tree`);assert.equal(cycleTree.total_cost,'8');assert.equal(cycleTree.children[0].children[0].children[0].circular,true);assert.deepEqual(cycleTree.children[0].children[0].children[0].children,[]);assert.equal((await request('GET',`/api/v1/boms/${cycleBA.id}/tree`)).total_cost,'7');
 const cycleStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:cycleA.id,qty:1,unit_cost:2}]});await request('POST',`/api/v1/stock-ins/${cycleStock.id}/confirm`,{});
 const cycleSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:cycleA.id,unit_id:unit.id,qty:1,price:10}]});await request('POST',`/api/v1/sales-orders/${cycleSale.id}/confirm`,{});
 const cyclePlan=await request('POST','/api/v1/mrp/run',{});assert.equal(cyclePlan.edges.lines.find(x=>x.product_id===cycleA.id).gross_demand,'5');assert.equal(cyclePlan.edges.lines.find(x=>x.product_id===cycleB.id).gross_demand,'4');
 await stop();await start();assert.equal((await request('GET',`/api/v1/boms/${cycleAB.id}/tree`)).total_cost,'8');assert.equal((await request('GET',`/api/v1/mrp/requirements/${cyclePlan.id}`)).edges.lines.find(x=>x.product_id===cycleB.id).gross_demand,'4');

 const dupRaw=await makeProduct('DUP-SMOKE-RAW','raw_material'),dupFin=await makeProduct('DUP-SMOKE-FIN','finished');await request('PUT',`/api/v1/products/${dupRaw.id}`,{purchase_price:2});
 const dupBom=await request('POST','/api/v1/boms',{product_id:dupFin.id,items:[item(dupRaw,1,0),item(dupRaw,2,0)]});assert.equal(dupBom.edges.items.length,2);assert.equal((await request('GET',`/api/v1/boms/${dupBom.id}/tree`)).total_cost,'6');
 const dupWork=await request('POST','/api/v1/work-orders',{product_id:dupFin.id,bom_id:dupBom.id,warehouse_id:warehouse.id,qty:2});
 const dupMaterials=await request('GET',`/api/v1/work-orders/${dupWork.id}/materials`);assert.deepEqual(dupMaterials.map(x=>x.qty_required).sort(),['2','4']);assert.notEqual(dupMaterials[0].id,dupMaterials[1].id);assert.deepEqual((await request('GET',`/api/v1/work-orders/${dupWork.id}/bom-items`)).map(x=>x.qty).sort(),['2','4']);
 const dupStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:dupFin.id,qty:2,unit_cost:2}]});await request('POST',`/api/v1/stock-ins/${dupStock.id}/confirm`,{});
 const dupSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:dupFin.id,unit_id:unit.id,qty:2,price:10}]});await request('POST',`/api/v1/sales-orders/${dupSale.id}/confirm`,{});
 const dupPlan=await request('POST','/api/v1/mrp/run',{});assert.equal(dupPlan.edges.lines.find(x=>x.product_id===dupRaw.id).gross_demand,'6');
 await stop();await start();assert.deepEqual((await request('GET',`/api/v1/work-orders/${dupWork.id}/materials`)).map(x=>x.qty_required).sort(),['2','4']);

 await request('PUT',`/api/v1/work-orders/${dupWork.id}`,{product_id:dupFin.id,bom_id:dupBom.id,warehouse_id:warehouse.id,qty:3});
 const editedDup=await request('GET',`/api/v1/work-orders/${dupWork.id}/materials`);assert.deepEqual(editedDup.map(x=>x.qty_required).sort(),['2','6']);assert.deepEqual(editedDup.map(x=>x.id).sort(),dupMaterials.map(x=>x.id).sort());
 const editedItems=await request('GET',`/api/v1/work-orders/${dupWork.id}/bom-items`);assert.deepEqual(editedItems.map(x=>x.qty).sort(),['3','6']);assert.equal(editedItems[0].unit_cost,'2');
 await stop();await start();assert.deepEqual((await request('GET',`/api/v1/work-orders/${dupWork.id}/materials`)).map(x=>x.qty_required).sort(),['2','6']);

 const stockBeforeSerial=await request('GET','/api/v1/inventory-balances?page_size=100');const movesBeforeSerial=await request('GET','/api/v1/stock-movements?page_size=100');
 const serialBody={product_id:dupFin.id,product_code:dupFin.code,product_name:dupFin.name,warehouse_id:warehouse.id,serial_nos:['SMOKE-SN-001','SMOKE-SN-002','SMOKE-SN-003']};assert.equal((await request('POST','/api/v1/serial-numbers',serialBody)).registered,3);
 const serialRows=(await request('GET','/api/v1/serial-numbers?page_size=100')).list;const serialOut=serialRows.find(x=>x.serial_no==='SMOKE-SN-001'),serialScrap=serialRows.find(x=>x.serial_no==='SMOKE-SN-002');assert.equal(serialRows[0].edges,undefined);
 assert.equal((await request('POST',`/api/v1/serial-numbers/${serialOut.id}/out`,{})).status,'out');assert.equal((await request('POST',`/api/v1/serial-numbers/${serialScrap.id}/scrap`,{})).status,'scrapped');
 const serialFailed=await fetch(base+'/api/v1/serial-numbers',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...serialBody,serial_nos:['SMOKE-SN-NEW','SMOKE-SN-003']})});assert.equal((await serialFailed.json()).code,10000);
 assert.equal((await request('GET','/api/v1/serial-numbers?status=in_stock')).total,1);assert.equal((await request('GET','/api/v1/serial-numbers?keyword=SMOKE-SN-001')).total,1);await request('GET',`/api/v1/serial-numbers/${serialOut.id}`,undefined,404);
 assert.deepEqual(await request('GET','/api/v1/inventory-balances?page_size=100'),stockBeforeSerial);assert.deepEqual(await request('GET','/api/v1/stock-movements?page_size=100'),movesBeforeSerial);
 await stop();await start();const persistedSerials=(await request('GET','/api/v1/serial-numbers?page_size=100')).list;assert.equal(persistedSerials.length,3);assert.equal(persistedSerials.find(x=>x.serial_no==='SMOKE-SN-001').status,'out');assert.equal(persistedSerials.find(x=>x.serial_no==='SMOKE-SN-002').status,'scrapped');

 const depthProducts=[],depthBoms=[];for(let i=0;i<11;i++){const p=await makeProduct('DEPTH-SMOKE-'+i,i===10?'raw_material':'finished');await request('PUT',`/api/v1/products/${p.id}`,{purchase_price:1});depthProducts.push(p)}
 for(let i=9;i>=0;i--){depthBoms[i]=await request('POST','/api/v1/boms',{product_id:depthProducts[i].id,items:[item(depthProducts[i+1],1,0)]})}
 const depthTree=await request('GET',`/api/v1/boms/${depthBoms[0].id}/tree`);assert.equal(depthTree.total_cost,'10');let depthNode=depthTree.children[0];for(let d=1;d<=10;d++){assert.equal(depthNode.depth,d);assert.equal(depthNode.circular,false);if(d<10)depthNode=depthNode.children[0]}assert.equal(depthNode.has_bom,false);assert.deepEqual(depthNode.children,[]);
 assert.equal((await request('GET',`/api/v1/boms/${depthBoms[1].id}/tree`)).total_cost,'9');assert.equal((await request('GET',`/api/v1/boms/${depthBoms[2].id}/tree`)).total_cost,'8');
 await stop();await start();assert.equal((await request('GET',`/api/v1/boms/${depthBoms[0].id}/tree`)).total_cost,'10');

 const mpsFin=await makeProduct('MPS-SMOKE-FIN','finished');await request('POST','/api/v1/boms',{product_id:mpsFin.id,items:[item(dupRaw,2,0)]});
 const mpsStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:mpsFin.id,qty:10,unit_cost:2}]});await request('POST',`/api/v1/stock-ins/${mpsStock.id}/confirm`,{});
 const mpsSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,order_date:'2026-10-15T00:00:00+08:00',lines:[{product_id:mpsFin.id,unit_id:unit.id,qty:6,price:10}]});
 const mpsPeriod={period_start:'2026-10-01T00:00:00+08:00',period_end:'2026-10-31T23:59:59+08:00',product_ids:[mpsFin.id]};
 const draftOnly=await request('POST','/api/v1/mps-plans',mpsPeriod);assert.deepEqual(draftOnly.edges,{});assert.equal((await request('POST',`/api/v1/mps-plans/${draftOnly.id}/generate-work-orders`,{})).created,0);assert.equal((await request('GET',`/api/v1/mps-plans/${draftOnly.id}`)).status,'planned');
 await request('POST',`/api/v1/sales-orders/${mpsSale.id}/confirm`,{});const mps=await request('POST','/api/v1/mps-plans',mpsPeriod);const mpsLine=mps.edges.lines[0];assert.equal(mpsLine.qty_demand,'6');assert.equal(mpsLine.qty_onhand,'4');assert.equal(mpsLine.net_qty,'2');
 await request('PUT',`/api/v1/products/${mpsFin.id}`,{min_order_qty:5});assert.equal((await request('POST',`/api/v1/mps-plans/${mps.id}/generate-work-orders`,{})).created,1);assert.equal((await request('GET',`/api/v1/mps-plans/${mps.id}`)).edges.lines[0].status,'planned');
 const mpsWork=(await request('GET','/api/v1/work-orders?product_id='+mpsFin.id)).list.find(x=>x.remark==='MPS计划生成');assert.equal(mpsWork.qty,'2');assert.equal(mpsWork.bom_id,undefined);assert.equal(mpsWork.warehouse_id,undefined);assert.equal(mpsWork.planned_start_date,mpsPeriod.period_start);assert.deepEqual(await request('GET',`/api/v1/work-orders/${mpsWork.id}/materials`),[]);
 await request('POST',`/api/v1/work-orders/${mpsWork.id}/confirm`,{});const wipMps=await request('POST','/api/v1/mps-plans',mpsPeriod);assert.equal(wipMps.edges.lines[0].qty_wip,'2');assert.equal(wipMps.edges.lines[0].net_qty,'0');await request('POST',`/api/v1/work-orders/${mpsWork.id}/approve`,{});assert.equal((await request('POST','/api/v1/mps-plans',mpsPeriod)).edges.lines[0].net_qty,'0');
 assert.deepEqual((await request('POST','/api/v1/mps-plans',{...mpsPeriod,period_start:'2026-10-16T00:00:00+08:00',period_end:'2026-10-21T00:00:00+08:00'})).edges,{});
 const zeroNetMps=await request('POST','/api/v1/mps-plans',mpsPeriod);assert.equal(zeroNetMps.edges.lines[0].net_qty,'0');assert.equal((await request('POST',`/api/v1/mps-plans/${zeroNetMps.id}/generate-work-orders`,{})).created,0);const zeroNetDetail=await request('GET',`/api/v1/mps-plans/${zeroNetMps.id}`);assert.equal(zeroNetDetail.status,'planned');assert.equal(zeroNetDetail.edges.lines[0].status,'pending');const mpsListed=(await request('GET','/api/v1/mps-plans?page_size=100')).list.find(x=>x.id===zeroNetMps.id);assert.deepEqual(mpsListed.edges,zeroNetDetail.edges);
 await request('DELETE',`/api/v1/mps-plans/${wipMps.id}`);const deletedMpsResponse=await fetch(base+`/api/v1/mps-plans/${wipMps.id}`,{headers:{Authorization:'Bearer '+token}});assert.equal((await deletedMpsResponse.json()).code,10000);
 await stop();await start();assert.equal((await request('GET',`/api/v1/mps-plans/${mps.id}`)).status,'planned');assert.equal((await request('GET',`/api/v1/work-orders/${mpsWork.id}`)).qty,'2');
 const rework=await request('POST','/api/v1/rework-orders',{qty_rework:3,qty_good:2,qty_bad:1,reason:'smoke rework'});assert.equal(rework.status,'draft');assert.equal(rework.edges,undefined);await request('PUT',`/api/v1/rework-orders/${rework.id}`,{reason:'partial reason'});const reworkPartial=await request('GET',`/api/v1/rework-orders/${rework.id}`);assert.equal(reworkPartial.qty_rework,'3');assert.equal(reworkPartial.qty_good,'2');assert.equal(reworkPartial.reason,'partial reason');await request('PUT',`/api/v1/rework-orders/${rework.id}`,{qty_rework:4,qty_good:3,qty_bad:1,reason:'edited rework'});assert.equal((await request('POST',`/api/v1/rework-orders/${rework.id}/confirm`,{})).status,'confirmed');assert.equal((await request('POST',`/api/v1/rework-orders/${rework.id}/complete`,{})).status,'completed');const cancelledRework=await request('POST','/api/v1/rework-orders',{qty_rework:2});assert.equal((await request('POST',`/api/v1/rework-orders/${cancelledRework.id}/cancel`,{})).status,'cancelled');assert.equal((await request('POST',`/api/v1/rework-orders/${cancelledRework.id}/cancel`,{})).status,'cancelled');const removedRework=await request('POST','/api/v1/rework-orders',{qty_rework:1});await request('DELETE',`/api/v1/rework-orders/${removedRework.id}`);const deletedReworkResponse=await fetch(base+`/api/v1/rework-orders/${removedRework.id}`,{headers:{Authorization:'Bearer '+token}});assert.equal((await deletedReworkResponse.json()).code,10000);await stop();await start();assert.equal((await request('GET',`/api/v1/rework-orders/${rework.id}`)).status,'completed');assert.equal((await request('GET',`/api/v1/rework-orders/${rework.id}`)).qty_good,'3');
 console.log('MRP and suggestion standalone smoke passed, including nested BOM/scrap demand, nominal tree quantities, assembly and component costs and repeated database/JWT restart.');
} finally {await stop();console.log('Retained MRP smoke data: '+dir);}
