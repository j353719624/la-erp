export async function captureMRPNested(request){
 const unit=(await request('GET','/api/v1/units')).data.list[0],warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
 const customer=(await request('GET','/api/v1/customers?page_size=100')).data.list.find(x=>x.code==='REC-MRP-CUSTOMER');
 const create=async(code,type)=>{const r=await request('POST','/api/v1/products',{code,name:code,product_type:type,unit_id:unit.id,cost_method:'weighted_avg'});if(!r.data?.id)throw Error('Nested product missing');return r.data};
 const raw=await create('REC-NEST-RAW','raw_material'),semi=await create('REC-NEST-SEMI','semi_finished'),top=await create('REC-NEST-TOP','finished');
 const item=(product,qty,scrap_rate)=>({product_id:product.id,product_code:product.code,product_name:product.name,unit_id:unit.id,qty,scrap_rate});
 const b1=await request('POST','/api/v1/boms',{product_id:semi.id,product_name:semi.name,product_code:semi.code,qty_per:2,version:'1.0',items:[item(raw,3,.1)]});if(!b1.data?.id)throw Error('Nested component BOM missing');
 const b2=await request('POST','/api/v1/boms',{product_id:top.id,product_name:top.name,product_code:top.code,qty_per:4,version:'1.0',items:[item(semi,2,.25)]});if(!b2.data?.id)throw Error('Nested top BOM missing');
 await request('GET','/api/v1/boms/'+b2.data.id+'/tree');
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:top.id,qty:2,unit_cost:10},{product_id:semi.id,qty:1,unit_cost:6},{product_id:raw.id,qty:1,unit_cost:2}]});if(!stock.data?.id)throw Error('Nested stock missing');await request('POST','/api/v1/stock-ins/'+stock.data.id+'/confirm',{});
 const demand=async(product,qty)=>{const sale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,lines:[{product_id:product.id,unit_id:unit.id,qty,price:20}]});if(!sale.data?.id)throw Error('Nested demand missing');await request('POST','/api/v1/sales-orders/'+sale.data.id+'/confirm',{});return request('POST','/api/v1/mrp/run',{})};
 await demand(top,2);await demand(semi,1);await demand(raw,1);
 await request('GET','/api/v1/purchase-suggestions?page_size=100');
 await request('PUT','/api/v1/products/'+raw.id,{purchase_price:2});await request('GET','/api/v1/boms/'+b2.data.id+'/tree');
 await request('PUT','/api/v1/products/'+semi.id,{purchase_price:7});await request('GET','/api/v1/boms/'+b2.data.id+'/tree');
}
