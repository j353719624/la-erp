export async function captureReorderFlows(request,baseline){
 const list=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name&&x.method==='GET')?.body?.data?.list||[];
 const wh=list('warehouses')[0],supplier=list('suppliers')[0],unit=list('units')[0];if(!wh||!supplier||!unit)throw Error('Reorder masters missing');
 const customer=await request('POST','/api/v1/customers',{name:'恢复补货客户',code:'REC-REORDER-CUSTOMER'});
 const product=await request('POST','/api/v1/products',{name:'恢复补货商品',code:'REC-REORDER-PRODUCT',product_type:'finished',unit_id:unit.id,safety_stock:10});
 if(!customer.data?.id||!product.data?.id)throw Error('Reorder masters create failed');
 const query=async()=>{await request('GET','/api/v1/reports/inventory/reorder-suggestions');await request('GET','/api/v1/reports/inventory/reorder-suggestions?product_id='+product.data.id)};
 const line={product_id:product.data.id,product_code:product.data.code,product_name:product.data.name,unit_id:unit.id,qty:15,price:2,unit_cost:2};
 await query();
 const incoming=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:wh.id,lines:[line]});if(!incoming.data?.id)throw Error('Reorder stock missing');await request('POST','/api/v1/stock-ins/'+incoming.data.id+'/confirm',{});await query();
 const so=await request('POST','/api/v1/sales-orders',{customer_id:customer.data.id,warehouse_id:wh.id,lines:[{...line,qty:6,price:3}]});if(!so.data?.id)throw Error('Reorder sales missing');await query();await request('POST','/api/v1/sales-orders/'+so.data.id+'/confirm',{});await query();await request('POST','/api/v1/sales-orders/'+so.data.id+'/approve',{});await query();
 const po=await request('POST','/api/v1/purchase-orders',{supplier_id:supplier.id,warehouse_id:wh.id,lines:[{...line,qty:2}]});if(!po.data?.id)throw Error('Reorder purchase missing');await query();await request('POST','/api/v1/purchase-orders/'+po.data.id+'/confirm',{});await query();await request('POST','/api/v1/purchase-orders/'+po.data.id+'/approve',{});await query();
 const linked=await request('POST','/api/v1/stock-ins',{type:'purchase',warehouse_id:wh.id,source_id:po.data.id,source_no:po.data.order_no,lines:[{...line,qty:1}]});if(!linked.data?.id)throw Error('Reorder partial receipt missing');await request('POST','/api/v1/stock-ins/'+linked.data.id+'/confirm',{});await query();
 await request('POST','/api/v1/purchase-orders/'+po.data.id+'/cancel',{});await query();await request('POST','/api/v1/sales-orders/'+so.data.id+'/cancel',{});await query();
 for(const [incoming,qty] of [[false,2],[true,1],[false,4]]){
  const order=incoming?po.data:so.data,route=incoming?'stock-ins':'stock-outs';const doc=await request('POST','/api/v1/'+route,{type:incoming?'purchase':'sales',warehouse_id:wh.id,source_id:order.id,source_no:order.order_no,lines:[{...line,qty}]});
  if(!doc.data?.id)throw Error('Reorder fulfillment missing');await request('POST','/api/v1/'+route+'/'+doc.data.id+'/confirm',{});await query();
 }
 await request('PUT','/api/v1/products/'+product.data.id,{safety_stock:0});
 const zero=await request('POST','/api/v1/sales-orders',{customer_id:customer.data.id,warehouse_id:wh.id,lines:[{...line,qty:8,price:3}]});if(!zero.data?.id)throw Error('Zero safety order missing');
 await request('POST','/api/v1/sales-orders/'+zero.data.id+'/confirm',{});await query();await request('POST','/api/v1/sales-orders/'+zero.data.id+'/cancel',{});await query();
}
