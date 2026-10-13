export async function captureBOMDuplicates(request){
 const unit=(await request('GET','/api/v1/units')).data.list[0],warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
 const make=async(code,type)=>{const r=await request('POST','/api/v1/products',{code,name:code,unit_id:unit.id,product_type:type,cost_method:'weighted_avg',purchase_price:2});if(!r.data?.id)throw Error('Duplicate product missing');return r.data};
 const raw=await make('REC-DUP-RAW','raw_material'),finished=await make('REC-DUP-FIN','finished');
 const item=qty=>({product_id:raw.id,product_code:raw.code,product_name:raw.name,unit_id:unit.id,qty,scrap_rate:0});
 const bom=await request('POST','/api/v1/boms',{product_id:finished.id,product_code:finished.code,product_name:finished.name,items:[item(1),item(2)]});if(!bom.data?.id)return;
 await request('GET',`/api/v1/boms/${bom.data.id}`);await request('GET',`/api/v1/boms/${bom.data.id}/tree`);
 const work=await request('POST','/api/v1/work-orders',{product_id:finished.id,bom_id:bom.data.id,warehouse_id:warehouse.id,qty:2});if(work.data?.id){await request('GET',`/api/v1/work-orders/${work.data.id}/materials`);await request('GET',`/api/v1/work-orders/${work.data.id}/bom-items`)}
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:finished.id,qty:2,unit_cost:2}]});if(!stock.data?.id)throw Error('Duplicate stock missing');await request('POST',`/api/v1/stock-ins/${stock.data.id}/confirm`,{});
 const customer=(await request('GET','/api/v1/customers?page_size=100')).data.list.find(x=>x.code==='REC-MRP-CUSTOMER');
 const sale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:finished.id,unit_id:unit.id,qty:2,price:10}]});if(!sale.data?.id)throw Error('Duplicate sale missing');await request('POST',`/api/v1/sales-orders/${sale.data.id}/confirm`,{});await request('POST','/api/v1/mrp/run',{});
 if(work.data?.id){await request('PUT',`/api/v1/work-orders/${work.data.id}`,{product_id:finished.id,bom_id:bom.data.id,warehouse_id:warehouse.id,qty:3});await request('GET',`/api/v1/work-orders/${work.data.id}/materials`);await request('GET',`/api/v1/work-orders/${work.data.id}/bom-items`)}

}
