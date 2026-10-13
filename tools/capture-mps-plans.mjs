export async function captureMPSPlans(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;const finished=products.find(x=>x.code==='REC-MRP-FINISHED2');
 await request('GET','/api/v1/mps-plans?page_size=100');
 await request('POST','/api/v1/mps-plans',{});
 const period={period_start:'2026-10-01T00:00:00+08:00',period_end:'2026-10-31T23:59:59+08:00'};
 const first=await request('POST','/api/v1/mps-plans',period);if(first.data?.id){await request('GET',`/api/v1/mps-plans/${first.data.id}`);await request('POST',`/api/v1/mps-plans/${first.data.id}/generate-work-orders`,{});await request('POST',`/api/v1/mps-plans/${first.data.id}/generate-work-orders`,{});await request('DELETE',`/api/v1/mps-plans/${first.data.id}`);await request('DELETE',`/api/v1/mps-plans/${first.data.id}`);await request('GET',`/api/v1/mps-plans/${first.data.id}`)}
 await request('POST','/api/v1/mps-plans',{...period,product_ids:[finished.id]});
 await request('POST','/api/v1/mps-plans',{period_start:'2027-01-01T00:00:00+08:00',period_end:'2027-01-31T23:59:59+08:00'});
 await request('POST','/api/v1/mps-plans',{period_start:'invalid',period_end:period.period_end});
 await request('POST','/api/v1/mps-plans',{period_start:period.period_end,period_end:period.period_start});
 await request('GET','/api/v1/mps-plans?page_size=100');
 await request('GET','/api/v1/mps-plans/00000000-0000-0000-0000-000000000001');await request('DELETE','/api/v1/mps-plans/00000000-0000-0000-0000-000000000001');await request('POST','/api/v1/mps-plans/00000000-0000-0000-0000-000000000001/generate-work-orders',{});
 const unit=(await request('GET','/api/v1/units')).data.list[0],warehouse=(await request('GET','/api/v1/warehouses')).data.list[0],customer=(await request('GET','/api/v1/customers?page_size=100')).data.list.find(x=>x.code==='REC-MRP-CUSTOMER'),raw=products.find(x=>x.code==='REC-MRP-RAW2');
 const p=await request('POST','/api/v1/products',{code:'REC-MPS-FIN',name:'REC-MPS-FIN',product_type:'finished',unit_id:unit.id,cost_method:'weighted_avg'});if(!p.data?.id)throw Error('MPS product missing');const fin=p.data;
 const bom=await request('POST','/api/v1/boms',{product_id:fin.id,items:[{product_id:raw.id,unit_id:unit.id,qty:2,scrap_rate:0}]});if(!bom.data?.id)throw Error('MPS BOM missing');
 const stock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:fin.id,qty:10,unit_cost:2}]});if(!stock.data?.id)throw Error('MPS stock missing');await request('POST',`/api/v1/stock-ins/${stock.data.id}/confirm`,{});
 const sale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,order_date:'2026-10-15T00:00:00+08:00',expected_date:'2026-10-20T00:00:00+08:00',lines:[{product_id:fin.id,unit_id:unit.id,qty:6,price:10}]});if(!sale.data?.id)throw Error('MPS sale missing');
 await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});await request('POST',`/api/v1/sales-orders/${sale.data.id}/confirm`,{});await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});
 const shipment=await request('POST','/api/v1/stock-outs',{warehouse_id:warehouse.id,source_id:sale.data.id,source_no:sale.data.order_no,lines:[{product_id:fin.id,qty:5,unit_cost:2}]});if(!shipment.data?.id)throw Error('MPS shipment missing');await request('POST',`/api/v1/stock-outs/${shipment.data.id}/confirm`,{});
 const partial=await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});if(!partial.data?.id)throw Error('MPS partial plan missing');
 await request('PUT','/api/v1/products/'+fin.id,{min_order_qty:5});
 await request('POST',`/api/v1/mps-plans/${partial.data.id}/generate-work-orders`,{});await request('GET',`/api/v1/mps-plans/${partial.data.id}`);await request('GET','/api/v1/work-orders?product_id='+fin.id);
 const draft=await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});if(draft.data?.id){await request('DELETE',`/api/v1/mps-plans/${draft.data.id}`);await request('DELETE',`/api/v1/mps-plans/${draft.data.id}`);await request('GET',`/api/v1/mps-plans/${draft.data.id}`)}

 await request('POST','/api/v1/mps-plans',{period_start:'2026-10-16T00:00:00+08:00',period_end:'2026-10-21T00:00:00+08:00',product_ids:[fin.id]});
 const works=(await request('GET','/api/v1/work-orders?product_id='+fin.id)).data.list;const generated=works.find(x=>x.remark==='MPS计划生成');if(generated){await request('GET',`/api/v1/work-orders/${generated.id}/materials`);await request('POST',`/api/v1/work-orders/${generated.id}/confirm`,{});await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});await request('POST',`/api/v1/work-orders/${generated.id}/approve`,{});await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]})}

 const zero=await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id]});
 if(zero.data?.id){await request('POST',`/api/v1/mps-plans/${zero.data.id}/generate-work-orders`,{});await request('GET',`/api/v1/mps-plans/${zero.data.id}`)}
 await request('GET','/api/v1/mps-plans?page_size=100');
 const rawStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:50,unit_cost:1}]});if(rawStock.data?.id)await request('POST',`/api/v1/stock-ins/${rawStock.data.id}/confirm`,{});
 const rawSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,order_date:'2026-10-15T00:00:00+08:00',lines:[{product_id:raw.id,unit_id:unit.id,qty:30,price:1}]});
 if(rawSale.data?.id){await request('POST',`/api/v1/sales-orders/${rawSale.data.id}/confirm`,{});await request('POST','/api/v1/mps-plans',{...period,product_ids:[raw.id]});const extraSale=await request('POST','/api/v1/sales-orders',{customer_id:customer.id,warehouse_id:warehouse.id,order_date:'2026-10-15T00:00:00+08:00',lines:[{product_id:fin.id,unit_id:unit.id,qty:2,price:1}]});if(extraSale.data?.id)await request('POST',`/api/v1/sales-orders/${extraSale.data.id}/confirm`,{});
 await request('PUT','/api/v1/products/'+raw.id,{min_order_qty:7});
 const mixed=await request('POST','/api/v1/mps-plans',{...period,product_ids:[fin.id,raw.id]});if(mixed.data?.id){await request('POST',`/api/v1/mps-plans/${mixed.data.id}/generate-work-orders`,{});await request('GET',`/api/v1/mps-plans/${mixed.data.id}`);await request('GET','/api/v1/work-orders?product_id='+raw.id);await request('GET','/api/v1/work-orders?product_id='+fin.id)}}

}
