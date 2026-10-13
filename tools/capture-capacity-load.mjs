export async function captureCapacityLoad(request) {
  const load=async(days)=>request('GET','/api/v1/work-centers/load'+(days===undefined?'':'?days='+encodeURIComponent(days)));
  for(const days of [undefined,1,0,-2,'bad',365])await load(days);
  const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
  const product=products.find(p=>p.code==='REC-LIST-FIN');
  const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
  const create=async(route,body)=>{const r=await request('POST','/api/v1/'+route,body);if(!r.data?.id)throw Error(route+': '+JSON.stringify(r));return r.data;};
  const center=await create('work-centers',{code:'REC-LOAD-WC',name:'REC-LOAD-WC',capacity:8,cost_rate:2});
  const zero=await create('work-centers',{code:'REC-LOAD-ZERO',name:'REC-LOAD-ZERO',capacity:0});
  const routing=await create('routings',{product_id:product.id,steps:[
    {sequence:1,process_code:'LOAD-H',process_name:'Load hours',work_center_id:center.id,work_center:center.name,standard_time:2,standard_time_unit:'hour'},
    {sequence:2,process_code:'LOAD-M',process_name:'Load minutes',work_center_id:center.id,work_center:center.name,standard_time:30,standard_time_unit:'minute'}
  ]});
  const work=await create('work-orders',{product_id:product.id,qty:3,routing_id:routing.id,warehouse_id:warehouse.id});
  await load(1);await request('POST',`/api/v1/work-orders/${work.id}/confirm`,{});await load(1);
  await request('POST',`/api/v1/work-orders/${work.id}/approve`,{});await load(1);await load(2);
  const first=work.edges.processes[0];
  await request('POST',`/api/v1/work-order-processes/${first.id}/start`,{});await load(1);
  await request('POST',`/api/v1/work-order-processes/${first.id}/complete`,{qty_good:3,qty_bad:0,actual_time:1,labor_rate:2});await load(1);
  await request('POST',`/api/v1/work-order-processes/${first.id}/revert`,{});await load(1);
  await request('PUT','/api/v1/work-centers/'+center.id,{name:center.name,code:center.code,capacity:1,cost_rate:2});await load(1);
  for(const capacity of [7.5,9.375,0]){await request('PUT','/api/v1/work-centers/'+center.id,{capacity});await load(1);}
  await request('PUT','/api/v1/work-centers/'+center.id,{capacity:8,efficiency:0.5});await load(1);
  await request('PUT','/api/v1/work-centers/'+center.id,{status:'inactive'});await load(1);
  await request('DELETE','/api/v1/work-centers/'+center.id);await load(1);
}
