export async function captureBOMCycles(request){
 const unit=(await request('GET','/api/v1/units')).data.list[0];
 const create=async code=>{const r=await request('POST','/api/v1/products',{code,name:code,unit_id:unit.id,product_type:'finished',cost_method:'weighted_avg',purchase_price:code.endsWith('A')?2:3});if(!r.data?.id)throw Error('Cycle product missing');return r.data};
 const a=await create('REC-CYCLE-A'),b=await create('REC-CYCLE-B');
 const item=(p,qty=1)=>({product_id:p.id,product_code:p.code,product_name:p.name,unit_id:unit.id,qty,scrap_rate:0});
 const body=(p,items,qty_per=1)=>({product_id:p.id,product_code:p.code,product_name:p.name,qty_per,items});
 const self=await request('POST','/api/v1/boms',body(a,[item(a)]));if(!self.data?.id)throw Error('Self BOM missing');await request('GET',`/api/v1/boms/${self.data.id}/tree`);
 const ab=await request('POST','/api/v1/boms',body(a,[item(b)]));if(!ab.data?.id)throw Error('Cycle A BOM missing');
 const ba=await request('POST','/api/v1/boms',body(b,[item(a)]));if(!ba.data?.id)throw Error('Cycle B BOM missing');
 await request('GET',`/api/v1/boms/${ab.data.id}/tree`);await request('GET',`/api/v1/boms/${ba.data.id}/tree`);
 const customer=(await request('GET','/api/v1/customers?page_size=100')).data.list.find(x=>x.code==='REC-MRP-CUSTOMER');const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:a.id,qty:1,unit_cost:2}]});if(!stock.data?.id)throw Error('Cycle stock missing');await request('POST',`/api/v1/stock-ins/${stock.data.id}/confirm`,{});
 const sale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:a.id,unit_id:unit.id,qty:1,price:10}]});if(!sale.data?.id)throw Error('Cycle sale missing');
 await request('POST',`/api/v1/sales-orders/${sale.data.id}/confirm`,{});await request('POST','/api/v1/mrp/run',{});
}
