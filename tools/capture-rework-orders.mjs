export async function captureReworkOrders(request) {
  const base='/api/v1/rework-orders';
  await request('GET',base+'?page_size=100');
  await request('POST',base,{});await request('POST',base,{qty_rework:-1});
  const create=async(body)=>{const r=await request('POST',base,body);if(!r.data?.id)throw Error('Rework creation failed: '+JSON.stringify(r));return r.data;};
  const first=await create({qty_rework:3,qty_good:2,qty_bad:1,reason:'recovery rework',operator_name:'recovery operator',remark:'recovery draft'});
  const firstPath=base+'/'+first.id;
  await request('GET',firstPath);await request('GET',base+'?page_size=100');
  await request('PUT',firstPath,{qty_rework:5,qty_good:4,qty_bad:1,reason:'edited rework',operator_name:'edited operator',remark:'edited draft'});await request('GET',firstPath);
  await request('POST',firstPath+'/confirm',{});await request('POST',firstPath+'/confirm',{});await request('PUT',firstPath,{qty_rework:6});await request('DELETE',firstPath);
  await request('POST',firstPath+'/complete',{});await request('POST',firstPath+'/complete',{});await request('POST',firstPath+'/cancel',{});await request('DELETE',firstPath);
  const cancelled=await create({qty_rework:2});const cancelPath=base+'/'+cancelled.id;
  await request('POST',cancelPath+'/complete',{});await request('POST',cancelPath+'/cancel',{});await request('POST',cancelPath+'/cancel',{});await request('POST',cancelPath+'/complete',{});await request('DELETE',cancelPath);await request('GET',cancelPath);
  const draft=await create({qty_rework:1});const draftPath=base+'/'+draft.id;
  await request('DELETE',draftPath);await request('GET',draftPath);await request('DELETE',draftPath);
  const products=(await request('GET','/api/v1/products?page_size=100')).data.list;const product=products.find(x=>x.code==='REC-LIST-FIN');
  const works=(await request('GET','/api/v1/work-orders?product_id='+product.id)).data.list;const work=works.find(x=>x.status==='completed');
  const detail=(await request('GET','/api/v1/work-orders/'+work.id)).data;const process=detail.edges.processes[0];
  await request('POST',base,{work_order_id:work.id,qty_rework:2});
  const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
  const newRouting=(await request('POST','/api/v1/routings',{product_id:product.id,steps:[{process_code:'REWORK',process_name:'REWORK',standard_time:1}]})).data;
  const newWork=(await request('POST','/api/v1/work-orders',{product_id:product.id,qty:2,routing_id:newRouting.id,warehouse_id:warehouse.id})).data;
  await request('POST',base,{qty_rework:1,work_order_id:newWork.id});
  await request('POST',`/api/v1/work-orders/${newWork.id}/confirm`,{});
  await request('POST',base,{qty_rework:1,work_order_id:newWork.id});
  await request('POST',`/api/v1/work-orders/${newWork.id}/approve`,{});
  const linkedProcess=newWork.edges.processes[0];
  const linked=await create({work_order_id:newWork.id,work_order_no:newWork.order_no,process_id:linkedProcess.id,process_code:linkedProcess.process_code,process_name:linkedProcess.process_name,qty_rework:2,qty_good:1,qty_bad:1,reason:'linked work order'});
  await request('GET',base+'/'+linked.id);await request('POST',base+'/'+linked.id+'/confirm',{});await request('POST',base+'/'+linked.id+'/complete',{});await request('GET','/api/v1/work-orders/'+newWork.id);await request('GET',base+'?work_order_no='+encodeURIComponent(newWork.order_no));
  await request('GET',base+'/00000000-0000-0000-0000-000000000001');await request('PUT',base+'/00000000-0000-0000-0000-000000000001',{qty_rework:1});await request('DELETE',base+'/00000000-0000-0000-0000-000000000001');
  const partial=await create({qty_rework:4,qty_good:1,reason:'partial edit',operator_name:'initial operator'});await request('PUT',base+'/'+partial.id,{reason:'only reason'});await request('GET',base+'/'+partial.id);await request('PUT',base+'/'+partial.id,{qty_rework:7});await request('GET',base+'/'+partial.id);
  await request('POST',base,{qty_rework:2,qty_good:3,qty_bad:1});await request('POST',base,{qty_rework:2,qty_good:-1,qty_bad:0});

  for(const edit of [{qty_rework:0},{qty_good:0},{qty_bad:-1},{qty_good:8},{reason:''},{qty_rework:-1}]){await request('PUT',base+'/'+partial.id,edit);await request('GET',base+'/'+partial.id)}
  await request('POST',base,{qty_rework:1,work_order_id:'00000000-0000-0000-0000-000000000001'});
  await request('POST',base,{qty_rework:1,work_order_id:newWork.id,work_order_no:'wrong snapshot',process_id:'00000000-0000-0000-0000-000000000001',process_name:'caller process'});

  await request('POST',base,{qty_rework:1,process_id:linkedProcess.id});
  for(const keyword of ['linked','initial','REWORK','REW','wrong snapshot'])await request('GET',base+'?page_size=100&keyword='+encodeURIComponent(keyword));
  await request('GET',base+'?page_size=100&work_order_no=WO');


  // Edit association independently: establish whether create guards also apply to updates.
  const editLink=await create({qty_rework:2,reason:'association edit'});
  const editPath=base+'/'+editLink.id;
  for(const change of [
    {work_order_id:work.id,work_order_no:work.order_no},
    {work_order_id:'00000000-0000-0000-0000-000000000001'},
    {work_order_id:newWork.id,process_id:linkedProcess.id},
    {work_order_id:null,process_id:null},
    {work_order_no:'changed snapshot',process_name:'changed process'}
  ]){await request('PUT',editPath,change);await request('GET',editPath)}
  const cancelWork=(await request('POST','/api/v1/work-orders',{product_id:product.id,qty:1,warehouse_id:warehouse.id})).data;
  await request('POST',`/api/v1/work-orders/${cancelWork.id}/cancel`,{});
  await request('POST',base,{qty_rework:1,work_order_id:cancelWork.id});
  await request('PUT',editPath,{work_order_id:cancelWork.id});await request('GET',editPath);
  const laterWork=(await request('POST','/api/v1/work-orders',{product_id:product.id,qty:1,warehouse_id:warehouse.id})).data;
  const laterCancelled=await create({qty_rework:1,work_order_id:laterWork.id});
  await request('POST',`/api/v1/work-orders/${laterWork.id}/cancel`,{});
  await request('PUT',base+'/'+laterCancelled.id,{reason:'parent cancelled edit'});
  await request('GET',base+'/'+laterCancelled.id);
}
