export async function captureMRPQuantityFlows(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
 const raw=products.find(x=>x.code==='REC-MRP-RAW'),finished=products.find(x=>x.code==='REC-MRP-FINISHED');
 const warehouse=(await request('GET','/api/v1/warehouses')).data.list.find(x=>x.is_default);
 const sales=(await request('GET','/api/v1/sales-orders?page_size=100')).data.list.find(x=>x.status==='approved');
 const purchase=(await request('GET','/api/v1/purchase-orders?page_size=100')).data.list.find(x=>x.status==='approved');
 const work=(await request('GET','/api/v1/work-orders?page_size=100')).data.list.find(x=>x.status==='in_progress');
 const run=()=>request('POST','/api/v1/mrp/run',{});
 await request('PUT','/api/v1/products/'+raw.id,{min_order_qty:10});await run();await request('PUT','/api/v1/products/'+raw.id,{min_order_qty:0,safety_stock:30});await run();await request('PUT','/api/v1/products/'+raw.id,{safety_stock:2});
 const pick=await request('POST','/api/v1/production-pickings',{work_order_id:work.id,work_order_no:work.order_no,warehouse_id:warehouse.id,lines:[{product_id:raw.id,product_code:raw.code,product_name:raw.name,qty:2,unit_cost:1}]});if(!pick.data?.id)throw Error('Quantity picking missing');await request('POST','/api/v1/production-pickings/'+pick.data.id+'/confirm',{});await run();
 const shipment=await request('POST','/api/v1/stock-outs',{type:'sales',source_id:sales.id,source_no:sales.order_no,warehouse_id:warehouse.id,lines:[{product_id:finished.id,qty:2,unit_cost:3}]});if(!shipment.data?.id)throw Error('Quantity shipment missing');await request('POST','/api/v1/stock-outs/'+shipment.data.id+'/confirm',{});await request('GET','/api/v1/sales-orders/'+sales.id);await run();
 const incoming=await request('POST','/api/v1/stock-ins',{type:'purchase',source_id:purchase.id,source_no:purchase.order_no,warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:2,unit_cost:1}]});if(!incoming.data?.id)throw Error('Quantity inbound missing');await request('POST','/api/v1/stock-ins/'+incoming.data.id+'/confirm',{});await request('GET','/api/v1/purchase-orders/'+purchase.id);await run();
 const ret=await request('POST','/api/v1/production-returns',{work_order_id:work.id,work_order_no:work.order_no,warehouse_id:warehouse.id,reason:'excess',lines:[{product_id:raw.id,product_code:raw.code,product_name:raw.name,qty:1,unit_cost:1}]});if(!ret.data?.id)throw Error('Quantity return missing');await request('POST','/api/v1/production-returns/'+ret.data.id+'/confirm',{});await run();
 const receipt=await request('POST','/api/v1/production-receipts',{work_order_id:work.id,work_order_no:work.order_no,warehouse_id:warehouse.id,lines:[{product_id:finished.id,qty:1,unit_cost:0}]});if(!receipt.data?.id)throw Error('Quantity receipt missing');await request('POST','/api/v1/production-receipts/'+receipt.data.id+'/confirm',{});await request('GET','/api/v1/work-orders/'+work.id);await run();
 await request('POST','/api/v1/work-orders/'+work.id+'/complete',{});await run();
}
