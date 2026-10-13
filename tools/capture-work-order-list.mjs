export async function captureWorkOrderList(request) {
  const unit=(await request('GET','/api/v1/units')).data.list[0];
  const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
  const create=async(endpoint,body)=>{const r=await request('POST','/api/v1/'+endpoint,body);if(!r.data?.id)throw Error(endpoint+': '+JSON.stringify(r));return r.data;};
  const product=await create('products',{code:'REC-LIST-FIN',name:'REC-LIST-FIN',product_type:'finished',unit_id:unit.id,cost_method:'weighted_avg'});
  const raw=await create('products',{code:'REC-LIST-RAW',name:'REC-LIST-RAW',product_type:'raw_material',unit_id:unit.id,cost_method:'weighted_avg'});
  const stock=await create('stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:30,unit_cost:3}]});
  await request('POST',`/api/v1/stock-ins/${stock.id}/confirm`,{});
  const bom=await create('boms',{product_id:product.id,items:[{product_id:raw.id,unit_id:unit.id,qty:2,scrap_rate:0}]});
  const center=await create('work-centers',{code:'REC-LIST-WC',name:'REC-LIST-WC',cost_rate:2,capacity:8});
  const routing=await create('routings',{product_id:product.id,steps:[1,2].map(sequence=>({sequence,process_code:'LIST'+sequence,process_name:'LIST'+sequence,work_center_id:center.id,work_center:center.name,standard_time:1}))});
  const wo=await create('work-orders',{product_id:product.id,qty:2,bom_id:bom.id,routing_id:routing.id,warehouse_id:warehouse.id});
  const list=()=>request('GET','/api/v1/work-orders?product_id='+product.id);
  await list();await request('POST',`/api/v1/work-orders/${wo.id}/confirm`,{});await list();await request('POST',`/api/v1/work-orders/${wo.id}/approve`,{});await list();
  const picking=await create('production-pickings',{work_order_id:wo.id,warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:4,unit_cost:3}]});
  await request('POST',`/api/v1/production-pickings/${picking.id}/confirm`,{});await list();
  const receipt=await create('production-receipts',{work_order_id:wo.id,warehouse_id:warehouse.id,lines:[{product_id:product.id,qty:2,unit_cost:0}]});
  await list();await request('POST',`/api/v1/production-receipts/${receipt.id}/confirm`,{});await list();
  for(const step of wo.edges.processes){await request('POST',`/api/v1/work-order-processes/${step.id}/start`,{});await request('POST',`/api/v1/work-order-processes/${step.id}/complete`,{qty_good:2,qty_bad:0,actual_time:1,labor_rate:2});await list();}
  await request('POST',`/api/v1/work-order-processes/${wo.edges.processes[0].id}/revert`,{});await list();
  await request('POST',`/api/v1/work-order-processes/${wo.edges.processes[0].id}/start`,{});await request('POST',`/api/v1/work-order-processes/${wo.edges.processes[0].id}/complete`,{qty_good:2,qty_bad:0,actual_time:1,labor_rate:2});await list();
  const returned=await create('production-returns',{work_order_id:wo.id,warehouse_id:warehouse.id,reason:'excess',lines:[{product_id:raw.id,qty:1,unit_cost:3}]});
  await request('POST',`/api/v1/production-returns/${returned.id}/confirm`,{});await list();
  const replacement=await create('production-pickings',{work_order_id:wo.id,warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:1,unit_cost:3}]});
  await request('POST',`/api/v1/production-pickings/${replacement.id}/confirm`,{});await list();
  await request('POST',`/api/v1/work-orders/${wo.id}/complete`,{});await list();
  await request('GET','/api/v1/routings?product_id='+product.id);
  await request('DELETE',`/api/v1/routings/${routing.id}`);
  await request('DELETE',`/api/v1/work-centers/${center.id}`);
  const unusedCenter=await create('work-centers',{code:'REC-DELETE-WC',name:'REC-DELETE-WC',cost_rate:1});
  const unusedRouting=await create('routings',{product_id:product.id,steps:[{sequence:1,process_code:'UNUSED',process_name:'UNUSED',work_center_id:unusedCenter.id,work_center:unusedCenter.name,standard_time:1}]});
  const draftWork=await create('work-orders',{product_id:product.id,qty:1,bom_id:bom.id,routing_id:unusedRouting.id,warehouse_id:warehouse.id});
  await request('DELETE',`/api/v1/work-centers/${unusedCenter.id}`);
  await request('DELETE',`/api/v1/routings/${unusedRouting.id}`);
  await request('GET',`/api/v1/routings/${unusedRouting.id}`);
  await request('DELETE',`/api/v1/routings/${unusedRouting.id}`);
  await request('DELETE',`/api/v1/work-centers/${unusedCenter.id}`);
  await request('GET',`/api/v1/work-centers/${unusedCenter.id}`);
  await request('DELETE',`/api/v1/work-centers/${unusedCenter.id}`);

  await request('GET',`/api/v1/work-orders/${draftWork.id}`);
  await request('GET',`/api/v1/work-orders/${wo.id}`);
  await request('DELETE',`/api/v1/work-orders/${wo.id}`);
  await request('DELETE',`/api/v1/work-orders/${draftWork.id}`);
  await request('GET',`/api/v1/work-orders/${draftWork.id}`);
  await request('DELETE',`/api/v1/work-orders/${draftWork.id}`);

}
