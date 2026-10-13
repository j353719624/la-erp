export async function captureSuggestionMultiline(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
 const raw=products.find(x=>x.code==='REC-MRP-RAW'),finished=products.find(x=>x.code==='REC-MRP-FINISHED');
 const boms=(await request('GET','/api/v1/boms?page_size=100')).data.list;
 const bom=boms.find(x=>x.product_id===finished.id);
 await request('PUT','/api/v1/products/'+raw.id,{purchase_price:7});
 async function runConvert(){
  const plan=await request('POST','/api/v1/mrp/run',{});
  const list=await request('GET','/api/v1/purchase-suggestions?page_size=100');const suggestion=list.data.list.find(x=>x.mrp_id===plan.data.id);if(!suggestion)throw Error('Suggestion missing');
  await request('GET','/api/v1/purchase-suggestions/'+suggestion.id);
  const converted=await request('POST','/api/v1/purchase-suggestions/'+suggestion.id+'/convert',{});if(!converted.data?.id)throw Error('Conversion missing');
  await request('GET','/api/v1/purchase-orders/'+converted.data.id);await request('GET','/api/v1/purchase-suggestions/'+suggestion.id);await request('POST','/api/v1/purchase-suggestions/'+suggestion.id+'/convert',{});
  return plan.data;
 }
 await runConvert();
 const component=await request('POST','/api/v1/products',{code:'REC-MRP-RAW2',name:'REC-MRP-RAW2',product_type:'raw_material',unit_id:raw.unit_id,purchase_price:9,cost_method:'weighted_avg'});if(!component.data?.id)throw Error('Component missing');
 await request('PUT','/api/v1/boms/'+bom.id,{product_id:finished.id,product_code:finished.code,product_name:finished.name,version:'1.0',items:[{product_id:raw.id,unit_id:raw.unit_id,product_code:raw.code,product_name:raw.name,qty:3,scrap_rate:0},{product_id:component.data.id,unit_id:raw.unit_id,product_code:component.data.code,product_name:component.data.name,qty:2,scrap_rate:0}]});
 const second=await request('POST','/api/v1/products',{code:'REC-MRP-FINISHED2',name:'REC-MRP-FINISHED2',product_type:'finished',unit_id:raw.unit_id,cost_method:'weighted_avg'});if(!second.data?.id)throw Error('Second finished missing');
 await request('POST','/api/v1/boms',{product_id:second.data.id,product_code:second.data.code,product_name:second.data.name,version:'1.0',items:[{product_id:raw.id,unit_id:raw.unit_id,product_code:raw.code,product_name:raw.name,qty:3},{product_id:component.data.id,unit_id:raw.unit_id,product_code:component.data.code,product_name:component.data.name,qty:2}]});
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:(await request('GET','/api/v1/warehouses')).data.list[0].id,lines:[{product_id:second.data.id,qty:1,unit_cost:1}]});if(!stock.data?.id)throw Error('Second stock missing');await request('POST','/api/v1/stock-ins/'+stock.data.id+'/confirm',{});
 const existing=(await request('GET','/api/v1/sales-orders?page_size=100')).data.list.find(x=>x.status==='approved');
 const sale=await request('POST','/api/v1/sales-orders',{customer_id:existing.customer_id,warehouse_id:existing.warehouse_id,lines:[{product_id:second.data.id,unit_id:raw.unit_id,qty:1,price:10}]});if(!sale.data?.id)throw Error('Second sales missing');await request('POST','/api/v1/sales-orders/'+sale.data.id+'/confirm',{});
 await runConvert();
 await request('GET','/api/v1/work-orders?page_size=100');await request('GET','/api/v1/purchase-orders?page_size=100');
}
