// Run only against the workflow's disposable original instance.
export async function captureInventoryFlows(request,baseline){
 const list=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name&&x.method==='GET')?.body?.data?.list||[];
 const product=list('products')[0],warehouse=list('warehouses')[0];
 if(!product||!warehouse)throw Error('Inventory capture masters missing');
 const date=new Date().toISOString();
 const second=await request('POST','/api/v1/warehouses',{name:'恢复调拨目标仓库',code:'recovery-transfer-target',status:'active'});
 if(!second.data?.id)throw Error('Transfer target missing');
 const balance=async()=>{for(const wh of [warehouse.id,second.data.id])await request('GET',`/api/v1/inventory-balances?product_id=${product.id}&warehouse_id=${wh}`);};
 const seed=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:warehouse.id,stock_in_date:date,lines:[{product_id:product.id,qty:20,unit_cost:7}]});
 if(!seed.data?.id)throw Error('Inventory seed failed');await request('POST',`/api/v1/stock-ins/${seed.data.id}/confirm`,{});await balance();
 const line={product_id:product.id,product_code:product.code,product_name:product.name,unit_id:product.unit_id,qty:3,cost_price:99,unit_cost:99};
 for(const scenario of ['same','complete','cancel-dispatched','cancel-draft','overshoot','delete','edit']){
  const body={from_warehouse_id:warehouse.id,to_warehouse_id:scenario==='same'?warehouse.id:second.data.id,transfer_date:date,remark:'恢复调拨 '+scenario,lines:[{...line,qty:scenario==='overshoot'?999:3}]};
  const doc=await request('POST','/api/v1/stock-transfers',body);if(!doc.data?.id)continue;
  const p='/api/v1/stock-transfers/'+doc.data.id;await request('GET',p);
  if(scenario==='delete'){await request('DELETE',p);await request('GET',p);continue}
  if(scenario==='edit'){await request('PUT',p,{...body,remark:'调拨编辑',lines:[{...line,qty:2}]});await request('GET',p);await request('DELETE',p);continue}
  if(scenario!=='cancel-draft'){await request('POST',p+'/dispatch',{});await request('GET',p);await balance()}
  const action=scenario==='complete'?'complete':'cancel';await request('POST',p+'/'+action,{});await request('GET',p);await balance();await request('POST',p+'/'+action,{});await request('DELETE',p);
 }
 for(const type of ['increase','decrease','gain','loss']){
  const doc=await request('POST','/api/v1/inventory-adjusts',{warehouse_id:warehouse.id,adjust_type:type,adjust_date:date,remark:'恢复库存调整 '+type,lines:[{...line,qty:2,unit_cost:11}]});if(!doc.data?.id)continue;
  const p='/api/v1/inventory-adjusts/'+doc.data.id;await request('GET',p);await request('POST',p+'/confirm',{});await request('GET',p);await balance();await request('POST',p+'/cancel',{});await request('GET',p);await balance();await request('DELETE',p);
 }
 for(const type of ['profit','cost']){
  const body={warehouse_id:warehouse.id,adjust_type:type,adjust_date:date,remark:'恢复正式调整类型 '+type,lines:[{...line,qty:type==='cost'?0:2,unit_cost:12}]};
  const doc=await request('POST','/api/v1/inventory-adjusts',body);if(!doc.data?.id)continue;
  const p='/api/v1/inventory-adjusts/'+doc.data.id;await request('GET',p);await request('POST',p+'/confirm',{});await request('GET',p);await balance();await request('POST',p+'/confirm',{});
 }
 for(const action of ['edit','cancel','delete']){
  const body={warehouse_id:warehouse.id,adjust_type:'profit',adjust_date:date,remark:'恢复调整草稿 '+action,lines:[{...line,qty:2,unit_cost:12}]};
  const doc=await request('POST','/api/v1/inventory-adjusts',body);if(!doc.data?.id)continue;const p='/api/v1/inventory-adjusts/'+doc.data.id;
  if(action==='edit'){await request('PUT',p,{...body,remark:'调整编辑验证',lines:[{...line,qty:4,unit_cost:9}]});await request('GET',p)}
  if(action==='cancel'){await request('POST',p+'/cancel',{});await request('GET',p);await request('POST',p+'/confirm',{})}
  await request('DELETE',p);await request('GET',p);await balance();
 }
 for(const qty of [5,40]){
  const doc=await request('POST','/api/v1/inventory-checks',{warehouse_id:warehouse.id,check_date:date,remark:'恢复盘点',lines:[{product_id:product.id,actual_qty:qty,unit_cost:99}]});if(!doc.data?.id)continue;
  const p='/api/v1/inventory-checks/'+doc.data.id;await request('GET',p);await request('POST',p+'/start',{});await request('GET',p);await request('PUT',p,{lines:[{product_id:product.id,actual_qty:qty,unit_cost:99}]});await request('PUT',p,{warehouse_id:warehouse.id,check_date:date,remark:'盘点差异验证',lines:[{product_id:product.id,actual_qty:qty,unit_cost:99}]});await request('GET',p);await request('POST',p+'/complete',{});await request('GET',p);await balance();await request('POST',p+'/cancel',{});await request('DELETE',p);
 }
 for(const action of ['delete','cancel-draft','cancel-started']){
  const doc=await request('POST','/api/v1/inventory-checks',{warehouse_id:warehouse.id,check_date:date,remark:'盘点边界 '+action,lines:[{product_id:product.id,actual_qty:1}]});if(!doc.data?.id)continue;const p='/api/v1/inventory-checks/'+doc.data.id;
  if(action==='cancel-started')await request('POST',p+'/start',{});
  if(action!=='delete'){await request('POST',p+'/cancel',{});await request('GET',p);await request('POST',p+'/complete',{})}
  await request('DELETE',p);await request('GET',p);await balance();
 }
 for(const action of ['complete','cancel']){
  const doc=await request('POST','/api/v1/stock-transfers',{from_warehouse_id:warehouse.id,to_warehouse_id:second.data.id,remark:'调拨中途均价变化 '+action,lines:[{...line,qty:3,cost_price:99}]});if(!doc.data?.id)throw Error('Changing-cost transfer create failed');const p='/api/v1/stock-transfers/'+doc.data.id;
  await request('POST',p+'/dispatch',{});await balance();
  const stock=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:warehouse.id,lines:[{product_id:product.id,qty:2,unit_cost:100}]});if(!stock.data?.id)throw Error('Intervening stock create failed');await request('POST','/api/v1/stock-ins/'+stock.data.id+'/confirm',{});await balance();
  await request('POST',p+'/'+action,{});await request('GET',p);await balance();
 }
 const check=await request('POST','/api/v1/inventory-checks',{warehouse_id:warehouse.id,lines:[{product_id:product.id,actual_qty:8}]});if(!check.data?.id)throw Error('Stale-stock check create failed');const cp='/api/v1/inventory-checks/'+check.data.id;await request('POST',cp+'/start',{});await request('PUT',cp,{warehouse_id:warehouse.id,lines:[{product_id:product.id,actual_qty:8}]});
 const changed=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:warehouse.id,lines:[{product_id:product.id,qty:2,unit_cost:100}]});await request('POST','/api/v1/stock-ins/'+changed.data.id+'/confirm',{});await request('POST',cp+'/complete',{});await request('GET',cp);await balance();
 await request('GET','/api/v1/stock-movements?page_size=1000');
}
